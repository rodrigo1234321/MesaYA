import Fastify from 'fastify';
import { buildApp } from './packages/api/src/index';

let appPromise: Promise<any> | null = null;

export async function getApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  const app = await appPromise;
  await app.ready();
  return app;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
