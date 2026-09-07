import Fastify from 'fastify';
import path from 'path';
import Module from 'module';

// Polyfill module resolution for @mesaya/shared in Serverless monorepo environments
const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request === '@mesaya/shared') {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch {
      const candidates = [
        path.resolve(process.cwd(), 'packages/shared/dist/index.js'),
        path.resolve(__dirname, 'packages/shared/dist/index.js'),
        path.resolve(__dirname, '../packages/shared/dist/index.js'),
        '/var/task/packages/shared/dist/index.js'
      ];
      for (const candidate of candidates) {
        try {
          return originalResolveFilename.call(this, candidate, parent, isMain, options);
        } catch (_) {}
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

import { buildApp } from './packages/api/src/index';

let appPromise: Promise<any> | null = null;

export async function getApp() {
  if (!appPromise) {
    appPromise = buildApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  const app = await appPromise;
  await app.ready();
  return app;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
