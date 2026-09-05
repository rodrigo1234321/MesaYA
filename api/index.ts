import { buildApp } from '../packages/api/src/index';

// Singleton por instancia (cold start seguro): una sola app por contenedor
// serverless. Si la construcción falla, se libera la promesa para reintentar
// en la siguiente invocación en vez de dejar una promesa rechazada colgada.
let appPromise: Promise<any> | null = null;

async function getApp(): Promise<any> {
  if (!appPromise) {
    appPromise = buildApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

// Entry compatible con Vercel Node Functions: export default (req, res).
// No se confía en X-Forwarded-* a nivel HTTP: Fastify corre con
// trustProxy desactivado y la IP de rate limit sigue el contrato explícito
// de packages/api/src/lib/rate-limit-ip.ts.
export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    await app.ready();
    // La promesa del handler espera el ciclo HTTP real: sólo se resuelve
    // cuando la respuesta termina/cierra, para que Vercel no congele la
    // función antes de enviar el cuerpo.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        res.removeListener?.('finish', onFinish);
        res.removeListener?.('close', onClose);
        res.removeListener?.('error', onError);
      };
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        // `close` sin `finish` es cierre prematuro (aborto): no tratarlo
        // como éxito. Sólo resuelve si la respuesta ya terminó.
        const ended = res.writableEnded === true;
        cleanup();
        if (ended) resolve();
        else reject(new Error('Response closed before finish'));
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error('Response error'));
      };
      res.once?.('finish', onFinish);
      res.once?.('close', onClose);
      res.once?.('error', onError);
      app.server.emit('request', req, res);
    });
  } catch (err) {
    // Terminar siempre la respuesta: nunca dejar la función colgada.
    // Sin doble end: si ya terminó o fue destruida, no se reenvía.
    try {
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) res.statusCode = 500;
      res.setHeader?.('content-type', 'application/json; charset=utf-8');
      res.end?.(JSON.stringify({ error: 'Error interno del servidor' }));
    } catch (_) {
      try {
        if (!res.writableEnded && !res.destroyed) res.end?.();
      } catch (_) {}
    }
  }
}
