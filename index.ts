// Vercel Fastify framework entrypoint. The implementation remains in api/index.ts.
// The import is intentional: Vercel's Fastify detector requires the framework
// dependency to be visible in the project entrypoint.
import Fastify from 'fastify';
void Fastify;
export { default } from './api/index';
