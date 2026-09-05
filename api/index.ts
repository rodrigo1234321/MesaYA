import { buildApp } from '../packages/api/src/index';

let appPromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = buildApp();
  }
  const app = await appPromise;
  await app.ready();
  app.server.emit('request', req, res);
}
