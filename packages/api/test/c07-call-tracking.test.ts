import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallStatus, CallType, TableFSMState } from '@mesaya/shared';

/**
 * C07 — llamados operativos por motivo.
 *
 * La sesión puede tener una necesidad de mozo y otra de insumos al mismo
 * tiempo, pero no dos llamados activos del mismo motivo. La lista pública y
 * la cola de personal deben conservar la independencia de cada solicitud al
 * tomar, cancelar o resolver una de ellas.
 */
describe('C07 — seguimiento de llamados e insumos', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let session: any;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'c07-tracking',
        slug: `c07-tracking-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa C07',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Encargado C07',
        pinHash: await bcrypt.hash('9707', 10),
        role: 'MANAGER'
      }
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: restaurant.slug, pin: '9707' }
    });
    expect(login.statusCode).toBe(200);
    managerToken = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCall(type: CallType, note: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: {
        sessionToken: session.token,
        type,
        note,
        origin: 'WEB_DIRECT'
      }
    });
  }

  async function readSession() {
    const response = await app.inject({ method: 'GET', url: `/v1/sessions/${session.token}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function updateCall(callId: string, status: CallStatus) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/calls/${callId}`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: { status }
    });
  }

  it('mantiene dos motivos simultáneos y no duplica el mismo motivo', async () => {
    const waiter = await createCall(CallType.WAITER, 'Traer agua');
    expect(waiter.statusCode).toBe(201);
    const waiterCall = waiter.json();

    const supplies = await createCall(CallType.SUPPLIES, 'Cubiertos');
    expect(supplies.statusCode).toBe(201);
    const suppliesCall = supplies.json();

    const current = await readSession();
    expect(current.activeCalls).toHaveLength(2);
    expect(current.activeCalls.map((call: any) => call.type).sort()).toEqual([
      CallType.SUPPLIES,
      CallType.WAITER
    ].sort());
    expect(current.activeCalls.find((call: any) => call.type === CallType.WAITER).note).toBe('Traer agua');
    expect(current.activeCalls.find((call: any) => call.type === CallType.SUPPLIES).note).toBe('Cubiertos');
    // Contrato legado: el primer llamado sigue disponible para integraciones
    // que todavía no conocen activeCalls.
    expect(current.activeCall.id).toBe(current.activeCalls[0].id);

    const duplicate = await createCall(CallType.WAITER, 'Segundo toque');
    expect(duplicate.statusCode).toBe(429);
    expect(duplicate.json().code).toBe('ACTIVE_CALL_LIMIT');

    const staffQueue = await app.inject({
      method: 'GET',
      url: `/v1/calls?restaurantId=${restaurant.id}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(staffQueue.statusCode).toBe(200);
    expect(staffQueue.json().map((call: any) => call.id)).toEqual(
      expect.arrayContaining([waiterCall.id, suppliesCall.id])
    );
  });

  it('una toma, cancelación o resolución no borra el otro motivo y libera su clave', async () => {
    const current = await readSession();
    const waiterCall = current.activeCalls.find((call: any) => call.type === CallType.WAITER);
    const suppliesCall = current.activeCalls.find((call: any) => call.type === CallType.SUPPLIES);
    expect(waiterCall).toBeDefined();
    expect(suppliesCall).toBeDefined();

    const taken = await updateCall(waiterCall.id, CallStatus.IN_PROGRESS);
    expect(taken.statusCode).toBe(200);
    expect(taken.json().status).toBe(CallStatus.IN_PROGRESS);

    const afterTake = await readSession();
    expect(afterTake.activeCalls).toHaveLength(2);
    expect(afterTake.activeCalls.find((call: any) => call.id === waiterCall.id).status).toBe(CallStatus.IN_PROGRESS);
    expect(afterTake.activeCalls.find((call: any) => call.id === suppliesCall.id).status).toBe(CallStatus.PENDING);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/calls/${waiterCall.id}/cancel`,
      payload: { sessionToken: session.token }
    });
    expect(cancelled.statusCode).toBe(200);

    const afterCancel = await readSession();
    expect(afterCancel.activeCalls).toHaveLength(1);
    expect(afterCancel.activeCalls[0].id).toBe(suppliesCall.id);

    const cancelledRow = await prisma.callRequest.findUnique({ where: { id: waiterCall.id } });
    expect(cancelledRow?.status).toBe(CallStatus.CANCELLED);
    expect(cancelledRow?.activeKey).toBeNull();
    expect(cancelledRow?.resolvedAt).toBeInstanceOf(Date);
    expect(cancelledRow?.acknowledgedAt).toBeInstanceOf(Date);

    // Al quedar libre la clave por motivo, un nuevo WAITER es válido aunque el
    // motivo SUPPLIES continúe visible y pendiente.
    const replacement = await createCall(CallType.WAITER, 'Traer la cuenta de mesa');
    expect(replacement.statusCode).toBe(201);
    const replacementCall = replacement.json();
    expect(replacementCall.type).toBe(CallType.WAITER);

    const afterReplacement = await readSession();
    expect(afterReplacement.activeCalls).toHaveLength(2);
    expect(afterReplacement.activeCalls.map((call: any) => call.id)).toEqual(
      expect.arrayContaining([suppliesCall.id, replacementCall.id])
    );

    const resolvedSupplies = await updateCall(suppliesCall.id, CallStatus.RESOLVED);
    expect(resolvedSupplies.statusCode).toBe(200);
    expect(resolvedSupplies.json().status).toBe(CallStatus.RESOLVED);

    const afterResolve = await readSession();
    expect(afterResolve.activeCalls).toHaveLength(1);
    expect(afterResolve.activeCalls[0].id).toBe(replacementCall.id);

    const resolvedRow = await prisma.callRequest.findUnique({ where: { id: suppliesCall.id } });
    expect(resolvedRow?.activeKey).toBeNull();
    expect(resolvedRow?.resolvedAt).toBeInstanceOf(Date);

    const resolvedReplacement = await updateCall(replacementCall.id, CallStatus.RESOLVED);
    expect(resolvedReplacement.statusCode).toBe(200);
    expect((await readSession()).activeCalls).toHaveLength(0);

    // La reconexión ve los estados terminales solo en persistencia/historial,
    // nunca como pendientes activos.
    const history = await prisma.callRequest.findMany({
      where: { tableSessionId: session.id },
      orderBy: { createdAt: 'asc' }
    });
    expect(history).toHaveLength(3);
    expect(history.map((call) => call.status).sort()).toEqual([
      CallStatus.CANCELLED,
      CallStatus.RESOLVED,
      CallStatus.RESOLVED
    ].sort());
  });

  it('arbitra el doble toque concurrente con una sola clave activa', async () => {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `Mesa C07 carrera ${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });
    const isolatedSession = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: session.shiftId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    const payload = {
      sessionToken: isolatedSession.token,
      type: CallType.WAITER,
      note: 'Doble toque',
      origin: 'WEB_DIRECT'
    };

    const results = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/calls', payload }),
      app.inject({ method: 'POST', url: '/v1/calls', payload })
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 429]);
    expect(await prisma.callRequest.count({ where: { tableSessionId: isolatedSession.id } })).toBe(1);
    const row = await prisma.callRequest.findFirst({ where: { tableSessionId: isolatedSession.id } });
    expect(row?.activeKey).toBe(`${isolatedSession.id}:${CallType.WAITER}`);
  });

  it('expone la lista independiente en el contrato del cliente', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const client = readFileSync(resolve(repoRoot, 'apps/client-web/app.js'), 'utf8');
    const html = readFileSync(resolve(repoRoot, 'apps/client-web/index.html'), 'utf8');
    const pollSection = client.slice(client.indexOf('async function pollTick'), client.indexOf('function startPolling'));

    expect(client).toContain('let activeCalls = []');
    expect(client).toContain('function renderActiveCalls(calls)');
    expect(client).toContain('data-active-call-id');
    expect(client).toContain('data-cancel-call');
    expect(pollSection).toContain('data.activeCalls');
    expect(pollSection).not.toContain('if (data.activeCall)');
    expect(html).toContain('id="activeCallList"');
    expect(html).not.toContain('id="btnCancelCall"');
  });
});
