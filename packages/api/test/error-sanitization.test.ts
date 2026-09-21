import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/index';
import { sendSanitizedError } from '../src/lib/errorHandler';

describe('Global Error Sanitization (P0-05, R02)', () => {
  it('sanitiza excepciones 5xx ocultando stack traces y detalles internos', async () => {
    const app = await buildApp();

    // Inyectamos una ruta temporal que lance un error no controlado
    app.get('/test-500-unhandled', async () => {
      throw new Error('Database password was secret123 and connection dropped at line 42');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-500-unhandled'
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);

    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('Ocurrió un error inesperado al procesar la solicitud');
    expect(body.requestId).toBeDefined();
    // Verificamos que NINGÚN dato sensible ni stack trace escape
    expect(response.body).not.toContain('secret123');
    expect(response.body).not.toContain('Database password');
    expect(response.body).not.toContain('Error:');
  });

  it('preserva codigos y mensajes utiles en errores 4xx del cliente', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/test-404-nonexistent-route'
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.requestId).toBeDefined();
  });

  it('enmascara errores de base de datos o Prisma aunque tengan statusCode 4xx', async () => {
    const app = await buildApp();

    app.get('/test-400-prisma-leak', async (_req, reply) => {
      const err: any = new Error(
        'Invalid `prisma.order.findUnique()` invocation:\nForeign key constraint violated on table "orders"'
      );
      err.statusCode = 400;
      err.code = 'PRISMA_LEAK';
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-400-prisma-leak'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).not.toContain('prisma');
    expect(body.message).not.toContain('Foreign key');
    expect(body.message).toBe('Error en la solicitud');
  });

  it('redacta secrets o tokens si aparecen dentro de details en errores 4xx', async () => {
    const app = await buildApp();

    app.get('/test-400-details-leak', async (_req, reply) => {
      const err: any = new Error('Validación fallida');
      err.statusCode = 422;
      err.code = 'UNPROCESSABLE_ENTITY';
      err.details = {
        field: 'apiKey',
        secret: 'super-secret-token-do-not-leak',
        nested: { password: '123' }
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-400-details-leak'
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.details).toBeUndefined();
    expect(response.body).not.toContain('super-secret-token-do-not-leak');
  });

  it('inyecta cabecera Retry-After cuando statusCode es 429 con retryAfterSeconds', async () => {
    const app = await buildApp();

    app.get('/test-429-rate-limit', async (_req, reply) => {
      const err: any = new Error('Límite de solicitudes superado');
      err.statusCode = 429;
      err.code = 'TOO_MANY_REQUESTS';
      err.retryAfterSeconds = 30;
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-429-rate-limit'
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    const body = JSON.parse(response.body);
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('preserva campos extra cuando se especifican (ej: valid: false en sesiones)', async () => {
    const app = await buildApp();

    app.get('/test-session-not-found', async (_req, reply) => {
      const err: any = new Error('Mesa no encontrada');
      err.statusCode = 404;
      return sendSanitizedError(reply, err, { valid: false });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-session-not-found'
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });
});
