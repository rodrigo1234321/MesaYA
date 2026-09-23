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

  // --- C01: Reproducciones A y B y Contención de extraFields ---

  it('Reproducción A: bloquea message con formato clave=valor y details no autorizados en 400', async () => {
    const app = await buildApp();

    app.get('/test-reproduction-a', async (_req, reply) => {
      const err: any = {
        statusCode: 400,
        message: 'api_key=FAKE_REVIEW_ONLY',
        details: { authorization: 'Bearer FAKE_REVIEW_ONLY' }
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-reproduction-a'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    // No debe devolver el mensaje inseguro api_key=FAKE_REVIEW_ONLY
    expect(body.message).not.toContain('FAKE_REVIEW_ONLY');
    expect(body.message).not.toContain('api_key');
    expect(body.message).toBe('Error en la solicitud');
    // No debe propagar details arbitrarios o con cabecera authorization
    expect(body.details).toBeUndefined();
    expect(response.body).not.toContain('Bearer FAKE_REVIEW_ONLY');
  });

  it('Reproducción B: bloquea error cuando contiene datos sensibles aunque message sea seguro', async () => {
    const app = await buildApp();

    app.get('/test-reproduction-b', async (_req, reply) => {
      const err: any = {
        statusCode: 400,
        message: 'Solicitud incorrecta',
        error: 'password=FAKE_REVIEW_ONLY'
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-reproduction-b'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    // Debe preservar el message seguro
    expect(body.message).toBe('Solicitud incorrecta');
    // NO debe exponer el contenido inseguro de error
    expect(body.error).not.toContain('FAKE_REVIEW_ONLY');
    expect(body.error).not.toContain('password');
    // Debe caer a un mensaje canónico legible; el identificador va en `code`.
    expect(body.error).toBe('Solicitud incorrecta');
    expect(body.message).toBe('Solicitud incorrecta');
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('extraFields no puede sobrescribir campos del contrato ni inyectar claves arbitrarias', async () => {
    const app = await buildApp();

    app.get('/test-extrafields-tamper', async (_req, reply) => {
      const err: any = new Error('Mesa no encontrada');
      err.statusCode = 404;
      return sendSanitizedError(reply, err, {
        message: 'OVERWRITTEN_MESSAGE',
        error: 'OVERWRITTEN_ERROR',
        code: 'OVERWRITTEN_CODE',
        statusCode: 200,
        maliciousKey: 'maliciousValue',
        valid: false
      });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-extrafields-tamper'
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toBe('Mesa no encontrada');
    expect(body.statusCode).toBe(404);
    expect(body.valid).toBe(false);
    expect(body.maliciousKey).toBeUndefined();
    expect(response.body).not.toContain('OVERWRITTEN');
  });

  it('el manejador global de errores Fastify sanitiza 4xx unhandled de forma idéntica', async () => {
    const app = await buildApp();

    app.get('/test-global-400-unhandled', async () => {
      const customErr: any = new Error('token=SECRET_LEAK_TEST');
      customErr.statusCode = 400;
      customErr.details = { secretHeader: 'Bearer 12345' };
      throw customErr;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-global-400-unhandled'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Error en la solicitud');
    expect(body.details).toBeUndefined();
    expect(response.body).not.toContain('SECRET_LEAK_TEST');
    expect(response.body).not.toContain('12345');
  });

  it('bloquea direcciones IP internas y hostnames internos en details', async () => {
    const app = await buildApp();

    app.get('/test-internal-addr-leak', async (_req, reply) => {
      const err: any = new Error('Servicio no disponible');
      err.statusCode = 503;
      err.code = 'SERVICE_UNAVAILABLE';
      err.details = {
        host: '192.168.1.100',
        port: 5432,
        fallback: 'db-replica.internal',
        tableId: 'mesa-01'
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-internal-addr-leak'
    });

    const body = JSON.parse(response.body);
    // 503 is 5xx, should be fully opaque
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('192.168');
    expect(response.body).not.toContain('.internal');
    expect(response.body).not.toContain('5432');
  });

  it('bloquea URLs con credenciales embebidas en details de 4xx', async () => {
    const app = await buildApp();

    app.get('/test-credential-url-leak', async (_req, reply) => {
      const err: any = new Error('Fallo de conexión a servicio externo');
      err.statusCode = 422;
      err.code = 'EXTERNAL_SERVICE_ERROR';
      err.details = {
        url: 'http://admin:s3cr3t@db.internal:5432/production',
        tableSessionId: 'ts-abc-123',
        reason: 'timeout'
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-credential-url-leak'
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    // The entire details should be dropped since the JSON contains credential patterns
    expect(response.body).not.toContain('admin');
    expect(response.body).not.toContain('s3cr3t');
    expect(response.body).not.toContain('db.internal');
    expect(response.body).not.toContain('5432');
    expect(response.body).not.toContain('production');
  });

  it('bloquea connection strings de cualquier DB engine en detail values', async () => {
    const app = await buildApp();

    app.get('/test-connstr-detail-leak', async (_req, reply) => {
      const err: any = new Error('Mesa no disponible');
      err.statusCode = 409;
      err.code = 'TABLE_NOT_AVAILABLE';
      err.details = {
        debug: 'mysql://root:pass@10.0.0.5:3306/mesaya',
        currentVersion: 7,
        expectedVersion: 9
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-connstr-detail-leak'
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(response.body).not.toContain('mysql://');
    expect(response.body).not.toContain('root');
    expect(response.body).not.toContain('10.0.0.5');
    // Safe domain metadata should survive if the tainted entries are dropped
    // but if the whole JSON serialized form triggers the fast-path block, it's also acceptable
  });

  it('preserva metadata segura de dominio cuando details no tiene taint', async () => {
    const app = await buildApp();

    app.get('/test-safe-details-pass', async (_req, reply) => {
      const err: any = new Error('El plano cambió');
      err.statusCode = 409;
      err.code = 'LAYOUT_VERSION_CONFLICT';
      err.details = {
        expectedVersion: 7,
        currentVersion: 9,
        tableId: 'mesa-01'
      };
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-safe-details-pass'
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(body.details).toBeDefined();
    expect(body.details.expectedVersion).toBe(7);
    expect(body.details.currentVersion).toBe(9);
    expect(body.details.tableId).toBe('mesa-01');
  });

  it('P1-REPRO: bloquea IP interna en message y URL con credenciales en error en HTTP 400', async () => {
    const app = await buildApp();

    app.get('/test-p1-repro', async (_req, reply) => {
      const err: any = new Error('Upstream 10.0.0.7 refused connection');
      err.statusCode = 400;
      err.error = 'https://FAKE_USER:FAKE_PASS@example.invalid/internal';
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-p1-repro'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    // Verificamos que NUNCA se filtre la IP interna ni la URL con credenciales
    expect(response.body).not.toContain('10.0.0.7');
    expect(response.body).not.toContain('FAKE_USER');
    expect(response.body).not.toContain('FAKE_PASS');
    expect(response.body).not.toContain('example.invalid');
    // Deben recibir mensajes canónicos seguros
    expect(body.message).toBe('Error en la solicitud');
    expect(body.error).toBe('Error en la solicitud');
  });

  it('mantiene el código registrado y el mensaje legible del contrato público', async () => {
    const app = await buildApp();

    app.get('/test-registered-code', async (_req, reply) => {
      const err = Object.assign(new Error('La cuenta cambió; actualizá el resumen antes de cobrar.'), {
        statusCode: 409,
        code: 'STALE_ACCOUNT_VERSION'
      });
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({ method: 'GET', url: '/test-registered-code' });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('STALE_ACCOUNT_VERSION');
    expect(body.error).toBe('La cuenta cambió; actualizá el resumen antes de cobrar.');
    expect(body.message).toBe(body.error);
  });

  it('P1-REPRO: rechaza codigos no registrados en el contrato publico asignando el canonico', async () => {
    const app = await buildApp();

    app.get('/test-unregistered-code', async (_req, reply) => {
      const err: any = new Error('Operación falló');
      err.statusCode = 400;
      err.code = 'SOME_UNREGISTERED_INTERNAL_CODE';
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-unregistered-code'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toBe('Error en la solicitud');
  });

  it('bloquea loopback, localhost, link-local y hosts internos en messages y details', async () => {
    const app = await buildApp();

    app.get('/test-internal-hosts', async (_req, reply) => {
      const err = Object.assign(new Error('No se pudo conectar a http://localhost:3000/health'), {
        statusCode: 400,
        details: {
          metadataEndpoint: 'http://169.254.169.254/latest/meta-data',
          loopbackEndpoint: 'http://[::1]:5432/health',
          localDomain: 'https://api.localhost/private',
          publicUrl: 'https://example.com/help',
          tableId: 'mesa-01'
        }
      });
      return sendSanitizedError(reply, err);
    });

    const response = await app.inject({ method: 'GET', url: '/test-internal-hosts' });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('localhost');
    expect(response.body).not.toContain('169.254.169.254');
    expect(response.body).not.toContain('::1');
    expect(response.body).not.toContain('example.com');
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Error en la solicitud');
    expect(body.details).toEqual({ tableId: 'mesa-01' });
  });

  it('P1-REAL-ROUTE: ruta real del servidor Fastify procesa error a traves del error handler global', async () => {
    const app = await buildApp();

    // Inyectamos solicitud a una ruta REAL (/api/auth/login) con sintaxis JSON inválida
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json'
      },
      payload: '{ invalid-json-payload-from-client: true'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('INVALID_JSON_BODY');
    expect(body.statusCode).toBe(400);
    expect(body.requestId).toBeDefined();
    // Verifica que no se expone sintaxis interna ni detalles del parser de V8
    expect(response.body).not.toContain('SyntaxError');
    expect(response.body).not.toContain('at JSON.parse');
  });
});

