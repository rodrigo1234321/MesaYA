import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { floorPlanService } from '../src/services/floorplan.service';

const uid = () => randomUUID().slice(0, 8);

describe('Etapa 26 — Guardar plano sin pérdidas ni sobrescrituras', () => {
  let restaurantId: string;
  let otherRestaurantId: string;
  let zoneId: string;
  let tableA: string;
  let tableB: string;
  let foreignTableId: string;

  const tablePayload = (id: string, label: string, posX: number, posY: number, extra: Record<string, unknown> = {}) => ({
    id,
    label,
    posX,
    posY,
    ...extra
  });

  beforeAll(async () => {
    const suffix = uid();
    const restaurant = await prisma.restaurant.create({
      data: { name: `Plano Atomico ${suffix}`, slug: `plano-atomico-${suffix}` }
    });
    restaurantId = restaurant.id;
    const other = await prisma.restaurant.create({
      data: { name: `Plano Atomico Otro ${suffix}`, slug: `plano-atomico-otro-${suffix}` }
    });
    otherRestaurantId = other.id;

    const zone = await prisma.floorZone.create({
      data: { restaurantId, name: `Zona ${suffix}`, color: '#3b82f6', orderIndex: 0 }
    });
    zoneId = zone.id;

    const [a, b] = await Promise.all([
      prisma.table.create({ data: { restaurantId, label: `Mesa A ${suffix}`, posX: 10, posY: 10, floorZoneId: zoneId } }),
      prisma.table.create({ data: { restaurantId, label: `Mesa B ${suffix}`, posX: 100, posY: 100 } })
    ]);
    tableA = a.id;
    tableB = b.id;

    const foreign = await prisma.table.create({
      data: { restaurantId: otherRestaurantId, label: `Mesa Foranea ${suffix}`, posX: 5, posY: 5 }
    });
    foreignTableId = foreign.id;

    // Layout base con canvas conocido
    await floorPlanService.updateFloorPlan(restaurantId, {
      canvasWidth: 1200,
      canvasHeight: 800,
      gridSize: 20,
      tables: [
        tablePayload(tableA, `Mesa A ${suffix}`, 10, 10, { floorZoneId: zoneId }),
        tablePayload(tableB, `Mesa B ${suffix}`, 100, 100)
      ]
    });
  });

  afterAll(async () => {
    if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    if (otherRestaurantId) await prisma.restaurant.delete({ where: { id: otherRestaurantId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('1. payload parcialmente inválido (zona desconocida) no cambia posiciones ni canvas', async () => {
    const before = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    const layoutBefore = await prisma.floorPlanLayout.findFirstOrThrow({ where: { restaurantId, isActive: true } });

    const err = await floorPlanService
      .updateFloorPlan(restaurantId, {
        canvasWidth: 9999,
        tables: [
          // Ítem válido que NO debe aplicarse si otro ítem falla
          tablePayload(tableA, before.label, 500, 500, { floorZoneId: zoneId }),
          tablePayload(tableB, 'Mesa B movida', 600, 600, { floorZoneId: 'zona-inexistente' })
        ]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('ZONE_NOT_FOUND');

    const after = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    expect(after.posX).toBe(before.posX);
    expect(after.posY).toBe(before.posY);
    const layoutAfter = await prisma.floorPlanLayout.findFirstOrThrow({ where: { restaurantId, isActive: true } });
    expect(layoutAfter.canvasWidth).toBe(layoutBefore.canvasWidth);
    expect(layoutAfter.version).toBe(layoutBefore.version);
  });

  it('2. plano vacío sin confirmación no borra; con confirmación y mesas limpias sí vacía', async () => {
    const rejected: any = await floorPlanService
      .updateFloorPlan(restaurantId, { tables: [] })
      .then(
        () => null,
        (e) => e
      );
    expect(rejected).not.toBeNull();
    expect(rejected.statusCode).toBe(400);
    expect(rejected.code).toBe('EMPTY_TABLE_LIST');
    expect(await prisma.table.count({ where: { restaurantId } })).toBe(2);

    const ok = await floorPlanService.updateFloorPlan(restaurantId, {
      tables: [],
      confirmEmptyTables: true
    });
    expect(ok.success).toBe(true);
    expect(await prisma.table.count({ where: { restaurantId } })).toBe(0);

    // Restaurar fixture para los siguientes tests
    const suffix = uid();
    const [a, b] = await Promise.all([
      prisma.table.create({ data: { restaurantId, label: `Mesa A ${suffix}`, posX: 10, posY: 10, floorZoneId: zoneId } }),
      prisma.table.create({ data: { restaurantId, label: `Mesa B ${suffix}`, posX: 100, posY: 100 } })
    ]);
    tableA = a.id;
    tableB = b.id;
  });

  it('3. dos ediciones sobre la misma versión: un éxito y un 409; reintento consciente ok', async () => {
    const plan = await floorPlanService.getFloorPlan(restaurantId);
    const baseVersion = plan.layout.version;
    const labelA = (await prisma.table.findUniqueOrThrow({ where: { id: tableA } })).label;
    const labelB = (await prisma.table.findUniqueOrThrow({ where: { id: tableB } })).label;

    const first = await floorPlanService.updateFloorPlan(restaurantId, {
      expectedVersion: baseVersion,
      tables: [
        tablePayload(tableA, labelA, 11, 11, { floorZoneId: zoneId }),
        tablePayload(tableB, labelB, 100, 100)
      ]
    });
    expect(first.success).toBe(true);
    expect(first.layoutVersion).toBe(baseVersion + 1);

    const stale: any = await floorPlanService
      .updateFloorPlan(restaurantId, {
        expectedVersion: baseVersion,
        tables: [
          tablePayload(tableA, labelA, 22, 22, { floorZoneId: zoneId }),
          tablePayload(tableB, labelB, 100, 100)
        ]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(stale).not.toBeNull();
    expect(stale.statusCode).toBe(409);
    expect(stale.code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(stale.details.currentVersion).toBe(baseVersion + 1);

    // El intento obsoleto no escribió nada
    const kept = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    expect(kept.posX).toBe(11);
    expect(kept.posY).toBe(11);

    // Reintento consciente con versión fresca
    const retry = await floorPlanService.updateFloorPlan(restaurantId, {
      expectedVersion: baseVersion + 1,
      tables: [
        tablePayload(tableA, labelA, 22, 22, { floorZoneId: zoneId }),
        tablePayload(tableB, labelB, 100, 100)
      ]
    });
    expect(retry.success).toBe(true);
    expect(retry.layoutVersion).toBe(baseVersion + 2);
    const moved = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    expect(moved.posX).toBe(22);
  });

  it('4. mesa de otro tenant y mesa combinada desconocida se rechazan sin escrituras', async () => {
    const before = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    const labelB = (await prisma.table.findUniqueOrThrow({ where: { id: tableB } })).label;

    const foreign: any = await floorPlanService
      .updateFloorPlan(restaurantId, {
        tables: [
          tablePayload(tableA, before.label, 30, 30, { floorZoneId: zoneId }),
          tablePayload(foreignTableId, 'Mesa Foranea', 5, 5)
        ]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(foreign).not.toBeNull();
    expect(foreign.statusCode).toBe(404);
    expect(foreign.code).toBe('TABLE_NOT_FOUND');

    const badMerge: any = await floorPlanService
      .updateFloorPlan(restaurantId, {
        tables: [
          tablePayload(tableA, before.label, 30, 30, { floorZoneId: zoneId, mergedWithTableId: 'mesa-fantasma' }),
          tablePayload(tableB, labelB, 100, 100)
        ]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(badMerge).not.toBeNull();
    expect(badMerge.statusCode).toBe(404);
    expect(badMerge.code).toBe('MERGED_TABLE_NOT_FOUND');

    const dup: any = await floorPlanService
      .updateFloorPlan(restaurantId, {
        tables: [
          tablePayload(tableA, 'Etiqueta Repetida', 30, 30),
          tablePayload(tableB, 'Etiqueta Repetida', 100, 100)
        ]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(dup).not.toBeNull();
    expect(dup.statusCode).toBe(400);
    expect(dup.code).toBe('DUPLICATE_TABLE_LABEL');

    const after = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    expect(after.posX).toBe(before.posX);
    expect(after.posY).toBe(before.posY);
    expect(after.mergedWithTableId).toBeNull();
  });

  it('5. omisión con sesión/ocupación/pedidos/historial se rechaza con 409 y no escribe nada', async () => {
    const labelA = (await prisma.table.findUniqueOrThrow({ where: { id: tableA } })).label;
    const labelB = (await prisma.table.findUniqueOrThrow({ where: { id: tableB } })).label;

    // Armar operatoria real sobre Mesa B: sesión + ocupación + pedido + llamado + feedback + evento FSM
    const session = await prisma.tableSession.create({
      data: {
        tableId: tableB,
        token: `tok-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });
    await prisma.occupancySession.create({ data: { tableId: tableB, restaurantId } });
    await prisma.order.create({ data: { tableSessionId: session.id } });
    await prisma.callRequest.create({ data: { tableSessionId: session.id, type: 'WAITER' } });
    await prisma.feedback.create({ data: { tableSessionId: session.id, rating: 5 } });
    await prisma.tableStateEvent.create({
      data: {
        tableId: tableB,
        fromState: 'AVAILABLE',
        toState: 'OCCUPIED_NO_ORDER',
        trigger: 'CUSTOMER_QR',
        source: 'CUSTOMER_QR'
      }
    });

    const beforeA = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    const blocked: any = await floorPlanService
      .updateFloorPlan(restaurantId, {
        tables: [tablePayload(tableA, labelA, 77, 77, { floorZoneId: zoneId })]
      })
      .then(
        () => null,
        (e) => e
      );
    expect(blocked).not.toBeNull();
    expect(blocked.statusCode).toBe(409);
    expect(blocked.code).toBe('TABLE_HAS_DEPENDENCIES');
    expect(JSON.stringify(blocked.details)).toContain(tableB);

    // Atomicidad: ni siquiera la mesa válida del payload se movió, y B sigue existiendo
    const keptA = await prisma.table.findUniqueOrThrow({ where: { id: tableA } });
    expect(keptA.posX).toBe(beforeA.posX);
    expect(keptA.posY).toBe(beforeA.posY);
    expect(await prisma.table.findUnique({ where: { id: tableB } })).not.toBeNull();
    expect(labelB).toBeTruthy();

    // Borrado directo también se rechaza
    const direct: any = await floorPlanService.deleteTable(restaurantId, tableB).then(
      () => null,
      (e) => e
    );
    expect(direct).not.toBeNull();
    expect(direct.statusCode).toBe(409);
    expect(direct.code).toBe('TABLE_HAS_DEPENDENCIES');
    expect(await prisma.table.findUnique({ where: { id: tableB } })).not.toBeNull();
  });

  it('6. mesa limpia sí puede eliminarse por omisión y por borrado directo', async () => {
    const labelB = (await prisma.table.findUniqueOrThrow({ where: { id: tableB } })).label;
    void labelB;
    // Mesa A no tiene dependencias: omitirla la elimina
    const labelA = (await prisma.table.findUniqueOrThrow({ where: { id: tableA } })).label;
    const saved = await floorPlanService.updateFloorPlan(restaurantId, {
      tables: [tablePayload(tableB, (await prisma.table.findUniqueOrThrow({ where: { id: tableB } })).label, 100, 100)]
    });
    expect(saved.success).toBe(true);
    expect(await prisma.table.findUnique({ where: { id: tableA } })).toBeNull();
    expect(labelA).toBeTruthy();

    // Recrear A limpia y borrarla por vía directa
    const suffix = uid();
    const fresh = await prisma.table.create({
      data: { restaurantId, label: `Mesa Fresh ${suffix}`, posX: 1, posY: 1 }
    });
    const deleted = await floorPlanService.deleteTable(restaurantId, fresh.id);
    expect(deleted.success).toBe(true);
    expect(await prisma.table.findUnique({ where: { id: fresh.id } })).toBeNull();
  });
});
