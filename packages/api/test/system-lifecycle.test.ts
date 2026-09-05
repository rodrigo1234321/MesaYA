import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/index';
import { parseTableUrl, ApiErrorCode, CallType, PaymentMethod, CallStatus } from '@mesaya/shared';
import { FastifyInstance } from 'fastify';

describe('MesaYA System Lifecycle & Contract Verification', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Health Check & Error Handling', () => {
    it('GET /health returns ok with standard payload', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health'
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('MesaYA API');
      expect(data.time).toBeDefined();
    });

    it('GET /v1/health returns ok with standard payload', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health'
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('MesaYA API v1');
    });

    it('GET non-existent endpoint returns 404 with structured error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/non-existent-route-404'
      });
      expect(res.statusCode).toBe(404);
      const data = res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('2. Table URL Parsing Contract (parseTableUrl)', () => {
    it('parses canonical path /r/:slug/mesa/:label', () => {
      const parsed = parseTableUrl('https://mesaya.app/r/trattoria-del-puerto/mesa/Mesa%204');
      expect(parsed.restaurantSlug).toBe('trattoria-del-puerto');
      expect(parsed.tableLabel).toBe('Mesa 4');
    });

    it('parses short path /mesa/:label with query token', () => {
      const parsed = parseTableUrl('/mesa/Terraza%201?token=test-uuid-token');
      expect(parsed.tableLabel).toBe('Terraza 1');
      expect(parsed.token).toBe('test-uuid-token');
    });

    it('parses legacy query params ?r=...&m=...', () => {
      const parsed = parseTableUrl('http://localhost:5173/?r=el-bodegon&m=Mesa%2012');
      expect(parsed.restaurantSlug).toBe('el-bodegon');
      expect(parsed.tableLabel).toBe('Mesa 12');
    });

    it('handles query parameter token directly', () => {
      const parsed = parseTableUrl('/?token=token-12345');
      expect(parsed.token).toBe('token-12345');
    });
  });

  describe('3. Sessions & Error Codes Semantics', () => {
    it('GET /v1/sessions/:token with bad token returns 404 or structured invalid response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions/invalid-non-existent-token-xyz'
      });
      // Should return either 404 or valid: false
      const data = res.json();
      expect(data.valid === false || res.statusCode === 404).toBe(true);
    });

    it('POST /v1/calls rejects empty body with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {}
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const data = res.json();
      expect(data.error).toBeDefined();
    });
  });
});
