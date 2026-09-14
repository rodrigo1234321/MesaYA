import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';

describe('GATE-E06: Observabilidad Pino JSON y Correlation ID', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('inyecta x-request-id y propaga x-correlation-id si viene provisto', async () => {
    const customCorrelation = 'client-corr-uuid-12345';
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-correlation-id': customCorrelation
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBe(customCorrelation);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('genera correlation-id igual al request-id si el cliente no lo envía', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBe(res.headers['x-request-id']);
  });
});
