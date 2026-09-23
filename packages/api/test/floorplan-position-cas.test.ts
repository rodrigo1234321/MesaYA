import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { floorPlanService } from '../src/services/floorplan.service';
import { floorPlanRoutes } from '../src/routes/floorplan.routes';

const SECRET = 'jwt-secret-for-floorplan-cas-tests-which-is-long-enough';

/**
 * Etapa 26 (corrección Codex) — la vía rápida PATCH /tables/:tableId/position
 * participa del versionado optimista con rutas y servicio reales (sin mocks):
 * CAS atómico que incrementa FloorPlanLayout.version y 409 ante precondición
 * obsoleta, más el mapeo 409 del PUT bulk a nivel HTTP.
 */
describe('Etapa 26 (corrección) — CAS en vía rápida y rutas HTTP reales', () => {
  let app: FastifyInstance;
  let managerToken: string;
  let restaurantId: string;
  let restaurantSlug: string;
  let zoneId: string;
  let tableId: string;
  let tableLabel: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(floorPlanRoutes);

    const suffix = randomUUID().slice(0, 8);
    restaurantSlug = `plano-cas-${suffix}`;
    const restaurant = await prisma.restaurant.create({
      data: { name: `Plano CAS ${suffix}`, slug: restaurantSlug }
    });
    restaurantId = restaurant.id;

    const zone = await prisma.floorZone.create({
      data: { restaurantId, name: `Zona CAS ${suffix}`, color: '#3b82f6', orderIndex: 0 }
    });
    zoneId = zone.id;

    tableLabel = `Mesa CAS ${suffix}`;
    const table = await prisma.table.create({
      data: { restaurantId, label: tableLabel, posX: 10, posY: 10, floorZoneId: zoneId }
    });
    tableId = table.id;

    const manager = await prisma.staffUser.create({
      data: { restaurantId, name: 'Encargado CAS', pinHash: 'cas-hash', role: 'MANAGER' }
    });
    managerToken = app.jwt.sign({ sub: manager.id, role: 'MANAGER', restaurantId });
  });

  afterAll(async () => {
    if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  const auth = () => ({ authorization: `Bearer ${managerToken}` });

  it('1. PATCH anónimo se rechaza y PATCH con versión fresca mueve la mesa e incrementa la versión', async () => {
    const anon = await app.inject({
      method: 'PATCH',
      url: `/tables/${tableId}/position`,
      payload: { posX: 1, posY: 1 }
    });
    expect(anon.statusCode).toBe(401);

    const base = await floorPlanService.getFloorPlan(restaurantId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/tables/${tableId}/position`,
      headers: auth(),
      payload: { posX: 50, posY: 60, expectedVersion: base.layout.version }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.layoutVersion).toBe(base.layout.version + 1);

    const moved = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(moved.posX).toBe(50);
    expect(moved.posY).toBe(60);
  });

  it('2. PATCH con versión obsoleta responde 409 y no mueve nada', async () => {
    const base = await floorPlanService.getFloorPlan(restaurantId);

    // Otro editor avanza la versión por la vía bulk
    await floorPlanService.updateFloorPlan(restaurantId, {
      expectedVersion: base.layout.version,
      tables: [{ id: tableId, label: tableLabel, posX: 51, posY: 61, floorZoneId: zoneId }]
    });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/tables/${tableId}/position`,
      headers: auth(),
      payload: { posX: 900, posY: 900, expectedVersion: base.layout.version }
    });
    expect(stale.statusCode).toBe(409);
    const body = JSON.parse(stale.body);
    expect(body.code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(body.error).toContain('El plano cambió desde tu última carga');
    expect(body.details.currentVersion).toBe(base.layout.version + 1);

    const kept = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(kept.posX).toBe(51);
    expect(kept.posY).toBe(61);
  });

  it('3. PATCH sin expectedVersion se rechaza con 400 LAYOUT_VERSION_REQUIRED y cero escrituras', async () => {
    const before = await floorPlanService.getFloorPlan(restaurantId);
    const tableBefore = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/tables/${tableId}/position`,
      headers: auth(),
      payload: { posX: 900, posY: 900 }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('LAYOUT_VERSION_REQUIRED');

    const tableAfter = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(tableAfter.posX).toBe(tableBefore.posX);
    expect(tableAfter.posY).toBe(tableBefore.posY);
    const after = await floorPlanService.getFloorPlan(restaurantId);
    expect(after.layout.version).toBe(before.layout.version);
  });

  it('4. PUT bulk vía HTTP mapea 409 de versión y 404 de zona sin escrituras', async () => {
    const base = await floorPlanService.getFloorPlan(restaurantId);

    const conflict = await app.inject({
      method: 'PUT',
      url: `/floor-plan/${restaurantSlug}`,
      headers: auth(),
      payload: {
        expectedVersion: base.layout.version - 1,
        tables: [{ id: tableId, label: tableLabel, posX: 5, posY: 5, floorZoneId: zoneId }]
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body).code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(JSON.parse(conflict.body).error).toContain('El plano cambió desde tu última carga');

    const badZone = await app.inject({
      method: 'PUT',
      url: `/floor-plan/${restaurantSlug}`,
      headers: auth(),
      payload: {
        tables: [{ id: tableId, label: tableLabel, posX: 5, posY: 5, floorZoneId: 'zona-fantasma' }]
      }
    });
    expect(badZone.statusCode).toBe(404);
    expect(JSON.parse(badZone.body).code).toBe('ZONE_NOT_FOUND');
    expect(JSON.parse(badZone.body).error).toContain('Una o más zonas no pertenecen a este restaurante.');

    const kept = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(kept.posX).toBe(51);
    expect(kept.posY).toBe(61);
  });

  it('5. el servicio rechaza la ausencia de expectedVersion antes de escribir (defensa en profundidad)', async () => {
    const before = await floorPlanService.getFloorPlan(restaurantId);
    const tableBefore = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });

    const err: any = await floorPlanService
      .updateTablePosition(tableId, { posX: 901, posY: 901 } as any)
      .then(
        () => null,
        (e) => e
      );
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('LAYOUT_VERSION_REQUIRED');

    const tableAfter = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(tableAfter.posX).toBe(tableBefore.posX);
    expect(tableAfter.posY).toBe(tableBefore.posY);
    const after = await floorPlanService.getFloorPlan(restaurantId);
    expect(after.layout.version).toBe(before.layout.version);
  });
});
