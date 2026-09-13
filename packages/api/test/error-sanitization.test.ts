import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/index';

describe('Global Error Sanitization (P0-05)', () => {
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
});
