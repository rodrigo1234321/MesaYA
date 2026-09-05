import { prisma } from '../lib/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  FloorPlanResponseDTO,
  FloorPlanUpdateDTO,
  ZoneCreateDTO,
  ZoneUpdateDTO,
  TablePositionUpdateDTO,
  TableFSMState,
  STATE_COLORS,
  STATE_EMOJIS,
  TableShape
} from '@mesaya/shared';

type FloorPlanTxClient = Pick<
  PrismaClient,
  'table' | 'tableSession' | 'occupancySession' | 'tableStateEvent' | 'order' | 'callRequest' | 'feedback' | 'floorPlanLayout' | 'floorZone'
>;

function floorPlanError(statusCode: number, code: string, message: string, details?: unknown): Error {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

export interface TableDependencyReport {
  tableId: string;
  label: string;
  reasons: string[];
}

/**
 * Etapa 26: detecta mesas con datos operativos o históricos que impiden su
 * eliminación silenciosa (sesiones abiertas/cerradas, ocupaciones, pedidos,
 * llamados, feedback e historial de estados FSM).
 */
export async function findTablesWithDependencies(
  db: FloorPlanTxClient,
  tableIds: string[]
): Promise<TableDependencyReport[]> {
  if (tableIds.length === 0) return [];

  const tables = await db.table.findMany({
    where: { id: { in: tableIds } },
    select: { id: true, label: true }
  });
  const labels = new Map(tables.map((t) => [t.id, t.label]));

  const sessions = await db.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true, tableId: true, closedAt: true }
  });
  const sessionIds = sessions.map((s) => s.id);

  const [occupancies, events, orders, calls, feedbacks] = await Promise.all([
    db.occupancySession.findMany({
      where: { tableId: { in: tableIds } },
      select: { tableId: true, cleanedAt: true }
    }),
    db.tableStateEvent.findMany({
      where: { tableId: { in: tableIds } },
      select: { tableId: true }
    }),
    sessionIds.length > 0
      ? db.order.findMany({
          where: { tableSessionId: { in: sessionIds } },
          select: { tableSessionId: true }
        })
      : Promise.resolve([] as { tableSessionId: string }[]),
    sessionIds.length > 0
      ? db.callRequest.findMany({
          where: { tableSessionId: { in: sessionIds } },
          select: { tableSessionId: true }
        })
      : Promise.resolve([] as { tableSessionId: string }[]),
    sessionIds.length > 0
      ? db.feedback.findMany({
          where: { tableSessionId: { in: sessionIds } },
          select: { tableSessionId: true }
        })
      : Promise.resolve([] as { tableSessionId: string }[])
  ]);

  const reasons = new Map<string, Set<string>>();
  const add = (tableId: string, reason: string) => {
    const set = reasons.get(tableId) ?? new Set<string>();
    set.add(reason);
    reasons.set(tableId, set);
  };

  for (const s of sessions) add(s.tableId, s.closedAt ? 'SESION_CERRADA' : 'SESION_ABIERTA');
  for (const o of occupancies) add(o.tableId, o.cleanedAt ? 'OCUPACION_HISTORICA' : 'OCUPACION_ABIERTA');
  for (const e of events) add(e.tableId, 'HISTORIAL_ESTADOS');

  const sessionTable = new Map(sessions.map((s) => [s.id, s.tableId]));
  for (const o of orders) {
    const tableId = sessionTable.get(o.tableSessionId);
    if (tableId) add(tableId, 'PEDIDO');
  }
  for (const c of calls) {
    const tableId = sessionTable.get(c.tableSessionId);
    if (tableId) add(tableId, 'LLAMADO');
  }
  for (const f of feedbacks) {
    const tableId = sessionTable.get(f.tableSessionId);
    if (tableId) add(tableId, 'FEEDBACK');
  }

  return [...reasons.entries()].map(([tableId, reasonSet]) => ({
    tableId,
    label: labels.get(tableId) ?? tableId,
    reasons: [...reasonSet].sort()
  }));
}

