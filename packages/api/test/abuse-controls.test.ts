import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';
import { AbuseControlService, AbusePolicies } from '../src/services/abuse-control.service';
import { CallService } from '../src/services/call.service';
import { CallOrigin, CallType, PaymentMethod } from '@mesaya/shared';

describe('Etapa 25 — controles compartidos de abuso y llamados duplicados', () => {
  const keyPrefix = `stage25:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let connectionA: PrismaClient;
  let connectionB: PrismaClient;
  let app: FastifyInstance;
  let restaurantId: string;

  beforeAll(async () => {
    connectionA = new PrismaClient();
    connectionB = new PrismaClient();
    await connectionA.$connect();
    await connectionB.$connect();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    await app.close();
    await connectionA.$disconnect();
    await connectionB.$disconnect();
  });

  it('comparte un bucket entre dos conexiones y devuelve 429 lógico al agotar el límite', async () => {
    const key = `${keyPrefix}:shared`;
    const policy = { limit: 2, windowSeconds: 60 };
    const decisions = await Promise.all([
      AbuseControlService.consumeWithClient(connectionA, key, policy),
      AbuseControlService.consumeWithClient(connectionB, key, policy),
      AbuseControlService.consumeWithClient(connectionA, key, policy),
      AbuseControlService.consumeWithClient(connectionB, key, policy)
    ]);

    expect(decisions.filter(d => d.allowed)).toHaveLength(2);
    expect(decisions.filter(d => !d.allowed)).toHaveLength(2);
    expect(decisions.filter(d => !d.allowed).every(d => d.retryAfterSeconds >= 1)).toBe(true);
  });

  it('mantiene exactamente un llamado activo cuando dos conexiones compiten simultáneamente', async () => {
    const restaurant = await prisma.restaurant.create({
      data: { name: 'Stage 25 Abuse', slug: `stage25-${Date.now()}`, templateId: 'MINIMAL_CLEAN', themeColor: '#111111' }
    });
    restaurantId = restaurant.id;
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, activeKey: restaurant.id } });
    const table = await prisma.table.create({ data: { restaurantId: restaurant.id, label: 'Stage 25', sector: 'SALON_PRINCIPAL' } });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        activeKey: table.id,
        token: `${keyPrefix}:session`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    const results = await Promise.allSettled([
      CallService.createCall({ sessionToken: session.token, type: CallType.WAITER, paymentMethod: PaymentMethod.NOT_APPLICABLE, origin: CallOrigin.WEB_DIRECT }),
      CallService.createCall({ sessionToken: session.token, type: CallType.WAITER, paymentMethod: PaymentMethod.NOT_APPLICABLE, origin: CallOrigin.WEB_DIRECT })
    ]);

    const active = await prisma.callRequest.count({
      where: { tableSessionId: session.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
    });
    expect(active).toBe(1);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason?.statusCode).toBe(429);
    expect(['ACTIVE_CALL_LIMIT', 'RATE_LIMIT_EXCEEDED']).toContain(rejected?.reason?.code);

    const httpRetry = await app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: { sessionToken: session.token, type: CallType.WAITER }
    });
    expect(httpRetry.statusCode).toBe(429);
    expect(httpRetry.headers['retry-after']).toBe('1');
  });

  it('libera la clave activa al resolver o cancelar para permitir el siguiente llamado', async () => {
    const session = await prisma.tableSession.findFirst({ where: { table: { restaurantId: restaurantId! } } });
    expect(session).not.toBeNull();
    const active = await prisma.callRequest.findFirst({ where: { tableSessionId: session!.id, status: 'PENDING' } });
    expect(active).not.toBeNull();
    await CallService.updateCallStatus(active!.id, 'RESOLVED' as any);
    const released = await prisma.callRequest.findUnique({ where: { id: active!.id } });
    expect(released?.activeKey).toBeNull();
  });
});
