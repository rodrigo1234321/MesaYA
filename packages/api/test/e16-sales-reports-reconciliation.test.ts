import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { SalesReportsService } from '../src/services/sales-reports.service';

/**
 * E16 — S22: conciliación ventas/consumo, cobros netos, propinas, saldo,
 * ajustes/devoluciones y turno/jornada.
 *
 * Fixture sintética de fechas fijas (zona America/Argentina/Buenos_Aires,
 * UTC−03 en enero, sin DST):
 * - Día 1 (2026-01-10): pedido 23:30 (consumo $100 + $30, createdAt original).
 * - Día 2 (2026-01-11): pago 01:15 (settlement $100 + $10 propina, WAITER_CASH)
 *   y pago legacy 01:20 ($30 + $3, método digital sin responsable).
 * - Día 3 (2026-01-12): devolución 10:00 ($20 consumo + $5 propina).
 * - Turno noche: abierto día 1 22:00 → cerrado día 2 06:00 (cruza medianoche).
 *
 * Oráculo: SUMs SQL independientes + aritmética explícita; el resumen, el
 * detalle de operaciones, el CSV y el PDF deben reflejar el mismo concepto.
 */
describe('E16 S22 — conciliación de ventas, cobros, devoluciones y turno', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let otherRestaurant: any;
  let nightShift: any;
  let session: any;
  let managerToken: string;
  let waiterUser: any;
  let otherWaiter: any;

  // Instantes UTC fijos (local = UTC−03).
  const D1_START = '2026-01-10T03:00:00.000Z'; // día 1 00:00 local
  const D2_START = '2026-01-11T03:00:00.000Z'; // día 2 00:00 local
  const D3_START = '2026-01-12T03:00:00.000Z'; // día 3 00:00 local
  const D4_START = '2026-01-14T03:00:00.000Z'; // fin ventana amplia
  const ORDER1_AT = '2026-01-11T02:30:00.000Z'; // día 1 23:30 local
  const ORDER2_AT = '2026-01-11T02:45:00.000Z'; // día 1 23:45 local
  const SETTLE_AT = '2026-01-11T04:15:00.000Z'; // día 2 01:15 local
  const LEGACY_AT = '2026-01-11T04:20:00.000Z'; // día 2 01:20 local
  const ADJUST_AT = '2026-01-12T13:00:00.000Z'; // día 3 10:00 local
  const D5_START = '2026-01-15T03:00:00.000Z'; // día 5 00:00 local
  const D6_START = '2026-01-16T03:00:00.000Z'; // día 6 00:00 local
  const HISTORICAL_ADJUST_AT = '2026-01-15T04:00:00.000Z'; // día 5 01:00 local

  const CONSUMO_1 = 10000;
  const CONSUMO_2 = 3000;
  const TIP_SETTLE = 1000;
  const TIP_LEGACY = 300;
  const ADJ_CONSUMO = 2000;
  const ADJ_TIP = 500;

  const dayRange = (from: string, to: string) => ({ period: 'CUSTOM' as const, dateFrom: from, dateTo: to });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'E16 Conciliación Test',
        slug: `e16-conciliacion-${Date.now()}-${randomUUID().slice(0, 6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        timezone: 'America/Argentina/Buenos_Aires'
      }
    });
    otherRestaurant = await prisma.restaurant.create({
      data: {
        name: 'E16 Otro Local',
        slug: `e16-otro-${Date.now()}-${randomUUID().slice(0, 6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#0ea5e9',
        timezone: 'America/Argentina/Buenos_Aires'
      }
    });

    // Turno noche que cruza medianoche: día 1 22:00 → día 2 06:00 local.
    nightShift = await prisma.shift.create({
      data: {
        restaurantId: restaurant.id,
        activeKey: null,
        openedAt: new Date('2026-01-11T01:00:00.000Z'),
        closedAt: new Date('2026-01-11T09:00:00.000Z')
      }
    });

    await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Encargado E16',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'MANAGER'
      }
    });
    waiterUser = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo E16',
        pinHash: await bcrypt.hash('1234', 10),
        role: 'WAITER'
      }
    });
    otherWaiter = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo E16 B',
        pinHash: await bcrypt.hash('2345', 10),
        role: 'WAITER'
      }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: restaurant.slug, pin: '9999' }
    });
    expect(loginRes.statusCode).toBe(200);
    managerToken = loginRes.json().token;

    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `E16-${randomUUID().slice(0, 4)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_ORDER_CONFIRMED,
        capacity: 4
      }
    });
    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: nightShift.id,
        token: randomUUID(),
        expiresAt: new Date('2026-01-12T03:00:00.000Z'),
        createdAt: new Date('2026-01-11T02:00:00.000Z')
      }
    });

    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'E16 Test', orderIndex: 0 }
    });
    const item1 = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'E16 Plato', price: 100, isAvailable: true }
    });
    const item2 = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'E16 Bebida', price: 30, isAvailable: true }
    });
    const order1 = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: 100,
        totalAmountMinor: CONSUMO_1,
        createdAt: new Date(ORDER1_AT),
        items: { create: [{ menuItemId: item1.id, quantity: 1, unitPrice: 100, addedByGuest: session.id }] }
      }
    });
    await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: 30,
        totalAmountMinor: CONSUMO_2,
        createdAt: new Date(ORDER2_AT),
        items: { create: [{ menuItemId: item2.id, quantity: 1, unitPrice: 30, addedByGuest: session.id }] }
      }
    });

    // Cobro de salón día 2 01:15 (vía AccountSettlement).
    await prisma.accountSettlement.create({
      data: {
        tableSessionId: session.id,
        restaurantId: restaurant.id,
        method: 'WAITER_CASH',
        amountMinor: CONSUMO_1,
        tipMinor: TIP_SETTLE,
        accountVersion: `e16-v1-${randomUUID()}`,
        idempotencyKey: `e16-settle-${randomUUID()}`,
        createdBy: waiterUser.id,
        responsibleStaffUserId: waiterUser.id,
        createdAt: new Date(SETTLE_AT)
      }
    });
    // Pago digital legacy día 2 01:20 (vía histórica, sin responsable).
    await prisma.paymentTransaction.create({
      data: {
        orderId: order1.id,
        tableSessionId: session.id,
        guestSessionId: `e16-guest-${randomUUID()}`,
        method: 'DIGITAL_MP_FULL',
        amount: 30,
        amountMinor: CONSUMO_2,
        tipAmount: 3,
        tipAmountMinor: TIP_LEGACY,
        status: 'APPROVED',
        idempotencyKey: `e16-legacy-${randomUUID()}`,
        createdAt: new Date(LEGACY_AT)
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('S22.1: createdAt original preservado — la orden no se mueve al día de pago', async () => {
    const orders = await prisma.order.findMany({
      where: { tableSessionId: session.id },
      orderBy: { createdAt: 'asc' }
    });
    expect(orders).toHaveLength(2);
    expect(orders[0].createdAt.toISOString()).toBe(ORDER1_AT);
    expect(orders[1].createdAt.toISOString()).toBe(ORDER2_AT);

    const settlement = await prisma.accountSettlement.findFirst({
      where: { tableSessionId: session.id }
    });
    expect(settlement?.createdAt.toISOString()).toBe(SETTLE_AT);
  });

  it('S22.2: día 1 — consumo devengado $130, sin cobros, pendiente íntegro', async () => {
    const summary = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D1_START, D2_START)
    );
    expect(summary.consumoConfirmadoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    expect(summary.consumoCobradoMinor).toBe(0);
    expect(summary.propinasCobradasMinor).toBe(0);
    expect(summary.devolucionesMinor).toBe(0);
    expect(summary.totalRecibidoMinor).toBe(0);
    // Sesión abierta al corte del día 1 con consumo impago.
    expect(summary.pendienteAlCorteMinor).toBe(CONSUMO_1 + CONSUMO_2);
  });

  it('S22.3: día 2 — caja por fecha de pago; ventas NO forzadas a igualar caja', async () => {
    const summary = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D2_START, D3_START)
    );
    // El consumo es del día 1: el día 2 no registra ventas devengadas.
    expect(summary.consumoConfirmadoMinor).toBe(0);
    // Cobros del día 2: settlement + legacy.
    expect(summary.consumoCobradoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    expect(summary.propinasCobradasMinor).toBe(TIP_SETTLE + TIP_LEGACY);
    expect(summary.devolucionesMinor).toBe(0);
    expect(summary.totalRecibidoMinor).toBe(CONSUMO_1 + CONSUMO_2 + TIP_SETTLE + TIP_LEGACY);

    const cash = summary.byMethod.find((m) => m.method === 'WAITER_CASH');
    expect(cash?.consumoMinor).toBe(CONSUMO_1);
    expect(cash?.tipMinor).toBe(TIP_SETTLE);
    const legacy = summary.byMethod.find((m) => m.method === 'DIGITAL_MP_FULL');
    expect(legacy?.consumoMinor).toBe(CONSUMO_2);
    expect(legacy?.tipMinor).toBe(TIP_LEGACY);
  });

  it('S22.4: devolución posterior no reescribe el día del cobro; concilia en rango amplio', async () => {
    const before = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D2_START, D3_START)
    );

    await prisma.paymentAdjustment.create({
      data: {
        settlementId: (await prisma.accountSettlement.findFirst({
          where: { tableSessionId: session.id }
        }))!.id,
        restaurantId: restaurant.id,
        amountMinor: ADJ_CONSUMO,
        tipMinor: ADJ_TIP,
        reason: 'E16: plato devuelto día 3',
        adjustedBy: waiterUser.id,
        createdAt: new Date(ADJUST_AT)
      }
    });

    // El resumen del día 2 queda intacto (política por fecha propia del ajuste).
    const after = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D2_START, D3_START)
    );
    expect(after.consumoCobradoMinor).toBe(before.consumoCobradoMinor);
    expect(after.propinasCobradasMinor).toBe(before.propinasCobradasMinor);
    expect(after.devolucionesMinor).toBe(0);

    // Rango amplio día 1–día 4: neto exacto tras la devolución.
    const wide = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D1_START, D4_START)
    );
    expect(wide.consumoConfirmadoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    expect(wide.consumoCobradoMinor).toBe(CONSUMO_1 + CONSUMO_2 - ADJ_CONSUMO);
    expect(wide.propinasCobradasMinor).toBe(TIP_SETTLE + TIP_LEGACY - ADJ_TIP);
    expect(wide.devolucionesMinor).toBe(ADJ_CONSUMO + ADJ_TIP);
    expect(wide.totalRecibidoMinor).toBe(
      CONSUMO_1 + CONSUMO_2 - ADJ_CONSUMO + (TIP_SETTLE + TIP_LEGACY - ADJ_TIP)
    );
  });

  it('S22.5: turno que cruza medianoche — ventana íntegra con etiqueta explícita', async () => {
    const summary = await SalesReportsService.getSalesSummary(restaurant.id, {
      shiftId: nightShift.id
    });
    // Turno 22:00→06:00: contiene pedidos, cobro y legacy; excluye la
    // devolución del día 3 (fecha propia posterior).
    expect(summary.consumoConfirmadoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    expect(summary.consumoCobradoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    expect(summary.propinasCobradasMinor).toBe(TIP_SETTLE + TIP_LEGACY);
    expect(summary.devolucionesMinor).toBe(0);
    expect(summary.totalRecibidoMinor).toBe(CONSUMO_1 + CONSUMO_2 + TIP_SETTLE + TIP_LEGACY);
    expect(summary.shiftId).toBe(nightShift.id);
    expect(summary.shiftLabel).toContain('Turno');
    expect(summary.shiftClosedAt).not.toBeNull();
  });

  it('S22.6: oráculo aritmético/SQL independiente + detalle de operaciones', async () => {
    const from = new Date(D1_START);
    const to = new Date(D4_START);

    const consumoRows = await prisma.$queryRaw<Array<{ total: number | bigint }>>`
      SELECT COALESCE(SUM(o."totalAmountMinor"), 0) AS total
      FROM "Order" o
      JOIN "TableSession" s ON s."id" = o."tableSessionId"
      JOIN "Table" t ON t."id" = s."tableId"
      WHERE t."restaurantId" = ${restaurant.id}
        AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
        AND o."status" IN ('CONFIRMED','IN_KITCHEN','READY_TO_SERVE','SERVED','PAID')
    `;
    const settleRows = await prisma.$queryRaw<Array<{ consumo: number | bigint; propina: number | bigint }>>`
      SELECT COALESCE(SUM("amountMinor"), 0) AS consumo, COALESCE(SUM("tipMinor"), 0) AS propina
      FROM "AccountSettlement"
      WHERE "restaurantId" = ${restaurant.id}
        AND "createdAt" >= ${from} AND "createdAt" < ${to}
    `;
    const legacyRows = await prisma.$queryRaw<Array<{ consumo: number | bigint; propina: number | bigint }>>`
      SELECT COALESCE(SUM("amountMinor"), 0) AS consumo, COALESCE(SUM("tipAmountMinor"), 0) AS propina
      FROM "PaymentTransaction" p
      JOIN "Order" o ON o."id" = p."orderId"
      JOIN "TableSession" s ON s."id" = p."tableSessionId"
      JOIN "Table" t ON t."id" = s."tableId"
      WHERE t."restaurantId" = ${restaurant.id}
        AND p."createdAt" >= ${from} AND p."createdAt" < ${to}
        AND p."status" IN ('APPROVED','MANUAL_SETTLED')
    `;
    const adjustRows = await prisma.$queryRaw<Array<{ consumo: number | bigint; propina: number | bigint }>>`
      SELECT COALESCE(SUM(a."amountMinor"), 0) AS consumo, COALESCE(SUM(a."tipMinor"), 0) AS propina
      FROM "PaymentAdjustment" a
      JOIN "AccountSettlement" st ON st."id" = a."settlementId"
      WHERE a."restaurantId" = ${restaurant.id}
        AND a."createdAt" >= ${from} AND a."createdAt" < ${to}
        AND st."createdAt" >= ${from} AND st."createdAt" < ${to}
    `;

    const oracleConsumo = Number(consumoRows[0].total);
    const oracleCobradoBruto = Number(settleRows[0].consumo) + Number(legacyRows[0].consumo);
    const oraclePropinaBruta = Number(settleRows[0].propina) + Number(legacyRows[0].propina);
    const oracleDevol = Number(adjustRows[0].consumo) + Number(adjustRows[0].propina);

    expect(oracleConsumo).toBe(CONSUMO_1 + CONSUMO_2);
    expect(oracleCobradoBruto).toBe(CONSUMO_1 + CONSUMO_2);
    expect(oracleDevol).toBe(ADJ_CONSUMO + ADJ_TIP);

    const summary = await SalesReportsService.getSalesSummary(
      restaurant.id,
      dayRange(D1_START, D4_START)
    );
    expect(summary.consumoConfirmadoMinor).toBe(oracleConsumo);
    expect(summary.consumoCobradoMinor).toBe(oracleCobradoBruto - Number(adjustRows[0].consumo));
    expect(summary.propinasCobradasMinor).toBe(oraclePropinaBruta - Number(adjustRows[0].propina));
    expect(summary.devolucionesMinor).toBe(oracleDevol);
    expect(summary.totalRecibidoMinor).toBe(
      summary.consumoCobradoMinor + summary.propinasCobradasMinor
    );

    // El detalle suma lo mismo que el resumen (misma semántica de período).
    const ops = await SalesReportsService.getSalesOperations(
      restaurant.id,
      dayRange(D1_START, D4_START)
    );
    const op = ops.find((o) => o.tableSessionId === session.id);
    expect(op).toBeDefined();
    expect(ops.reduce((s, o) => s + o.consumoTotalMinor, 0)).toBe(summary.consumoConfirmadoMinor);
    expect(ops.reduce((s, o) => s + o.cobradoTotalMinor, 0)).toBe(summary.consumoCobradoMinor);
    expect(ops.reduce((s, o) => s + o.propinaTotalMinor, 0)).toBe(summary.propinasCobradasMinor);
    expect(ops.reduce((s, o) => s + o.devolucionTotalMinor, 0)).toBe(summary.devolucionesMinor);
    // Saldo vivo: la devolución reabrió $20 de deuda sobre la cuenta completa.
    expect(op?.saldoMinor).toBe(ADJ_CONSUMO);
  });

  it('S22.7: filtros de medio, responsable y comprobante fiscal', async () => {
    const range = dayRange(D2_START, D3_START);

    const cashOnly = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      paymentMethod: 'WAITER_CASH'
    });
    expect(cashOnly.consumoCobradoMinor).toBe(CONSUMO_1);
    expect(cashOnly.propinasCobradasMinor).toBe(TIP_SETTLE);

    const unknownMethod = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      paymentMethod: 'WAITER_TRANSFER'
    });
    // Cero verdadero del filtro, sin error.
    expect(unknownMethod.consumoCobradoMinor).toBe(0);
    expect(unknownMethod.paymentsCount).toBe(0);

    const byWaiter = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      responsibleStaffUserId: waiterUser.id
    });
    expect(byWaiter.consumoCobradoMinor).toBe(CONSUMO_1);

    const byOther = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      responsibleStaffUserId: otherWaiter.id
    });
    expect(byOther.consumoCobradoMinor).toBe(0);

    const opsCash = await SalesReportsService.getSalesOperations(restaurant.id, {
      ...range,
      paymentMethod: 'WAITER_CASH'
    });
    expect(opsCash.some((o) => o.tableSessionId === session.id)).toBe(true);
    const opsTransfer = await SalesReportsService.getSalesOperations(restaurant.id, {
      ...range,
      paymentMethod: 'WAITER_TRANSFER'
    });
    expect(opsTransfer.some((o) => o.tableSessionId === session.id)).toBe(false);

    const noFiscal = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      hasFiscalDocument: false
    });
    expect(noFiscal.consumoCobradoMinor).toBe(CONSUMO_1 + CONSUMO_2);
    const withFiscal = await SalesReportsService.getSalesSummary(restaurant.id, {
      ...range,
      hasFiscalDocument: true
    });
    expect(withFiscal.consumoCobradoMinor).toBe(0);
  });

  it('S22.8: errores seguros — nunca falso cero (400 rango, 404 turno ajeno)', async () => {
    await expect(
      SalesReportsService.getSalesSummary(restaurant.id, {
        period: 'CUSTOM',
        dateFrom: D3_START,
        dateTo: D2_START
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DATE_RANGE' });

    const foreignShift = await prisma.shift.create({
      data: {
        restaurantId: otherRestaurant.id,
        activeKey: null,
        openedAt: new Date('2026-01-11T01:00:00.000Z'),
        closedAt: new Date('2026-01-11T09:00:00.000Z')
      }
    });
    await expect(
      SalesReportsService.getSalesSummary(restaurant.id, { shiftId: foreignShift.id })
    ).rejects.toMatchObject({ statusCode: 404, code: 'SHIFT_NOT_FOUND' });

    const httpBadRange = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/summary?period=CUSTOM&dateFrom=${D3_START}&dateTo=${D2_START}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(httpBadRange.statusCode).toBe(400);
    expect(httpBadRange.json().code).toBe('INVALID_DATE_RANGE');

    const httpForeignShift = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/summary?shiftId=${foreignShift.id}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(httpForeignShift.statusCode).toBe(404);
    expect(httpForeignShift.json().code).toBe('SHIFT_NOT_FOUND');
  });

  it('S22.9: CSV y PDF reflejan el mismo concepto del resumen', async () => {
    const query = `period=CUSTOM&dateFrom=${D1_START}&dateTo=${D4_START}`;

    const csvRes = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/export/csv?${query}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    const csv = csvRes.rawPayload.toString('utf8');
    // Etiquetas canónicas E16.
    expect(csv).toContain('cobradoNetoPesos');
    expect(csv).toContain('devolucionPesos');
    expect(csv).toContain('turno');
    // Fila de la sesión con importes netos del período: consumo 130.00,
    // cobrado neto 110.00, propina 8.00, devolución 25.00.
    expect(csv).toContain(session.id);
    expect(csv).toContain('130.00');
    expect(csv).toContain('110.00');
    expect(csv).toContain('25.00');

    const shiftCsvRes = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/export/csv?shiftId=${nightShift.id}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(shiftCsvRes.statusCode).toBe(200);
    expect(shiftCsvRes.rawPayload.toString('utf8')).toContain('Turno');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/summary/pdf?shiftId=${nightShift.id}`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    const pdfString = pdfRes.rawPayload.toString('latin1');
    expect(pdfString).toContain('%PDF-1.4');
    expect(pdfString).toContain('595 842');
    expect(pdfString).toContain('Comprobante informativo');
    expect(pdfString).toContain('No válido como factura');
    expect(pdfString).toContain('Devoluciones del período');
    expect(pdfString).toContain('DEVOLUCIÓN');
    // El turno y la devolución viajan explícitamente en el PDF.
    expect(pdfString).toContain('Turno');
  });

  it('S22.10: devolución de un cobro histórico aparece como salida neta del período', async () => {
    const historicalSettlement = await prisma.accountSettlement.create({
      data: {
        tableSessionId: session.id,
        restaurantId: restaurant.id,
        method: 'WAITER_CASH',
        amountMinor: 700,
        tipMinor: 100,
        accountVersion: `e16-historical-${randomUUID()}`,
        idempotencyKey: `e16-historical-${randomUUID()}`,
        createdBy: waiterUser.id,
        responsibleStaffUserId: waiterUser.id,
        createdAt: new Date(ORDER1_AT)
      }
    });
    await prisma.paymentAdjustment.create({
      data: {
        settlementId: historicalSettlement.id,
        restaurantId: restaurant.id,
        amountMinor: 500,
        tipMinor: 100,
        reason: 'E16: devolución posterior sobre cobro histórico',
        adjustedBy: waiterUser.id,
        createdAt: new Date(HISTORICAL_ADJUST_AT)
      }
    });

    const summary = await SalesReportsService.getSalesSummary(restaurant.id, dayRange(D5_START, D6_START));
    expect(summary.consumoConfirmadoMinor).toBe(0);
    expect(summary.consumoCobradoMinor).toBe(-500);
    expect(summary.propinasCobradasMinor).toBe(-100);
    expect(summary.devolucionesMinor).toBe(600);
    expect(summary.totalRecibidoMinor).toBe(-600);
    expect(summary.paymentsCount).toBe(0);

    const ops = await SalesReportsService.getSalesOperations(restaurant.id, dayRange(D5_START, D6_START));
    const op = ops.find((candidate) => candidate.tableSessionId === session.id);
    expect(op).toBeDefined();
    expect(op?.cobradoTotalMinor).toBe(-500);
    expect(op?.propinaTotalMinor).toBe(-100);
    expect(op?.devolucionTotalMinor).toBe(600);
    expect(op?.settlements).toHaveLength(1);
    expect(op?.settlements[0].amountMinor).toBe(-500);
    expect(op?.settlements[0].tipMinor).toBe(-100);
    expect(op?.settlements[0].adjustments).toHaveLength(1);
  });
});
