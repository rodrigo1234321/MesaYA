import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

describe('GATE-E07: Vercel Serverless Handler Lifecycle Execution (P0-08)', () => {
  it('ejecuta una solicitud real HTTP mediante el handler exportado de api/index.ts', async () => {
    const entryUrl = pathToFileURL(
      path.resolve(__dirname, '..', '..', '..', 'api', 'index.ts')
    ).href;
    const { default: handler } = await import(entryUrl);

    expect(typeof handler).toBe('function');

    // Usar un socket / stream real de Node.js creando un server efímero que delega al handler
    const server = http.createServer(async (req, res) => {
      await handler(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    const port = address.port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('x-correlation-id')).toBeTruthy();

      const v1Response = await fetch(`http://127.0.0.1:${port}/v1/health`);
      expect(v1Response.status).toBe(200);
      const v1Data = await v1Response.json();
      expect(v1Data.service).toMatch(/MesaYA/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
