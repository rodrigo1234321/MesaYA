import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import path from 'path';

// Preserve explicit DATABASE_URL from runner or environment
const explicitDatabaseUrl = process.env.DATABASE_URL;

// Load .env from workspace packages/api or root project directory
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'packages/api/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

if (explicitDatabaseUrl) {
  process.env.DATABASE_URL = explicitDatabaseUrl;
}

import { sessionRoutes } from './routes/sessions.routes';
import { callRoutes } from './routes/calls.routes';
import { streamRoutes } from './routes/stream.routes';
import { shiftRoutes } from './routes/shifts.routes';
import { staffRoutes } from './routes/staff.routes';
import { tableRoutes } from './routes/tables.routes';
import { metricsRoutes } from './routes/metrics.routes';
import { feedbackRoutes } from './routes/feedback.routes';
import { menuRoutes } from './routes/menu.routes';
import { authRoutes } from './routes/auth.routes';
import { configRoutes } from './routes/config.routes';
import { orderRoutes } from './routes/orders.routes';
import { waitlistRoutes } from './routes/waitlist.routes';
import { floorPlanRoutes } from './routes/floorplan.routes';
import { tableStateRoutes } from './routes/tablestate.routes';
import { rtmsAnalyticsRoutes } from './routes/analytics.routes';
import { rewardsRoutes } from './routes/rewards.routes';
import { serviceRoutes } from './routes/service.routes';
import { salesRoutes } from './routes/sales.routes';
import { prisma } from './lib/prisma';
import { getEnvironmentConfig } from './lib/environment';

const port = Number(process.env.PORT) || 3000;