export class FloorPlanService {
  /**
   * Retrieves the complete floor plan (layout, zones, tables with live state, and statistics)
   */
  async getFloorPlan(restaurantIdOrSlug: string): Promise<FloorPlanResponseDTO> {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }]
      }
    });

    if (!restaurant) {
      const err: any = new Error(`Restaurante '${restaurantIdOrSlug}' no encontrado`);
      err.statusCode = 404;
      err.code = 'RESTAURANT_NOT_FOUND';
      throw err;
    }

    const restaurantId = restaurant.id;

    // 1. Get or create default layout
    let layout = await prisma.floorPlanLayout.findFirst({
      where: { restaurantId, isActive: true }
    });

    if (!layout) {
      layout = await prisma.floorPlanLayout.create({
        data: {
          restaurantId,
          name: 'Principal',
          canvasWidth: 1200,
          canvasHeight: 800,
          gridSize: 20
        }
      });
    }

    // 2. Fetch zones
    const zones = await prisma.floorZone.findMany({
      where: { restaurantId },
      orderBy: { orderIndex: 'asc' }
    });

    const parsedZones = zones.map((z) => ({
      id: z.id,
      restaurantId: z.restaurantId,
      name: z.name,
      color: z.color,
      orderIndex: z.orderIndex,
      polygonPoints: z.polygonPoints ? JSON.parse(z.polygonPoints) : []
    }));

    // 3. Fetch tables with live active call, active session and occupancy session
    const tables = await prisma.table.findMany({
      where: { restaurantId },
      include: {
        floorZone: true,
        occupancySessions: {
          where: { cleanedAt: null },
          orderBy: { seatedAt: 'desc' },
          take: 1
        },
        sessions: {
          where: { closedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            calls: {
              where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        }
      },
      orderBy: { label: 'asc' }
    });

    let availableCount = 0;
    let occupiedCount = 0;
    let billRequestedCount = 0;
    let toCleanCount = 0;

    const parsedTables = tables.map((t) => {
      const activeSession = t.sessions[0];
      const activeCall = activeSession?.calls[0];
      const activeOcc = t.occupancySessions[0];
      const fsmState = (t.currentState as TableFSMState) || TableFSMState.AVAILABLE;

      if (fsmState === TableFSMState.AVAILABLE) availableCount++;
      else if (fsmState === TableFSMState.BILL_REQUESTED) billRequestedCount++;
      else if (fsmState === TableFSMState.TO_CLEAN) toCleanCount++;
      else occupiedCount++;

      let occupancyMinutes: number | null = null;
      if (fsmState !== TableFSMState.AVAILABLE && fsmState !== TableFSMState.RESERVED) {
        const baseTime = activeOcc ? activeOcc.seatedAt.getTime() : new Date(t.stateChangedAt).getTime();
        occupancyMinutes = Math.max(0, Math.floor((Date.now() - baseTime) / 60000));
      }

      return {
        id: t.id,
        restaurantId: t.restaurantId,
        label: t.label,
        sector: t.sector,
        isOutdoor: t.isOutdoor,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        shape: (t.shape as TableShape) || 'RECT',
        capacity: t.capacity,
        floorZoneId: t.floorZoneId,
        zoneName: t.floorZone?.name ?? null,
        currentState: fsmState,
        stateChangedAt: t.stateChangedAt.toISOString(),
        stateColor: STATE_COLORS[fsmState]?.hex ?? '#22c55e',
        stateEmoji: STATE_EMOJIS[fsmState] ?? '🟢',
        occupancyMinutes,
        activeCall: activeCall
          ? {
              id: activeCall.id,
              type: activeCall.type,
              paymentMethod: activeCall.paymentMethod,
              createdAt: activeCall.createdAt.toISOString()
            }
          : null,
        activeSessionToken: null,
        mergedWithTableId: t.mergedWithTableId,
        mergedWithLabel: t.mergedWithTableId
          ? tables.find((partner) => partner.id === t.mergedWithTableId)?.label ?? null
          : null
      };
    });

    const totalTables = tables.length;
    const occupancyRatePercentage =
      totalTables > 0 ? Math.round(((totalTables - availableCount) / totalTables) * 100) : 0;

    return {
      layout: {
        id: layout.id,
        restaurantId: layout.restaurantId,
        name: layout.name,
        canvasWidth: layout.canvasWidth,
        canvasHeight: layout.canvasHeight,
        gridSize: layout.gridSize,
        backgroundUrl: layout.backgroundUrl,
        isActive: layout.isActive,
        version: layout.version
      },
      zones: parsedZones,
      tables: parsedTables,
      stats: {
        totalTables,
        availableCount,
        occupiedCount,
        billRequestedCount,
        toCleanCount,
        occupancyRatePercentage
      }
    };
  }

  /**
   * Updates floor plan layout and positions of tables in bulk.
   *
   * Etapa 26: validación completa ANTES de escribir (payload, IDs existentes,
   * tenant, zonas y referencias de mesas combinadas), guardado atómico en una
   * sola transacción con precondición optimista de versión (409 ante edición
   * concurrente) y rechazo explícito de eliminaciones con dependencias
   * operativas o históricas. Un payload parcialmente inválido no cambia nada.
   */
  async updateFloorPlan(
    restaurantIdOrSlug: string,
    data: FloorPlanUpdateDTO
  ): Promise<{ success: boolean; updatedTablesCount: number; layoutVersion: number }> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      const err: any = new Error(`Restaurante '${restaurantIdOrSlug}' no encontrado`);
      err.statusCode = 404;
      err.code = 'RESTAURANT_NOT_FOUND';
      throw err;
    }
    const restaurantId = restaurant.id;
    const tables = data.tables ?? [];

    // 0. El plano vacío sólo se acepta con confirmación explícita: nunca
    // borrar silenciosamente todas las mesas por omisión o error del editor.
    if (tables.length === 0 && data.confirmEmptyTables !== true) {
      throw floorPlanError(
        400,
        'EMPTY_TABLE_LIST',
        'La lista de mesas está vacía. Si realmente querés vaciar el plano, reintentá con confirmación explícita.'
      );
    }

    // 0b. Validación defensiva del payload (la ruta ya aplica zod, pero el
    // servicio también puede invocarse directamente).
    const seenIds = new Set<string>();
    for (const t of tables) {
      if (seenIds.has(t.id)) {
        throw floorPlanError(400, 'DUPLICATE_TABLE_ID', `ID de mesa duplicado en payload: '${t.id}'.`);
      }
      seenIds.add(t.id);
      if (t.mergedWithTableId !== undefined && t.mergedWithTableId !== null && t.mergedWithTableId === t.id) {
        throw floorPlanError(400, 'INVALID_MERGE_REF', `La mesa '${t.id}' no puede combinarse consigo misma.`);
      }
      if (t.floorZoneId !== undefined && t.floorZoneId !== null && t.floorZoneId.trim() === '') {
        throw floorPlanError(400, 'INVALID_ZONE_REF', `Zona inválida en mesa '${t.id}'.`);
      }
    }
    const seenLabels = new Set<string>();
    for (const t of tables) {
      if (t.label === undefined) continue;
      if (seenLabels.has(t.label)) {
        throw floorPlanError(400, 'DUPLICATE_TABLE_LABEL', `Etiqueta de mesa duplicada en payload: '${t.label}'.`);
      }
      seenLabels.add(t.label);
    }

    // 1. Cargar estado actual (sólo lecturas, sin escrituras todavía).
    const [existingTables, zones] = await Promise.all([
      prisma.table.findMany({ where: { restaurantId }, select: { id: true, label: true } }),
      prisma.floorZone.findMany({ where: { restaurantId }, select: { id: true } })
    ]);
    const existingIds = new Set(existingTables.map((t) => t.id));
    const existingLabels = new Map(existingTables.map((t) => [t.id, t.label]));
    const zoneIds = new Set(zones.map((z) => z.id));

    // 2. Todo ID existente debe pertenecer a este restaurante (existencia +
    // tenant: un ID desconocido o foráneo se rechaza sin escribir nada).
    const unknownIds = tables
      .map((t) => t.id)
      .filter((id) => !id.startsWith('new-') && !existingIds.has(id));
    if (unknownIds.length > 0) {
      throw floorPlanError(
        404,
        'TABLE_NOT_FOUND',
        'Una o más mesas no pertenecen a este restaurante.',
        { tableIds: [...new Set(unknownIds)] }
      );
    }

    // 3. Toda zona referenciada debe existir en este restaurante (evita FK 500).
    const unknownZones = [
      ...new Set(tables.map((t) => t.floorZoneId).filter((z): z is string => !!z))
    ].filter((z) => !zoneIds.has(z));
    if (unknownZones.length > 0) {
      throw floorPlanError(
        404,
        'ZONE_NOT_FOUND',
        'Una o más zonas no pertenecen a este restaurante.',
        { zoneIds: unknownZones }
      );
    }

    // 4. Toda mesa combinada debe resolverse dentro del payload guardado (no
    // se permiten referencias a mesas inexistentes, de otro tenant ni a mesas
    // que este mismo guardado eliminaría por omisión).
    const payloadIds = new Set(tables.map((t) => t.id));
    for (const t of tables) {
      const ref = t.mergedWithTableId;
      if (ref === undefined || ref === null) continue;
      if (!payloadIds.has(ref)) {
        throw floorPlanError(
          existingIds.has(ref) ? 400 : 404,
          existingIds.has(ref) ? 'MERGED_TABLE_REMOVED' : 'MERGED_TABLE_NOT_FOUND',
          existingIds.has(ref)
            ? `La mesa '${t.id}' referencia a '${ref}', que este guardado eliminaría.`
            : `La mesa '${t.id}' referencia a una mesa combinada desconocida ('${ref}').`,
          { tableId: t.id, mergedWithTableId: ref }
        );
      }
    }

    // 5. Etiquetas finales únicas (incluye renombres y altas).
    const finalLabels = new Map<string, string>();
    for (const t of tables) {
      const finalLabel = t.label ?? existingLabels.get(t.id) ?? null;
      if (finalLabel !== null) {
        if ([...finalLabels.values()].includes(finalLabel)) {
          throw floorPlanError(400, 'DUPLICATE_TABLE_LABEL', `Etiqueta de mesa duplicada: '${finalLabel}'.`);
        }
        finalLabels.set(t.id, finalLabel);
      }
    }

    // 6. Mesas omitidas = eliminadas por el editor. Las que tengan sesión,
    // ocupación, pedidos, llamados, feedback o historial se rechazan con 409.
    const payloadExistingIds = new Set(
      tables.map((t) => t.id).filter((id) => !id.startsWith('new-'))
    );
    const omittedIds = [...existingIds].filter((id) => !payloadExistingIds.has(id));
    if (omittedIds.length > 0) {
      const blocked = await findTablesWithDependencies(prisma, omittedIds);
      if (blocked.length > 0) {
        throw floorPlanError(
          409,
          'TABLE_HAS_DEPENDENCIES',
          'Una o más mesas omitidas tienen sesiones, ocupación, pedidos o historial y no pueden eliminarse por omisión.',
          { tables: blocked }
        );
      }
    }

    // 7. Guardado atómico con precondición optimista de versión (compare-and-swap).
    return prisma.$transaction(async (tx) => {
      let layout = await tx.floorPlanLayout.findFirst({
        where: { restaurantId, isActive: true }
      });

      const layoutData: { canvasWidth?: number; canvasHeight?: number; gridSize?: number; backgroundUrl?: string | null } = {
        ...(data.canvasWidth !== undefined && { canvasWidth: data.canvasWidth }),
        ...(data.canvasHeight !== undefined && { canvasHeight: data.canvasHeight }),
        ...(data.gridSize !== undefined && { gridSize: data.gridSize }),
        ...(data.backgroundUrl !== undefined && { backgroundUrl: data.backgroundUrl })
      };

      if (!layout) {
        layout = await tx.floorPlanLayout.create({
          data: {
            restaurantId,
            name: 'Principal',
            canvasWidth: data.canvasWidth ?? 1200,
            canvasHeight: data.canvasHeight ?? 800,
            gridSize: data.gridSize ?? 20,
            ...(data.backgroundUrl !== undefined && { backgroundUrl: data.backgroundUrl }),
            version: 0
          }
        });
      } else if (data.expectedVersion !== undefined) {
        const guarded = await tx.floorPlanLayout.updateMany({
          where: { id: layout.id, version: data.expectedVersion },
          data: { ...layoutData, version: { increment: 1 } }
        });
        if (guarded.count === 0) {
          const current = await tx.floorPlanLayout.findUnique({
            where: { id: layout.id },
            select: { version: true }
          });
          throw floorPlanError(
            409,
            'LAYOUT_VERSION_CONFLICT',
            `El plano cambió desde tu última carga (versión actual ${current?.version ?? 'desconocida'}). Recargá el plano y reintentá de forma consciente; tu borrador local se conserva.`,
            { expectedVersion: data.expectedVersion, currentVersion: current?.version ?? null }
          );
        }
        layout = await tx.floorPlanLayout.findUniqueOrThrow({ where: { id: layout.id } });
      } else {
        layout = await tx.floorPlanLayout.update({
          where: { id: layout.id },
          data: { ...layoutData, version: { increment: 1 } }
        });
      }

      // 8. Eliminaciones ya vetadas (sin dependencias): descombinar y borrar.
      if (omittedIds.length > 0) {
        await tx.table.updateMany({
          where: { restaurantId, mergedWithTableId: { in: omittedIds } },
          data: { mergedWithTableId: null }
        });
        await tx.table.deleteMany({
          where: { restaurantId, id: { in: omittedIds } }
        });
      }

      // 9. Altas y actualizaciones dentro de la misma transacción.
      const usedLabels = new Set(finalLabels.values());
      let count = 0;
      let autoIndex = 1;
      for (const t of tables) {
        if (t.id.startsWith('new-')) {
          let label = t.label;
          if (!label) {
            do {
              label = `Mesa ${autoIndex++}`;
            } while (usedLabels.has(label));
            usedLabels.add(label);
          }
          await tx.table.create({
            data: {
              restaurantId,
              label,
              sector: t.sector || 'SALON_PRINCIPAL',
              isOutdoor: t.isOutdoor ?? (t.sector === 'TERRAZA' || t.sector === 'VEREDA'),
              posX: t.posX,
              posY: t.posY,
              width: t.width || 80,
              height: t.height || 80,
              rotation: t.rotation || 0,
              shape: (t.shape as TableShape) || 'RECT',
              capacity: t.capacity || 4,
              floorZoneId: t.floorZoneId || null,
              mergedWithTableId: t.mergedWithTableId || null,
              currentState: TableFSMState.AVAILABLE
            }
          });
          count++;
        } else {
          const res = await tx.table.updateMany({
            where: { id: t.id, restaurantId },
            data: {
              posX: t.posX,
              posY: t.posY,
              ...(t.label !== undefined && { label: t.label }),
              ...(t.sector !== undefined && { sector: t.sector }),
              ...(t.isOutdoor !== undefined && { isOutdoor: t.isOutdoor }),
              ...(t.width !== undefined && { width: t.width }),
              ...(t.height !== undefined && { height: t.height }),
              ...(t.rotation !== undefined && { rotation: t.rotation }),
              ...(t.shape !== undefined && { shape: t.shape }),
              ...(t.capacity !== undefined && { capacity: t.capacity }),
              ...(t.floorZoneId !== undefined && { floorZoneId: t.floorZoneId }),
              ...(t.mergedWithTableId !== undefined && { mergedWithTableId: t.mergedWithTableId })
            }
          });
          if (res.count > 0) count++;
        }
      }
      return { success: true, updatedTablesCount: count, layoutVersion: layout.version };
    });
  }

  /**
   * Delete a table directly. Etapa 26: rechaza con 409 las mesas con sesión,
   * ocupación, pedidos, llamados, feedback o historial en vez de borrar en
   * cascada silenciosa.
   */
  async deleteTable(restaurantIdOrSlug: string, tableId: string): Promise<{ success: boolean }> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      const err: any = new Error(`Restaurante '${restaurantIdOrSlug}' no encontrado`);
      err.statusCode = 404;
      err.code = 'RESTAURANT_NOT_FOUND';
      throw err;
    }

    const table = await prisma.table.findFirst({
      where: { id: tableId, restaurantId: restaurant.id },
      select: { id: true }
    });
    if (!table) {
      throw floorPlanError(404, 'TABLE_NOT_FOUND', 'Mesa no encontrada en este restaurante.', { tableId });
    }

    const blocked = await findTablesWithDependencies(prisma, [tableId]);
    if (blocked.length > 0) {
      throw floorPlanError(
        409,
        'TABLE_HAS_DEPENDENCIES',
        `La mesa '${blocked[0].label}' tiene ${blocked[0].reasons.join(', ')} y no puede eliminarse. Cerrá o archivá su operatoria primero.`,
        { tables: blocked }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.table.updateMany({
        where: { restaurantId: restaurant.id, mergedWithTableId: tableId },
        data: { mergedWithTableId: null }
      });
      await tx.table.deleteMany({
        where: { id: tableId, restaurantId: restaurant.id }
      });
    });

    return { success: true };
  }

  /**
   * Quick update for a single table position (e.g. on drag end).
   *
   * Etapa 26 (corrección Codex): `expectedVersion` es obligatorio. Su
   * ausencia se rechaza con 400 LAYOUT_VERSION_REQUIRED antes de cualquier
   * escritura; con versión presente rige CAS transaccional (versión fresca
   * mueve la mesa con bump, versión obsoleta 409 sin modificar nada).
   */
  async updateTablePosition(
    tableId: string,
    data: TablePositionUpdateDTO
  ): Promise<{ success: boolean; layoutVersion: number }> {
    if (data.expectedVersion === undefined) {
      throw floorPlanError(
        400,
        'LAYOUT_VERSION_REQUIRED',
        'Falta expectedVersion: recargá el plano y reintentá con la versión vigente.'
      );
    }

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });
    if (!table) {
      throw floorPlanError(404, 'TABLE_NOT_FOUND', 'Mesa no encontrada.', { tableId });
    }

    if (data.floorZoneId !== undefined && data.floorZoneId !== null) {
      const zone = await prisma.floorZone.findFirst({
        where: { id: data.floorZoneId, restaurantId: table.restaurantId },
        select: { id: true }
      });
      if (!zone) {
        throw floorPlanError(404, 'ZONE_NOT_FOUND', 'La zona no pertenece a este restaurante.', {
          zoneIds: [data.floorZoneId]
        });
      }
    }

    return prisma.$transaction(async (tx) => {
      let layout = await tx.floorPlanLayout.findFirst({
        where: { restaurantId: table.restaurantId, isActive: true }
      });

      if (!layout) {
        layout = await tx.floorPlanLayout.create({
          data: { restaurantId: table.restaurantId, name: 'Principal', version: 0 }
        });
      }

      const guarded = await tx.floorPlanLayout.updateMany({
        where: { id: layout.id, version: data.expectedVersion },
        data: { version: { increment: 1 } }
      });
      if (guarded.count === 0) {
        const current = await tx.floorPlanLayout.findUnique({
          where: { id: layout.id },
          select: { version: true }
        });
        throw floorPlanError(
          409,
          'LAYOUT_VERSION_CONFLICT',
          `El plano cambió desde tu última carga (versión actual ${current?.version ?? 'desconocida'}). Recargá el plano y reintentá de forma consciente; tu borrador local se conserva.`,
          { expectedVersion: data.expectedVersion, currentVersion: current?.version ?? null }
        );
      }
      layout = await tx.floorPlanLayout.findUniqueOrThrow({ where: { id: layout.id } });

      await tx.table.update({
        where: { id: tableId },
        data: {
          posX: data.posX,
          posY: data.posY,
          ...(data.rotation !== undefined && { rotation: data.rotation }),
          ...(data.floorZoneId !== undefined && { floorZoneId: data.floorZoneId })
        }
      });

      return { success: true, layoutVersion: layout.version };
    });
  }

  /**
   * Creates a floor plan zone
   */
  async createZone(restaurantIdOrSlug: string, data: ZoneCreateDTO) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      throw new Error(`Restaurante ${restaurantIdOrSlug} no encontrado`);
    }

    return prisma.floorZone.create({
      data: {
        restaurantId: restaurant.id,
        name: data.name,
        color: data.color || '#3b82f6',
        orderIndex: data.orderIndex || 0,
        polygonPoints: data.polygonPoints ? JSON.stringify(data.polygonPoints) : null
      }
    });
  }

  /**
   * Updates a floor plan zone
   */
  async updateZone(zoneId: string, data: ZoneUpdateDTO) {
    return prisma.floorZone.update({
      where: { id: zoneId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.color && { color: data.color }),
        ...(data.orderIndex !== undefined && { orderIndex: data.orderIndex }),
        ...(data.polygonPoints && { polygonPoints: JSON.stringify(data.polygonPoints) })
      }
    });
  }

  /**
   * Deletes a zone and detaches any assigned tables
   */
  async deleteZone(zoneId: string) {
    await prisma.table.updateMany({
      where: { floorZoneId: zoneId },
      data: { floorZoneId: null }
    });

    return prisma.floorZone.delete({
      where: { id: zoneId }
    });
  }
}

export const floorPlanService = new FloorPlanService();
