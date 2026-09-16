import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { ReceiptService } from '../src/services/receipt.service';

/**
 * E15 — Recibos atómicos y recuperables (S21 / H02).
 *
 * Unicidad e idempotencia bajo concurrencia real contra SQLite efímera del
 * runner (scripts/test-local.mjs): la concurrencia multi-conexión en
 * PostgreSQL queda como gate PENDING_CLOUD (ver reportes/E15.md).
 * No se tocan .env, bases persistentes ni seeds reales.
 */
describe('E15 — Recibos atómicos y recuperables (S21 / H02)', () => {
  let app: FastifyInstance;
  let categoryCtx: { restaurant: any; shift: any; item: any };

  const makeRestaurant = async (name: string) => {
    const restaurant = await prisma.restaurant.create({
      data: {
        name,
        slug: `e15-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        timezone: 'America/Argentina/Buenos_Aires'
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: `Carta E15 ${name}` }
    });
    const item = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Empanada E15', price: 1500, priceMinor: 150000, isAvailable: true }
    });
    return { restaurant, shift, item };
  };

  const makeSession = async (ctx: { restaurant: any; shift: any; item: any }, tableLabel: string) => {
    const table = await prisma.table.create({
      data: {
        restaurantId: ctx.restaurant.id,
        label: `${tableLabel}-${randomUUID().slice(0, 4)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_ORDER_CONFIRMED,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: ctx.shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 3600 * 1000)
      }
    });
    await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: 1500,
        totalAmountMinor: 150000,
        items: {
          create: [{
            menuItemId: ctx.item.id,
            quantity: 1,
            unitPrice: 1500,
            unitPriceMinor: 150000,
            addedByGuest: session.id
          }]
        }
      }
    });
    return { table, session };
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    categoryCtx = await makeRestaurant('Base');
  });

  afterAll(async () => {
    await app.close();
  });

  it('20 solicitudes concurrentes con claves distintas emiten 20 tickets con números únicos (sin 503)', async () => {
    const ctx = await makeRestaurant('ConcA');
    const { session } = await makeSession(ctx, 'E15-CA');
    const period = ReceiptService.receiptPeriod();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ReceiptService.getOrCreateReceipt({
          restaurantId: ctx.restaurant.id,
          tableSessionId: session.id,
          receiptType: 'PRE_BILL_DETAIL',
          idempotencyKey: `e15-conca-${randomUUID()}-${i}`
        })
      )
    );

    const ids = new Set(results.map((r) => r.id));
    const numbers = new Set(results.map((r) => r.receiptNumber));
    expect(ids.size).toBe(20);
    expect(numbers.size).toBe(20);
    for (const r of results) {
      expect(r.receiptNumber.startsWith(`TK-${period}-`)).toBe(true);
      expect(r.contentHash).toBeTruthy();
      expect(r.snapshotData.contentHash).toBe(r.contentHash);
      expect(r.snapshotData.receiptNumber).toBe(r.receiptNumber);
    }
    const persisted = await prisma.receiptSnapshot.count({
      where: { restaurantId: ctx.restaurant.id, receiptNumber: { startsWith: `TK-${period}-` } }
    });
    expect(persisted).toBe(20);
  });

  it('misma clave idempotente ×20 concurrente crea una sola fila y el replay es estable', async () => {
    const ctx = await makeRestaurant('ConcB');
    const { session } = await makeSession(ctx, 'E15-CB');
    const key = `e15-samekey-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        ReceiptService.getOrCreateReceipt({
          restaurantId: ctx.restaurant.id,
          tableSessionId: session.id,
          receiptType: 'PRE_BILL_DETAIL',
          idempotencyKey: key
        })
      )
    );

    const ids = new Set(results.map((r) => r.id));
    const numbers = new Set(results.map((r) => r.receiptNumber));
    const hashes = new Set(results.map((r) => r.contentHash));
    expect(ids.size).toBe(1);
    expect(numbers.size).toBe(1);
    expect(hashes.size).toBe(1);

    const rows = await prisma.receiptSnapshot.count({ where: { idempotencyKey: key } });
    expect(rows).toBe(1);

    const replay = await ReceiptService.getOrCreateReceipt({
      restaurantId: ctx.restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL',
      idempotencyKey: key
    });
    expect(replay.id).toBe(results[0].id);
    expect(replay.contentHash).toBe(results[0].contentHash);
  });

  it('dos restaurantes aíslan sus contadores bajo concurrencia entrelazada', async () => {
    const ctxA = await makeRestaurant('AislA');
    const ctxB = await makeRestaurant('AislB');
    const { session: sessionA } = await makeSession(ctxA, 'E15-AA');
    const { session: sessionB } = await makeSession(ctxB, 'E15-AB');
    const period = ReceiptService.receiptPeriod();

    const italiana = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) =>
        ReceiptService.getOrCreateReceipt({
          restaurantId: ctxA.restaurant.id,
          tableSessionId: sessionA.id,
          receiptType: 'PRE_BILL_DETAIL',
          idempotencyKey: `e15-aa-${randomUUID()}-${i}`
        })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        ReceiptService.getOrCreateReceipt({
          restaurantId: ctxB.restaurant.id,
          tableSessionId: sessionB.id,
          receiptType: 'PRE_BILL_DETAIL',
          idempotencyKey: `e15-ab-${randomUUID()}-${i}`
        })
      )
    ]);
    const numbersA = italiana.slice(0, 5).map((r) => r.receiptNumber);
    const numbersB = italiana.slice(5).map((r) => r.receiptNumber);
    // Unicidad por local: la constraint es (restaurantId, receiptNumber).
    expect(new Set(numbersA).size).toBe(5);
    expect(new Set(numbersB).size).toBe(5);
    for (const n of [...numbersA, ...numbersB]) {
      expect(n.startsWith(`TK-${period}-`)).toBe(true);
    }
    // Contadores independientes por local/período.
    const counters = await prisma.$queryRaw<Array<{ restaurantId: string; period: string; lastNumber: number }>>`
      SELECT "restaurantId", "period", "lastNumber"
      FROM "ReceiptCounter"
      WHERE "period" = ${period}
        AND ("restaurantId" = ${ctxA.restaurant.id} OR "restaurantId" = ${ctxB.restaurant.id})
    `;
    expect(counters).toHaveLength(2);
    expect(counters.every((c) => Number(c.lastNumber) >= 5)).toBe(true);
  });

  it('convive con números preexistentes sin reiniciar la numeración', async () => {
    const ctx = await makeRestaurant('Preex');
    const { session } = await makeSession(ctx, 'E15-PX');
    const period = ReceiptService.receiptPeriod();
    const legacyNumber = `TK-${period}-0042`;

    await prisma.receiptSnapshot.create({
      data: {
        restaurantId: ctx.restaurant.id,
        tableSessionId: session.id,
        receiptType: 'PRE_BILL_DETAIL',
        receiptNumber: legacyNumber,
        snapshotData: JSON.stringify({ legacy: true, receiptNumber: legacyNumber }),
        status: 'GENERATED',
        idempotencyKey: `e15-legacy-${randomUUID()}`
      }
    });

    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: ctx.restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL',
      idempotencyKey: `e15-postlegacy-${randomUUID()}`
    });

    const suffix = parseInt(receipt.receiptNumber.split('-').pop() || '0', 10);
    expect(suffix).toBeGreaterThan(42);

    const legacy = await prisma.receiptSnapshot.findFirst({
      where: { restaurantId: ctx.restaurant.id, receiptNumber: legacyNumber }
    });
    expect(legacy).toBeTruthy();
  });

  it('tras reinicio (caché vacía) el PDF persistido se reimprime byte-idéntico y el hash queda ligado al número', async () => {
    const { session } = await makeSession(categoryCtx, 'E15-RP');
    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: categoryCtx.restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL',
      idempotencyKey: `e15-reprint-${randomUUID()}`
    });

    const livePdf = await ReceiptService.getReceiptPdfBuffer(categoryCtx.restaurant.id, receipt.id);
    expect(livePdf.subarray(0, 8).toString()).toContain('%PDF-1.4');

    // Persistencia real en columnas propias (no sólo memoria).
    const persisted = await prisma.$queryRaw<
      Array<{ contentHash: string | null; pdfVersion: number; pdfData: Buffer | null; snapshotData: string }>
    >`
      SELECT "contentHash", "pdfVersion", "pdfData", "snapshotData"
      FROM "ReceiptSnapshot"
      WHERE "id" = ${receipt.id}
    `;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].contentHash).toBe(receipt.contentHash);
    expect(persisted[0].pdfVersion).toBe(1);
    expect(Buffer.from(persisted[0].pdfData || Buffer.alloc(0))).toEqual(livePdf);

    // El hash está ligado al número final: se recalcula sobre el snapshot sin hash.
    const stored = JSON.parse(persisted[0].snapshotData);
    expect(stored.receiptNumber).toBe(receipt.receiptNumber);
    expect(stored.contentHash).toBe(receipt.contentHash);
    delete stored.contentHash;
    expect(createHash('sha256').update(JSON.stringify(stored)).digest('hex')).toBe(receipt.contentHash);

    // Simula reinicio de proceso: sin caché en memoria debe salir de la DB.
    ReceiptService.clearPdfCache();
    const reprinted = await ReceiptService.getReceiptPdfBuffer(categoryCtx.restaurant.id, receipt.id);
    expect(Buffer.compare(livePdf, reprinted)).toBe(0);
    expect(ReceiptService.generateThermalPdfBuffer(receipt.snapshotData)).toEqual(livePdf);

    // El DTO no expone el binario ni el data-URI.
    expect(receipt.pdfPath).toBeNull();
    expect((receipt as any).pdfData).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain('data:application/pdf;base64');
  });

  it('un cobro confirmado no se revierte al emitir su comprobante', async () => {
    const ctx = await makeRestaurant('Cobro');
    const { session } = await makeSession(ctx, 'E15-CO');
    const settlement = await prisma.accountSettlement.create({
      data: {
        tableSessionId: session.id,
        restaurantId: ctx.restaurant.id,
        method: 'WAITER_CASH',
        amountMinor: 150000,
        tipMinor: 15000,
        accountVersion: `e15-${randomUUID()}`,
        idempotencyKey: `e15-settle-${randomUUID()}`,
        createdBy: 'e15-tester'
      }
    });

    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: ctx.restaurant.id,
      tableSessionId: session.id,
      settlementId: settlement.id,
      receiptType: 'PAYMENT_RECEIPT',
      idempotencyKey: `e15-payrcpt-${randomUUID()}`
    });

    expect(receipt.snapshotData.settlementId).toBe(settlement.id);
    expect(receipt.snapshotData.paymentTotalMinor).toBe(165000);

    const intact = await prisma.accountSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(intact.status).toBe('SETTLED');
    expect(intact.amountMinor).toBe(150000);
    expect(intact.tipMinor).toBe(15000);
  });
});
