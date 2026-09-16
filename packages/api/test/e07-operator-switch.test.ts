import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';
import { StaffService } from '../src/services/staff.service';

describe('E07 — Cambio de operador sin perder la pantalla (S07, S09)', () => {
  let app: FastifyInstance;
  const restaurantSlug = `rest-e07-${Date.now()}`;
  let restaurantId: string;
  let waiter1: any;
  let waiter2: any;
  let manager: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E07',
        slug: restaurantSlug,
        themeColor: '#234567',
        templateId: 'MODERN_DARK'
      }
    });
    restaurantId = restaurant.id;

    waiter1 = await StaffService.createStaff(restaurantId, 'Mozo Juan', '1234', 'WAITER');
    waiter2 = await StaffService.createStaff(restaurantId, 'Mozo Ana', '5678', 'WAITER');
    manager = await StaffService.createStaff(restaurantId, 'Encargado Mario', '9999', 'MANAGER');
  });

  afterAll(async () => {
    if (restaurantId) {
      await prisma.staffUser.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: restaurantId } } }).catch(() => undefined);
      await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('1. Mozo inicia sesión, visualiza workspace con cuentas y puede operar', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '1234',
        terminalId: 'pos-tablet-01'
      }
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.token).toBeDefined();
    expect(body.staffUser).toBeDefined();
    expect(body.staffUser.role).toBe('WAITER');
    const mozoToken = body.token;

    // Con token de mozo, puede consultar workspace completo
    const wsRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${mozoToken}` }
    });

    expect(wsRes.statusCode).toBe(200);
    const wsBody = wsRes.json();
    expect(wsBody.tasks).toBeDefined();
    expect(Array.isArray(wsBody.accounts)).toBe(true);
  });

  it('2. Puesto bloqueado (terminal-only) no puede realizar mutaciones (requiere operador)', async () => {
    const provRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/terminal/provision',
      payload: {
        restaurantSlug,
        pin: '9999',
        terminalId: 'pos-tablet-01',
        label: 'Tablet Salón Principal'
      }
    });

    expect(provRes.statusCode).toBe(200);
    const terminalToken = provRes.json().terminalToken;
    expect(terminalToken).toBeDefined();

    // Consulta de workspace desde terminal-only funciona pero sanitiza saldos/cuentas
    const wsRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${terminalToken}` }
    });

    expect(wsRes.statusCode).toBe(200);
    expect(wsRes.json().accounts).toEqual([]); // cuentas vacías en pantalla desatendida/bloqueada

    // Intento de mutar tarea con token de puesto devuelve 403 OPERATOR_PIN_REQUIRED
    const claimRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/service/tasks/CALL/dummy-call-id/claim',
      headers: { authorization: `Bearer ${terminalToken}` }
    });

    expect(claimRes.statusCode).toBe(403);
    expect(claimRes.json().code).toBe('OPERATOR_PIN_REQUIRED');
  });

  it('3. Cambio fluido de operador: Mozo 1 cede el puesto a Mozo 2 / Encargado sin desmontar terminal', async () => {
    // Mozo 1 se autentica
    const m1Res = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '1234',
        terminalId: 'pos-tablet-01'
      }
    });
    expect(m1Res.statusCode).toBe(200);
    expect(m1Res.json().staffUser.name).toBe('Mozo Juan');

    // Mozo 2 se autentica en el mismo puesto (PIN 5678)
    const m2Res = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '5678',
        terminalId: 'pos-tablet-01'
      }
    });
    expect(m2Res.statusCode).toBe(200);
    expect(m2Res.json().staffUser.name).toBe('Mozo Ana');
    const m2Token = m2Res.json().token;

    // Mozo 2 opera con su identidad en el mismo puesto
    const wsRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${m2Token}` }
    });
    expect(wsRes.statusCode).toBe(200);
    expect(Array.isArray(wsRes.json().accounts)).toBe(true);
  });

  it('4. Usuario dado de baja (eliminado de staff) es rechazado al ingresar PIN', async () => {
    // Dar de baja a Mozo 2 eliminando el registro
    await prisma.staffUser.delete({
      where: { id: waiter2.id }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '5678',
        terminalId: 'pos-tablet-01'
      }
    });

    expect(loginRes.statusCode).toBe(401);
    expect(loginRes.json().error || loginRes.json().message).toMatch(/incorrecto|no encontrado|inválid/i);
  });

  it('5. Reautorización puntual con token temporal (expiresIn 300s) bloqueada en admin', async () => {
    const tempRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '9999',
        terminalId: 'pos-tablet-01',
        isTemporary: true
      }
    });

    expect(tempRes.statusCode).toBe(200);
    const tempBody = tempRes.json();
    expect(tempBody.isTemporary).toBe(true);
    expect(tempBody.expiresInSeconds).toBe(300);
    const tempToken = tempBody.token;

    // Acceso administrativo bloqueado
    const adminRes = await app.inject({
      method: 'GET',
      url: `/v1/staff?restaurantId=${restaurantId}`,
      headers: { authorization: `Bearer ${tempToken}` }
    });

    expect(adminRes.statusCode).toBe(403);
    expect(adminRes.json().code).toBe('TEMPORARY_TOKEN_NOT_ALLOWED');
  });
});