export async function buildApp() {
  // Deliberadamente antes de construir o escuchar: producción falla cerrada.
  const environment = getEnvironmentConfig();
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers["x-session-token"]', 'body.pin', 'body.token', 'body.password', 'pin', 'token', 'password']
    },
    trustProxy: process.env.NODE_ENV === 'production' ? true : false
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // CORS es una lista explícita; la ausencia de Origin (por ejemplo curl)
      // no recibe cabeceras CORS y no equivale a autenticación.
      cb(null, Boolean(origin && environment.corsOrigins.includes(origin)));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
  });

  await app.register(jwt, {
    secret: environment.jwtSecret
  });

  // Inject correlationId and track request start
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || request.id;
    reply.header('x-request-id', request.id);
    reply.header('x-correlation-id', correlationId);
    (request as any).correlationId = correlationId;
  });

  // Headers mínimos de defensa para API y respuestas de error. El cliente web
  // mantiene su propia política de assets; la API no necesita ejecutar ni
  // embeberse en un navegador.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // Content Type Parser para application/json con allowlist explícita de endpoints de acción
  // Evita el crash FST_ERR_CTP_EMPTY_JSON_BODY en rutas de acción sin payload obligatorio
  // pero rechaza con 400 EMPTY_JSON_BODY cualquier otra ruta POST/PATCH que envíe cuerpo vacío.
  const EMPTY_BODY_ALLOWLIST = [
    '/close-session',
    '/validate',
    '/call'
  ];

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const bodyStr = typeof body === 'string' ? body : (body ? (body as Buffer).toString('utf-8') : '');
    const isBlank = !bodyStr || bodyStr.trim() === '';
    if (isBlank) {
      const url = req.url || '';
      const isAllowedEmpty = EMPTY_BODY_ALLOWLIST.some((path) => url.includes(path));
      if (isAllowedEmpty) {
        done(null, {});
        return;
      }
      const err: any = new Error('El cuerpo de la petición no puede estar vacío');
      err.statusCode = 400;
      err.code = 'EMPTY_JSON_BODY';
      done(err, undefined);
      return;
    }

    try {
      const parsed = JSON.parse(bodyStr);
      done(null, parsed);
    } catch (syntaxErr: any) {
      syntaxErr.statusCode = 400;
      syntaxErr.code = 'INVALID_JSON_BODY';
      done(syntaxErr, undefined);
    }
  });

  // Global Error Handler for standardized JSON responses (P0-05)
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = Number(error?.statusCode || error?.status) || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;
    const requestId = String(request.id || error?.requestId || '');

    // Registrar error completo de servidor en logs estructurados con requestId, correlationId, staffUserId, restaurantId
    if (!isClientError) {
      const staffUser = (request as any).staffUser;
      const correlationId = (request as any).correlationId || String(request.id || '');
      request.log.error({
        err: error,
        requestId,
        correlationId,
        url: request.url,
        method: request.method,
        restaurantId: staffUser?.restaurantId,
        staffUserId: staffUser?.sub,
        terminalId: staffUser?.terminalId
      }, 'Unhandled server exception');
    }

    // Respuesta pública hacia el cliente: 5xx SIEMPRE es opaco
    if (!isClientError) {
      return reply.status(500).send({
        code: 'INTERNAL_SERVER_ERROR',
        error: 'Ocurrió un error inesperado al procesar la solicitud',
        message: 'Ocurrió un error inesperado al procesar la solicitud',
        statusCode: 500,
        requestId
      });
    }

    // Errores 4xx de cliente
    const publicCode = error?.code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : 'BAD_REQUEST');
    const publicMessage = error?.message || 'Error en la solicitud';

    return reply.status(statusCode).send({
      code: publicCode,
      error: publicMessage,
      message: publicMessage,
      statusCode,
      requestId,
      ...(error?.details ? { details: error.details } : {})
    });
  });

  // Standardized 404 handler (P0-05)
  app.setNotFoundHandler((request, reply) => {
    const requestId = String(request.id || '');
    return reply.status(404).send({
      code: 'NOT_FOUND',
      error: `Ruta no encontrada: ${request.method} ${request.url}`,
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
      statusCode: 404,
      requestId
    });
  });

  // Health & Readiness checks with database probe
  const healthHandler = (serviceName: string) => async (request: any, reply: any) => {
    let dbStatus = 'connected';
    if (typeof (prisma as any)?.$queryRaw === 'function') {
      try {
        await Promise.race([
          prisma.$queryRaw`SELECT 1`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 3000))
        ]);
      } catch (err: any) {
        request.log.warn({ err }, 'Health check database probe failed');
        return reply.status(503).send({
          status: 'degraded',
          service: serviceName,
          database: 'unreachable',
          time: new Date().toISOString()
        });
      }
    }
    return reply.send({
      status: 'ok',
      service: serviceName,
      database: dbStatus,
      time: new Date().toISOString()
    });
  };

  app.get('/health', healthHandler('MesaYA API'));
  app.get('/v1/health', healthHandler('MesaYA API v1'));

  // SSE Stream disabled endpoint at root and /v1
  await app.register(streamRoutes);

  // Register API routes with /v1 prefix
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(sessionRoutes);
      await v1.register(callRoutes);
      await v1.register(streamRoutes);
      await v1.register(shiftRoutes);
      await v1.register(staffRoutes);
      await v1.register(tableRoutes);
      await v1.register(metricsRoutes);
      await v1.register(feedbackRoutes);
      await v1.register(menuRoutes);
      await v1.register(configRoutes);
      await v1.register(orderRoutes);
      await v1.register(waitlistRoutes);
      await v1.register(floorPlanRoutes);
      await v1.register(tableStateRoutes);
      await v1.register(rtmsAnalyticsRoutes);
      await v1.register(rewardsRoutes);
      await v1.register(serviceRoutes);
      await v1.register(salesRoutes);
    },
    { prefix: '/v1' }
  );

  return app;
}

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 MesaYA API lista y corriendo en http://localhost:${port}/v1`);

    ['SIGINT', 'SIGTERM', 'SIGUSR2', 'beforeExit'].forEach((sig) => {
      process.once(sig, async () => {
        try {
          await app.close();
        } catch (_) {}
      });
    });
  } catch (err) {
    console.error('Error al iniciar MesaYA API:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
