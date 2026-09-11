import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { SalesReportsService } from '../src/services/sales-reports.service';
import { ReceiptService } from '../src/services/receipt.service';
import { FiscalService } from '../src/services/fiscal.service';

/**
 * Suite completa de verificación de los 15 escenarios del Plan
 * de Ventas, Cobros, Propinas, Tickets Informativos y Caja.
 */
describe('Plan Ventas, Cobros, Propinas y Tickets — Verificación de 15 Escenarios', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let otherRestaurant: any;
  let shift: any;
  let category: any;
  let managerToken: string;
  let otherManagerToken: string;
  let waiterUser: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Puerto Test',
        slug: `trattoria-test-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        timezone: 'America/Argentina/Buenos_Aires'
      }
    });

    otherRestaurant = await prisma.restaurant.create({
      data: {
        name: 'Otro Local Test',
        slug: `otro-test-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        timezone: 'America/Argentina/Buenos_Aires'
      }
    });

    shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, activeKey: restaurant.id }
    });

    category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'Platos Test', orderIndex: 0 }
    });

    await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Encargado Principal',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'MANAGER'
      }
    });

    waiterUser = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo Salon',
        pinHash: await bcrypt.hash('1234', 10),
        role: 'WAITER'
      }
    });

    await prisma.staffUser.create({
      data: {
        restaurantId: otherRestaurant.id,
        name: 'Encargado Otro Local',
        pinHash: await bcrypt.hash('8888', 10),
        role: 'MANAGER'
      }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: restaurant.slug, pin: '9999' }
    });
    managerToken = loginRes.json().token;

    const otherLoginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: otherRestaurant.slug, pin: '8888' }
    });
    otherManagerToken = otherLoginRes.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(ordersData: Array<{ name: string; price: number; status: OrderStatus }>) {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `M-${randomUUID().slice(0, 4)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_ORDER_CONFIRMED,
        capacity: 4
      }
    });

    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 3600 * 1000)
      }
    });

    for (const o of ordersData) {
      const item = await prisma.menuItem.create({
        data: { categoryId: category.id, name: o.name, price: o.price, isAvailable: true }
      });
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: o.status,
          totalAmount: o.price,
          totalAmountMinor: Math.round(o.price * 100),
          items: {
            create: [{ menuItemId: item.id, quantity: 1, unitPrice: o.price, addedByGuest: session.id }]
          }
        }
      });
    }

    return { table, session };
  }

  async function getAccount(sessionId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${(await prisma.tableSession.findUnique({ where: { id: sessionId } }))?.token}`
    });
    return res.json().account;
  }

  it('Escenario 1: Consumo $10.000 + propina $1.000 -> total $11.000 sin duplicar consumo', async () => {
    const { session } = await createSession([{ name: 'Entrecot', price: 100, status: OrderStatus.SERVED }]); // 100 pesos = 10000 minor
    const accountBefore = await getAccount(session.id);
    expect(accountBefore.consumoMinor).toBe(10000);
    expect(accountBefore.saldoMinor).toBe(10000);

    const settleRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc1-${randomUUID()}`,
        expectedAccountVersion: accountBefore.version,
        method: 'WAITER_CASH',
        amountMinor: 10000,
        tipMinor: 1000
      }
    });

    expect(settleRes.statusCode).toBe(201);
    const body = settleRes.json();
    expect(body.settlement.amountMinor).toBe(10000);
    expect(body.settlement.tipMinor).toBe(1000);
    expect(body.account.saldoMinor).toBe(0);
    expect(body.account.consumoMinor).toBe(10000);
    expect(body.account.tipMinor).toBe(1000);
  });

  it('Escenario 2: Pago mixto ($6.000 efectivo y $4.000 + $1.000 QR) -> suma $11.000 sin duplicar venta', async () => {
    const { session } = await createSession([{ name: 'Asado', price: 100, status: OrderStatus.SERVED }]);
    const acc1 = await getAccount(session.id);

    // Pago 1: 6000 efectivo
    const res1 = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc2-p1-${randomUUID()}`,
        expectedAccountVersion: acc1.version,
        method: 'WAITER_CASH',
        amountMinor: 6000,
        tipMinor: 0
      }
    });
    expect(res1.statusCode).toBe(201);

    // Pago 2: 4000 consumo + 1000 propina QR
    const acc2 = res1.json().account;
    const res2 = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc2-p2-${randomUUID()}`,
        expectedAccountVersion: acc2.version,
        method: 'WAITER_MP_QR',
        amountMinor: 4000,
        tipMinor: 1000
      }
    });
    expect(res2.statusCode).toBe(201);

    const summary = await SalesReportsService.getSalesSummary(restaurant.id, { period: 'TODAY' });
    const cashMethod = summary.byMethod.find((m) => m.method === 'WAITER_CASH');
    const qrMethod = summary.byMethod.find((m) => m.method === 'WAITER_MP_QR');

    expect(cashMethod?.totalMinor).toBeGreaterThanOrEqual(6000);
    expect(qrMethod?.totalMinor).toBeGreaterThanOrEqual(5000);
  });

  it('Escenario 3: Cliente pide efectivo, mozo confirma débito -> preferencia conservada y reporte usa débito', async () => {
    const { session } = await createSession([{ name: 'Vino', price: 50, status: OrderStatus.SERVED }]);

    // Cliente crea CallRequest de BILL con CASH
    await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'BILL',
        paymentMethod: 'CASH',
        tipMinor: 500,
        status: 'PENDING'
      }
    });

    const acc = await getAccount(session.id);
    const settleRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc3-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CARD_DEBIT',
        amountMinor: 5000,
        tipMinor: 500
      }
    });
    expect(settleRes.statusCode).toBe(201);
    expect(settleRes.json().settlement.method).toBe('WAITER_CARD_DEBIT');

    // La llamada conservó CASH en BD
    const callInDb = await prisma.callRequest.findFirst({
      where: { tableSessionId: session.id, type: 'BILL' }
    });
    expect(callInDb?.paymentMethod).toBe('CASH');
  });

  it('Escenario 4: Solicitud de cuenta sin cobro, comanda pendiente o borrador -> ingreso cero', async () => {
    const { session } = await createSession([{ name: 'Borrador', price: 80, status: OrderStatus.DRAFT }]);
    await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'BILL',
        paymentMethod: 'CASH',
        status: 'PENDING'
      }
    });

    const ops = await SalesReportsService.getSalesOperations(restaurant.id, { period: 'TODAY' });
    const op = ops.find((o) => o.tableSessionId === session.id);
    // Un borrador sin aceptar no cuenta como consumo confirmado ni cobrado
    expect(op?.cobradoTotalMinor || 0).toBe(0);
  });

  it('Escenario 5: Consumo y cobro con fechas distintas y corte de medianoche respetado', async () => {
    const range = SalesReportsService.resolveDateRange('America/Argentina/Buenos_Aires', { period: 'TODAY' });
    expect(range.dateFrom).toBeInstanceOf(Date);
    expect(range.dateTo).toBeInstanceOf(Date);
    expect(range.dateTo.getTime()).toBeGreaterThan(range.dateFrom.getTime());

    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const from = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
    const { session } = await createSession([{ name: 'Cuenta histórica', price: 100, status: OrderStatus.SERVED }]);
    const historicalAt = new Date(cutoff.getTime() - 60 * 60 * 1000);
    await prisma.tableSession.update({ where: { id: session.id }, data: { createdAt: historicalAt } });
    await prisma.order.updateMany({ where: { tableSessionId: session.id }, data: { createdAt: historicalAt } });

    const historicalSummary = await SalesReportsService.getSalesSummary(restaurant.id, {
      period: 'CUSTOM',
      dateFrom: from.toISOString(),
      dateTo: cutoff.toISOString()
    });
    expect(historicalSummary.pendienteAlCorteMinor).toBe(10000);
  });

  it('Escenario 6: Dos cobros parciales sobre la misma cuenta conservan una sola sesión contable', async () => {
    const { session } = await createSession([{ name: 'Plato Grande', price: 100, status: OrderStatus.SERVED }]);
    const acc1 = await getAccount(session.id);

    await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc6-1-${randomUUID()}`,
        expectedAccountVersion: acc1.version,
        method: 'WAITER_CASH',
        amountMinor: 4000
      }
    });

    const acc2 = await getAccount(session.id);
    await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc6-2-${randomUUID()}`,
        expectedAccountVersion: acc2.version,
        method: 'WAITER_CARD_CREDIT',
        amountMinor: 6000
      }
    });

    const ops = await SalesReportsService.getSalesOperations(restaurant.id, { period: 'TODAY' });
    const op = ops.find((o) => o.tableSessionId === session.id);
    expect(op).toBeDefined();
    expect(op?.settlements.length).toBe(2);
    expect(op?.cobradoTotalMinor).toBe(10000);
  });

  it('Escenario 7: Doble toque y reintento con misma clave devuelve 200 replay sin duplicar', async () => {
    const { session } = await createSession([{ name: 'Postre', price: 30, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);
    const key = `sc7-${randomUUID()}`;

    const res1 = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: key,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 3000
      }
    });
    expect(res1.statusCode).toBe(201);

    const res2 = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: key,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 3000
      }
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().idempotentReplay).toBe(true);
  });

  it('Escenario 8: Propina deseleccionada no se cobra; propina cobrada no desaparece', async () => {
    const { session } = await createSession([{ name: 'Cafe', price: 20, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    // Mozo no envía tipMinor (o envía 0)
    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc8-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 2000,
        tipMinor: 0
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settlement.tipMinor).toBe(0);
  });

  it('Escenario 9: Devolución/Ajuste posterior resta del cobro neto y conserva trazabilidad', async () => {
    const { session } = await createSession([{ name: 'Trago', price: 40, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc9-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 4000,
        tipMinor: 500
      }
    });
    const settlementId = res.json().settlement.id;

    // Crear un ajuste parcial de $1000
    await prisma.paymentAdjustment.create({
      data: {
        settlementId,
        restaurantId: restaurant.id,
        amountMinor: 1000,
        tipMinor: 0,
        reason: 'Error de tipeo de mesa',
        adjustedBy: 'manager-test'
      }
    });

    const ops = await SalesReportsService.getSalesOperations(restaurant.id, { period: 'TODAY' });
    const op = ops.find((o) => o.tableSessionId === session.id);
    const st = op?.settlements.find((s) => s.settlementId === settlementId);
    expect(st?.amountMinor).toBe(3000); // 4000 - 1000 ajustado
  });

  it('Escenario 10: Cambiar precios del menú no altera los tickets ya emitidos', async () => {
    const { session } = await createSession([{ name: 'Pizza', price: 50, status: OrderStatus.SERVED }]);
    const rcpt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });

    expect(rcpt.snapshotData.consumoMinor).toBe(5000);

    // Cambiar precio en la carta
    await prisma.menuItem.updateMany({
      where: { name: 'Pizza' },
      data: { price: 200 }
    });

    // Reconsultar ticket
    const rcptAfter = await ReceiptService.getReceiptById(restaurant.id, rcpt.id);
    expect(rcptAfter.snapshotData.consumoMinor).toBe(5000); // Intacto
  });

  it('Escenario 11: Generación de PDF térmico 80mm genera buffer válido con leyenda no fiscal', async () => {
    const { session } = await createSession([{ name: 'Empanadas', price: 30, status: OrderStatus.SERVED }]);
    const rcpt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });

    const pdfBuffer = ReceiptService.generateThermalPdfBuffer(rcpt.snapshotData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.toString('latin1')).toContain('%PDF-1.4');
    expect(pdfBuffer.toString('latin1')).toContain('Comprobante informativo');
  });

  it('Escenario 12: Tarjeta histórica sin especificar WAITER_CARD se reporta como desconocida sin forzar débito', async () => {
    const { session } = await createSession([{ name: 'Pasta', price: 60, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc12-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CARD',
        amountMinor: 6000
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settlement.method).toBe('WAITER_CARD');

    const summary = await SalesReportsService.getSalesSummary(restaurant.id, { period: 'TODAY' });
    const legacyCard = summary.byMethod.find((m) => m.method === 'WAITER_CARD');
    const debitCard = summary.byMethod.find((m) => m.method === 'WAITER_CARD_DEBIT');
    expect(legacyCard?.totalMinor).toBeGreaterThanOrEqual(6000);
    // Débito conserva únicamente lo cobrado por débito en Escenario 3 ($5.500) sin mezclarse con la tarjeta histórica
    expect(debitCard?.totalMinor).toBe(5500);
  });

  it('Escenario 13: Reporte sin ventas devuelve ceros coherentes sin error', async () => {
    const summary = await SalesReportsService.getSalesSummary(otherRestaurant.id, { period: 'TODAY' });
    expect(summary.consumoConfirmadoMinor).toBe(0);
    expect(summary.totalRecibidoMinor).toBe(0);
    expect(summary.paymentsCount).toBe(0);
  });

  it('Escenario 14: Asociación de comprobante fiscal externo valida límite de cobertura', async () => {
    const { session } = await createSession([{ name: 'Milanesa', price: 100, status: OrderStatus.SERVED }]);

    // Creación válida
    const doc = await FiscalService.createFiscalAssociation({
      restaurantId: restaurant.id,
      docType: 'FACTURA_B',
      pointOfSale: 1,
      docNumber: `000${Date.now()}`.slice(-8),
      docDate: new Date().toISOString(),
      emitter: 'Trattoria Puerto SRL',
      totalMinor: 10000,
      coveredSessions: [{ tableSessionId: session.id, coveredMinor: 10000 }]
    });
    expect(doc.id).toBeDefined();

    const documentedSummary = await SalesReportsService.getSalesSummary(restaurant.id, {
      period: 'TODAY',
      hasFiscalDocument: true
    });
    expect(documentedSummary.consumoConfirmadoMinor).toBe(10000);
    const documentedOperations = await SalesReportsService.getSalesOperations(restaurant.id, {
      period: 'TODAY',
      hasFiscalDocument: true
    });
    expect(documentedOperations).toHaveLength(1);
    expect(documentedOperations[0].tableSessionId).toBe(session.id);

    await expect(
      FiscalService.createFiscalAssociation({
        restaurantId: restaurant.id,
        docType: 'OTRO',
        pointOfSale: 1,
        docNumber: `DUP-${Date.now()}`,
        docDate: new Date().toISOString(),
        emitter: 'Trattoria Puerto SRL',
        totalMinor: 100,
        coveredSessions: [{ tableSessionId: session.id, coveredMinor: 100 }]
      })
    ).rejects.toThrow('La cobertura supera el consumo disponible de la sesión');

    await expect(
      FiscalService.createFiscalAssociation({
        restaurantId: restaurant.id,
        docType: 'OTRO',
        pointOfSale: 1,
        docNumber: `FRACTION-${Date.now()}`,
        docDate: new Date().toISOString(),
        emitter: 'Trattoria Puerto SRL',
        totalMinor: 100.5,
        coveredSessions: [{ tableSessionId: session.id, coveredMinor: 100 }]
      })
    ).rejects.toThrow('Datos de comprobante fiscal inválidos');

    const foreignShift = await prisma.shift.create({
      data: { restaurantId: otherRestaurant.id, activeKey: `foreign-${randomUUID()}` }
    });
    const foreignTable = await prisma.table.create({
      data: {
        restaurantId: otherRestaurant.id,
        label: `F-${randomUUID().slice(0, 4)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_ORDER_CONFIRMED,
        capacity: 2
      }
    });
    const foreignSession = await prisma.tableSession.create({
      data: {
        tableId: foreignTable.id,
        shiftId: foreignShift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 3600 * 1000)
      }
    });
    await expect(
      FiscalService.createFiscalAssociation({
        restaurantId: restaurant.id,
        docType: 'OTRO',
        pointOfSale: 1,
        docNumber: `CROSS-${Date.now()}`,
        docDate: new Date().toISOString(),
        emitter: 'Trattoria Puerto SRL',
        totalMinor: 100,
        coveredSessions: [{ tableSessionId: foreignSession.id, coveredMinor: 100 }]
      })
    ).rejects.toThrow('Una o más sesiones no pertenecen al restaurante');

    // Error si cobertura excede el total
    await expect(
      FiscalService.createFiscalAssociation({
        restaurantId: restaurant.id,
        docType: 'FACTURA_A',
        pointOfSale: 1,
        docNumber: `999${Date.now()}`.slice(-8),
        docDate: new Date().toISOString(),
        emitter: 'Trattoria Puerto SRL',
        totalMinor: 5000,
        coveredSessions: [{ tableSessionId: session.id, coveredMinor: 8000 }]
      })
    ).rejects.toThrow('La suma de coberturas supera el total del comprobante');
  });

  it('Escenario 15: Acceso cruzado a tickets de otro restaurante es denegado (404/Tenant isolation)', async () => {
    const { session } = await createSession([{ name: 'Flan', price: 20, status: OrderStatus.SERVED }]);
    const rcpt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });

    // Intentar consultar con token de otro restaurante
    const crossRes = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${otherRestaurant.id}/receipts/${rcpt.id}`,
      headers: { authorization: `Bearer ${otherManagerToken}` }
    });
    expect(crossRes.statusCode).toBe(404);
  });

  it('Escenario 16: Cobro asigna responsibleStaffUserId al mozo que reclamó solicitud BILL por defecto', async () => {
    const { session } = await createSession([{ name: 'Ravioles', price: 40, status: OrderStatus.SERVED }]);

    // Crear llamado BILL de la sesión
    const billCall = await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'BILL',
        status: 'IN_PROGRESS',
        paymentMethod: 'CASH',
        tipMinor: 400
      }
    });

    // Mozo reclama la llamada
    await prisma.serviceTaskClaim.create({
      data: {
        taskKey: `CALL:${billCall.id}`,
        taskType: 'CALL',
        targetId: billCall.id,
        restaurantId: restaurant.id,
        staffUserId: waiterUser.id,
        status: 'ACTIVE'
      }
    });

    const acc = await getAccount(session.id);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc16-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 4000
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Debe haber heredado el staffUserId del mozo que tomó la llamada
    expect(body.settlement.responsibleStaffUserId).toBe(waiterUser.id);
  });

  it('Escenario 17: Edición explícita de responsibleStaffUserId tiene precedencia sobre el claim', async () => {
    const { session } = await createSession([{ name: 'Sorrentinos', price: 50, status: OrderStatus.SERVED }]);
    const alternateWaiter = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo Alternativo',
        pinHash: await bcrypt.hash('2345', 10),
        role: 'WAITER'
      }
    });

    const billCall = await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'BILL',
        status: 'IN_PROGRESS',
        paymentMethod: 'CASH',
        tipMinor: 0
      }
    });

    await prisma.serviceTaskClaim.create({
      data: {
        taskKey: `CALL:${billCall.id}`,
        taskType: 'CALL',
        targetId: billCall.id,
        restaurantId: restaurant.id,
        staffUserId: waiterUser.id,
        status: 'ACTIVE'
      }
    });

    const acc = await getAccount(session.id);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc17-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 5000,
        responsibleStaffUserId: alternateWaiter.id
      }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().settlement.responsibleStaffUserId).toBe(alternateWaiter.id);

    const foreignWaiter = await prisma.staffUser.create({
      data: {
        restaurantId: otherRestaurant.id,
        name: 'Mozo de Otro Local',
        pinHash: await bcrypt.hash('3456', 10),
        role: 'WAITER'
      }
    });
    const { session: tenantSession } = await createSession([{ name: 'Tiramisú', price: 20, status: OrderStatus.SERVED }]);
    const tenantAccount = await getAccount(tenantSession.id);
    const invalidResponsible = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${tenantSession.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc17-foreign-${randomUUID()}`,
        expectedAccountVersion: tenantAccount.version,
        method: 'WAITER_CASH',
        amountMinor: 2000,
        responsibleStaffUserId: foreignWaiter.id
      }
    });
    expect(invalidResponsible.statusCode).toBe(422);
    expect(invalidResponsible.json().code).toBe('INVALID_RESPONSIBLE_STAFF');
  });

  it('Escenario 18: Fallback al operador autenticado si no hay claim de llamada BILL', async () => {
    const { session } = await createSession([{ name: 'Postre', price: 30, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc18-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 3000
      }
    });

    expect(res.statusCode).toBe(201);
    const settlement = res.json().settlement;
    // Debe haber hecho fallback al staffUserId del operador autenticado
    expect(settlement.responsibleStaffUserId).toBe(settlement.createdBy);
  });

  it('Escenario 19: Registro de PaymentAdjustment exitoso reduce total cobrado en resumen y preserva settlement', async () => {
    const { session } = await createSession([{ name: 'Parrillada', price: 100, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    const settleRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc19-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 10000,
        tipMinor: 1000
      }
    });
    expect(settleRes.statusCode).toBe(201);
    const settlementId = settleRes.json().settlement.id;

    // Resumen antes del ajuste
    const summaryBefore = await SalesReportsService.getSalesSummary(restaurant.id, { period: 'TODAY' });

    // Registrar devolución parcial de $20.00 de consumo y $5.00 de propina
    const adjRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: 2000,
        tipMinor: 500,
        reason: 'Plato devuelto por comensal y propina reducida'
      }
    });

    expect(adjRes.statusCode).toBe(201);
    const adjustment = adjRes.json();
    expect(adjustment.amountMinor).toBe(2000);
    expect(adjustment.tipMinor).toBe(500);
    expect(adjustment.totalAdjustedMinor).toBe(2500);
    expect(adjustment.reason).toContain('Plato devuelto');

    // Verificar que el settlement original sigue existiendo sin modificaciones destructivas
    const originalSettlement = await prisma.accountSettlement.findUnique({
      where: { id: settlementId }
    });
    expect(originalSettlement).toBeDefined();
    expect(originalSettlement?.amountMinor).toBe(10000);
    expect(originalSettlement?.tipMinor).toBe(1000);

    // Resumen después del ajuste: debe reflejar el descuento de 2000 en consumo cobrado y 500 en propinas
    const summaryAfter = await SalesReportsService.getSalesSummary(restaurant.id, { period: 'TODAY' });
    expect(summaryAfter.consumoCobradoMinor).toBe(summaryBefore.consumoCobradoMinor - 2000);
    expect(summaryAfter.propinasCobradasMinor).toBe(summaryBefore.propinasCobradasMinor - 500);
    expect(summaryAfter.pendienteAlCorteMinor).toBe(summaryBefore.pendienteAlCorteMinor + 2000);
  });

  it('Escenario 20: PaymentAdjustment rechaza importes excesivos, importes negativos y tenant ajeno', async () => {
    const { session } = await createSession([{ name: 'Vino', price: 40, status: OrderStatus.SERVED }]);
    const acc = await getAccount(session.id);

    const settleRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc20-${randomUUID()}`,
        expectedAccountVersion: acc.version,
        method: 'WAITER_CASH',
        amountMinor: 4000,
        tipMinor: 200
      }
    });
    const settlementId = settleRes.json().settlement.id;

    // 1. Exceso sobre consumo cobrado ($50 > $40)
    const excessAmtRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: 5000,
        tipMinor: 0,
        reason: 'Exceso'
      }
    });
    expect(excessAmtRes.statusCode).toBe(422);
    expect(excessAmtRes.json().code).toBe('ADJUSTMENT_EXCEEDS_SETTLEMENT');

    // 2. Exceso sobre propina ($3 > $2)
    const excessTipRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: 1000,
        tipMinor: 300,
        reason: 'Exceso propina'
      }
    });
    expect(excessTipRes.statusCode).toBe(422);
    expect(excessTipRes.json().code).toBe('ADJUSTMENT_EXCEEDS_TIP');

    // 3. Montos negativos o cero sin motivo
    const invalidAmtRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: -100,
        reason: 'Negativo'
      }
    });
    expect(invalidAmtRes.statusCode).toBe(400);

    const fractionalAmtRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: 100.5,
        reason: 'Fracción inválida'
      }
    });
    expect(fractionalAmtRes.statusCode).toBe(400);

    const stringAmtRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: '100',
        reason: 'String inválido'
      }
    });
    expect(stringAmtRes.statusCode).toBe(400);

    const nanAmtRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: NaN,
        reason: 'NaN inválido'
      }
    });
    expect(nanAmtRes.statusCode).toBe(400);

    const emptyReasonRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        amountMinor: 500,
        reason: '   '
      }
    });
    expect(emptyReasonRes.statusCode).toBe(400);

    // 4. Intento de ajuste cruzado desde otro restaurante
    const crossTenantRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/restaurants/${otherRestaurant.id}/sales/settlements/${settlementId}/adjustments`,
      headers: { authorization: `Bearer ${otherManagerToken}` },
      payload: {
        amountMinor: 1000,
        reason: 'Cross'
      }
    });
    expect(crossTenantRes.statusCode).toBe(404);
  });

  it('Escenario 21: Ticket PRE_BILL_DETAIL incluye propina solicitada, hash de contenido y reimpresión idéntica', async () => {
    const { session } = await createSession([{ name: 'Postre Vigilante', price: 25, status: OrderStatus.SERVED }]);

    // Crear llamado de cuenta con propina solicitada de $3.00
    await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'BILL',
        status: 'PENDING',
        paymentMethod: 'CASH',
        tipMinor: 300
      }
    });

    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });

    expect(receipt.receiptType).toBe('PRE_BILL_DETAIL');
    expect(receipt.contentHash).toBeDefined();
    expect(receipt.snapshotData.requestedTipMinor).toBe(300);
    expect(receipt.snapshotData.tipMinor).toBe(300);
    expect(receipt.snapshotData.totalMinor).toBe(2800); // 2500 + 300

    // Reimpresión con la misma clave: debe devolver el mismo ID y el mismo contentHash sin duplicar
    const reprint = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });
    expect(reprint.id).toBe(receipt.id);
    expect(reprint.contentHash).toBe(receipt.contentHash);

    // El DTO retornado no debe exponer el data-URI ni el blob binario del PDF
    expect(receipt.pdfPath).toBeNull();
    expect((receipt as any).pdfData).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain('data:application/pdf;base64');
    expect(reprint.pdfPath).toBeNull();
    expect((reprint as any).pdfData).toBeUndefined();

    // Generar PDF térmico
    const pdf = ReceiptService.generateThermalPdfBuffer(receipt.snapshotData);
    expect(pdf.subarray(0, 8).toString()).toContain('%PDF-1.4');

    const persisted = await prisma.receiptSnapshot.findUnique({
      where: { id: receipt.id },
      select: { snapshotData: true, pdfPath: true }
    });
    const persistedSnapshot = JSON.parse(persisted?.snapshotData || '{}');
    expect(persistedSnapshot.contentHash).toBe(receipt.contentHash);
    expect(persisted?.pdfPath).toMatch(/^data:application\/pdf;base64,/);
    expect(Buffer.from(persisted!.pdfPath!.slice('data:application/pdf;base64,'.length), 'base64')).toEqual(pdf);
    const persistedExtended = await prisma.$queryRaw<Array<{ contentHash: string | null; pdfVersion: number; pdfData: Buffer | null }>>`
      SELECT "contentHash", "pdfVersion", "pdfData"
      FROM "ReceiptSnapshot"
      WHERE "id" = ${receipt.id}
    `;
    expect(persistedExtended[0]?.contentHash).toBe(receipt.contentHash);
    expect(persistedExtended[0]?.pdfVersion).toBe(1);
    expect(Buffer.from(persistedExtended[0]?.pdfData || Buffer.alloc(0))).toEqual(pdf);

    // La reimpresión debe ser idéntica aun sin el caché en memoria.
    ReceiptService.clearPdfCache();
    const reprintedPdf = await ReceiptService.getReceiptPdfBuffer(restaurant.id, receipt.id);
    expect(Buffer.compare(pdf, reprintedPdf)).toBe(0);
  });

  it('Escenario 22: Descarga de Resumen PDF en A4 contiene dimensiones estándar, leyenda no fiscal y datos del local', async () => {
    const pdfRes = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/summary/pdf?period=TODAY`,
      headers: { authorization: `Bearer ${managerToken}` }
    });

    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.headers['content-disposition']).toContain('resumen-ventas');

    const pdfBuffer = pdfRes.rawPayload;
    const pdfString = pdfBuffer.toString('latin1');
    expect(pdfString).toContain('%PDF-1.4');
    expect(pdfString).toContain('595 842'); // Dimensiones A4 en puntos
    expect(pdfString).toContain('Comprobante informativo');
    expect(pdfString).toContain('No válido como factura');
  });

  it('Escenario 23: Comprobante de pago identifica el settlement y no mezcla pagos parciales', async () => {
    const { session } = await createSession([{ name: 'Café de cierre', price: 60, status: OrderStatus.SERVED }]);
    const account = await getAccount(session.id);
    const settlementResponse = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc23-${randomUUID()}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        amountMinor: 6000,
        tipMinor: 600
      }
    });
    expect(settlementResponse.statusCode).toBe(201);
    const settlementId = settlementResponse.json().settlement.id;

    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      settlementId,
      receiptType: 'PAYMENT_RECEIPT'
    });

    expect(receipt.snapshotData.settlementId).toBe(settlementId);
    expect(receipt.snapshotData.payments).toHaveLength(1);
    expect(receipt.snapshotData.payments[0].settlementId).toBe(settlementId);
    expect(receipt.snapshotData.payments[0].totalMinor).toBe(6600);
    expect(receipt.snapshotData.paymentTotalMinor).toBe(6600);
  });

  it('Escenario 24: CSV exporta metadatos de rango, medio, responsable, ajustes y tickets', async () => {
    const { session } = await createSession([{ name: 'Exportable', price: 35, status: OrderStatus.SERVED }]);
    const account = await getAccount(session.id);
    const settlementResponse = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: `sc24-${randomUUID()}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CARD_DEBIT',
        amountMinor: 3500,
        tipMinor: 350
      }
    });
    expect(settlementResponse.statusCode).toBe(201);

    const csvResponse = await app.inject({
      method: 'GET',
      url: `/v1/admin/restaurants/${restaurant.id}/sales/export/csv?period=TODAY&paymentMethod=WAITER_CARD_DEBIT`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(csvResponse.statusCode).toBe(200);
    expect(csvResponse.headers['content-type']).toContain('text/csv');
    const csv = csvResponse.rawPayload.toString('utf8');
    expect(csv).toContain('restaurantId,currency,timezone,periodFrom,periodTo');
    expect(csv).toContain('WAITER_CARD_DEBIT');
    expect(csv).toContain('responsables');
    expect(csv).toContain('pagosDetalle');
  });
});
