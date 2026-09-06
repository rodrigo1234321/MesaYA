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
import { prisma } from './lib/prisma';
import { getEnvironmentConfig } from './lib/environment';

const port = Number(process.env.PORT) || 3000;

export async function buildApp() {
  // Deliberadamente antes de construir o escuchar: producción falla cerrada.
  const environment = getEnvironmentConfig();
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true
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

  // Global Error Handler for standardized JSON responses
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as any).statusCode || (error as any).status || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    if (!isClientError) {
      request.log.error(error);
    }

    const isProd = process.env.NODE_ENV === 'production';
    const errorMessage = isClientError || !isProd
      ? (error.message || 'Error en la solicitud')
      : 'Error interno del servidor';

    const response = {
      error: errorMessage,
      code: (error as any).code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR'),
      statusCode,
      ...(process.env.NODE_ENV === 'development' ? { details: (error as any).details } : {})
    };

    reply.status(statusCode).send(response);
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
