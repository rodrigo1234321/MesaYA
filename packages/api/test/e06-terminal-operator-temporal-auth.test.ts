import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';
import { StaffService } from '../src/services/staff.service';
import { CallService } from '../src/services/call.service';
import { CallOrigin, CallType, PaymentMethod } from '@mesaya/shared';

describe('E06 — Backend de puesto, operador y autorización temporal (S07, S09, S13)', () => {
  let app: FastifyInstance;
  const restaurantSlug = `rest-e06-${Date.now()}`;
  let restaurantId: string;
  let waiterA: any;
  let waiterB: any;
  let manager: any;
  let table1: any;
  let table2: any;
  let shift: any;
  let session1: any;
  let session2: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E06 Puesto',
        slug: restaurantSlug,
        themeColor: '#123456',
        templateId: 'MODERN_DARK'
      }
    });
    restaurantId = restaurant.id;

    waiterA = await StaffService.createStaff(restaurantId, 'Mozo Alberto', '1111', 'WAITER');
    waiterB = await StaffService.createStaff(restaurantId, 'Mozo Beatriz', '2222', 'WAITER');
    manager = await StaffService.createStaff(restaurantId, 'Encargado Carlos', '9999', 'MANAGER');

    shift = await prisma.shift.create({
      data: { restaurantId, activeKey: restaurantId }
    });

    table1 = await prisma.table.create({
      data: { restaurantId, label: 'Mesa 10', sector: 'SALON_PRINCIPAL' }
    });
    table2 = await prisma.table.create({
      data: { restaurantId, label: 'Mesa 20', sector: 'SALON_PRINCIPAL' }
    });

    session1 = await prisma.tableSession.create({
      data: {
        tableId: table1.id,
        shiftId: shift.id,
        activeKey: table1.id,
        token: `session-token-10-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    session2 = await prisma.tableSession.create({
      data: {
        tableId: table2.id,
        shiftId: shift.id,
        activeKey: table2.id,
        token: `session-token-20-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
  });

  afterAll(async () => {
    if (restaurantId) {
      await prisma.callRequest.deleteMany({ where: { tableSessionId: { in: [session1?.id, session2?.id] } } }).catch(() => undefined);
      await prisma.tableSession.deleteMany({ where: { tableId: { in: [table1?.id, table2?.id] } } }).catch(() => undefined);
      await prisma.table.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.shift.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.staffUser.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: restaurantId } } }).catch(() => undefined);
      await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('permite provisionar credencial de terminal de hardware limitada a lectura de servicio (S09)', async () => {
    // 1. Provisionar terminal mediante PIN del encargado
    const provisionRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/terminal/provision',
      payload: {
        restaurantSlug,
        pin: '9999',
        terminalId: 'tablet-salon-principal-01',
        mode: 'SALON'
      }
    });

    expect(provisionRes.statusCode).toBe(200);
    const { terminalToken, role, isTerminalOnly } = provisionRes.json();
    expect(terminalToken).toBeDefined();
    expect(role).toBe('TERMINAL');
    expect(isTerminalOnly).toBe(true);

    // 2. Crear una solicitud de cuenta con saldo para Mesa 10
    const call = await CallService.createCall({
      sessionToken: session1.token,
      type: CallType.BILL,
      paymentMethod: PaymentMethod.CASH,
      origin: CallOrigin.WEB_DIRECT
    });

    // 3. Consultar service-workspace con la credencial de terminal
    const workspaceRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${terminalToken}` }
    });

    expect(workspaceRes.statusCode).toBe(200);
    const workspaceData = workspaceRes.json();
    expect(workspaceData.tasks).toBeDefined();
    // La lista de cuentas sensibles y saldos no se exponen en pantalla desatendida
    expect(workspaceData.accounts).toEqual([]);
    const billTask = workspaceData.tasks.find((t: any) => t.targetId === call.id);
    expect(billTask).toBeDefined();
    expect(billTask.summary).toBe('Solicita cuenta');
    expect(billTask.payload.balanceMinor).toBeUndefined();

    // 4. Intentar mutar (tomar la tarea con "Voy") usando sólo la credencial de terminal sin mozo autenticado
    const claimRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/service/tasks/CALL/${call.id}/claim`,
      headers: { authorization: `Bearer ${terminalToken}` }
    });

    // Debe ser rechazado con 403 OPERATOR_PIN_REQUIRED
    expect(claimRes.statusCode).toBe(403);
    expect(claimRes.json()).toMatchObject({
      error: 'FORBIDDEN',
      code: 'OPERATOR_PIN_REQUIRED',
      message: expect.stringContaining('requiere un operador autenticado con PIN')
    });
  });

  it('bloquea estrictamente tokens temporales contra endpoints administrativos y contra mesas distintas (S13)', async () => {
    // 1. Obtener token temporal específico para Mesa 10
    const tempLoginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '9999',
        isTemporary: true,
        purpose: 'CASH_COLLECT',
        tableId: table1.id
      }
    });

    expect(tempLoginRes.statusCode).toBe(200);
    const { token: tempToken, isTemporary, expiresInSeconds } = tempLoginRes.json();
    expect(isTemporary).toBe(true);
    expect(expiresInSeconds).toBe(300);

    // 2. Intentar usar el token temporal para acceder a la lista de personal de administración
    const adminRes = await app.inject({
      method: 'GET',
      url: `/v1/staff?restaurantId=${restaurantId}`,
      headers: { authorization: `Bearer ${tempToken}` }
    });

    // Debe ser rechazado con 403 TEMPORARY_TOKEN_NOT_ALLOWED
    expect(adminRes.statusCode).toBe(403);
    expect(adminRes.json()).toMatchObject({
      error: 'FORBIDDEN',
      code: 'TEMPORARY_TOKEN_NOT_ALLOWED'
    });

    // 3. Intentar usar el token temporal creado para Mesa 10 contra Mesa 20
    const mismatchRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/service/tasks/CALL/call-fake/act`,
      headers: { authorization: `Bearer ${tempToken}` },
      payload: { tableId: table2.id, action: 'CONFIRM_PAYMENT' }
    });

    expect(mismatchRes.statusCode).toBe(403);
    expect(mismatchRes.json()).toMatchObject({
      error: 'FORBIDDEN',
      code: 'TOKEN_SCOPE_MISMATCH'
    });
  });

  it('garantiza la atribución inmutable de peticiones concurrentes y cambio de mozo (S07)', async () => {
    // 1. Mozo A y Mozo B se autentican
    const loginA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug, pin: '1111', terminalId: 'tablet-shared-1' }
    });
    const tokenA = loginA.json().token;

    const loginB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug, pin: '2222', terminalId: 'tablet-shared-1' }
    });
    const tokenB = loginB.json().token;

    // 2. Crear llamado para Mesa 20
    const call2 = await CallService.createCall({
      sessionToken: session2.token,
      type: CallType.WAITER,
      paymentMethod: PaymentMethod.NOT_APPLICABLE,
      origin: CallOrigin.WEB_DIRECT
    });

    // 3. Mozo A toma la llamada (request en vuelo firmada por Mozo A)
    const claimA = await app.inject({
      method: 'POST',
      url: `/v1/staff/service/tasks/CALL/${call2.id}/claim`,
      headers: { authorization: `Bearer ${tokenA}` }
    });

    expect(claimA.statusCode).toBe(201);
    expect(claimA.json().staffUserId).toBe(waiterA.id);

    // 4. Aunque el tablet ahora tiene en pantalla a Mozo B, la tarea en DB pertenece a Mozo A
    const activeClaim = await prisma.serviceTaskClaim.findFirst({
      where: { targetId: call2.id }
    });
    expect(activeClaim?.staffUserId).toBe(waiterA.id);
  });

  it('invalida inmediatamente el acceso si el usuario es dado de baja o cambia de restaurante en DB', async () => {
    // 1. Crear mozo temporal y obtener token
    const ephemeralStaff = await StaffService.createStaff(restaurantId, 'Mozo Baja', '4321', 'WAITER');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug, pin: '4321' }
    });
    const ephemeralToken = loginRes.json().token;

    // 2. Comprobar que inicialmente el token es válido
    const validCheck = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${ephemeralToken}` }
    });
    expect(validCheck.statusCode).toBe(200);

    // 3. Dar de baja al mozo en DB
    await prisma.staffUser.delete({ where: { id: ephemeralStaff.id } });

    // 4. El token no vencido debe ser rechazado inmediatamente con 401
    const revokedCheck = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
      headers: { authorization: `Bearer ${ephemeralToken}` }
    });
    expect(revokedCheck.statusCode).toBe(401);
    expect(revokedCheck.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      message: expect.stringContaining('La identidad de personal ya no está vigente')
    });
  });
});
