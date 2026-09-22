import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloorLayoutDTO, FloorTableDTO, TableFSMState } from '@mesaya/shared';
import { useFloorPlanStore } from './useFloorPlanStore';

const layoutFixture = (version: number): FloorLayoutDTO => ({
  id: 'layout-1',
  restaurantId: 'rest-1',
  name: 'Principal',
  canvasWidth: 1200,
  canvasHeight: 800,
  gridSize: 20,
  backgroundUrl: null,
  isActive: true,
  version
});

const tableFixture = (over: Partial<FloorTableDTO> = {}): FloorTableDTO => ({
  id: 't1',
  restaurantId: 'rest-1',
  label: 'Mesa 1',
  sector: 'SALON_PRINCIPAL',
  isOutdoor: false,
  posX: 10,
  posY: 10,
  width: 80,
  height: 80,
  rotation: 0,
  shape: 'RECT',
  capacity: 4,
  floorZoneId: 'zone-1',
  currentState: TableFSMState.AVAILABLE,
  stateChangedAt: new Date().toISOString(),
  stateColor: '#22c55e',
  stateEmoji: '🟢',
  occupancyMinutes: null,
  activeCall: null,
  activeSessionToken: null,
  mergedWithLabel: 'Mesa 2',
  mergedWithTableId: 't2',
  ...over
});

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

describe('Etapa 26 (corrección) — action versionado del store usado por FloorPlanManager', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    });
    useFloorPlanStore.getState().setFloorPlanData({
      layout: layoutFixture(7),
      zones: [],
      tables: [tableFixture()]
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('1. saveFloorPlan envía expectedVersion, canvas y mergedWithTableId, y actualiza la versión devuelta', async () => {
    const calls: { url: string; init?: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: any) => {
        calls.push({ url, init });
        return okJson({ success: true, updatedTablesCount: 1, layoutVersion: 8 });
      })
    );

    await useFloorPlanStore.getState().saveFloorPlan('demo-slug');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/floor-plan/demo-slug');
    expect(calls[0].init.method).toBe('PUT');
    const body = JSON.parse(calls[0].init.body);
    expect(body.expectedVersion).toBe(7);
    expect(body.canvasWidth).toBe(1200);
    expect(body.canvasHeight).toBe(800);
    expect(body.gridSize).toBe(20);
    expect(body.tables[0].mergedWithTableId).toBe('t2');
    expect(body.tables[0].floorZoneId).toBe('zone-1');

    const state = useFloorPlanStore.getState();
    expect(state.layout.version).toBe(8);
    expect(state.hasUnsavedChanges).toBe(false);
    expect(state.floorPlanConflict).toBeNull();
  });

  it('2. un 409 no marca cambios como guardados y preserva el borrador local', async () => {
    // Edición local pendiente
    useFloorPlanStore.getState().updateTablePositionLocal('t1', 500, 500);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        errJson(409, {
          error: 'LAYOUT_VERSION_CONFLICT',
          message: 'El plano cambió desde tu última carga (versión actual 9).',
          details: { expectedVersion: 7, currentVersion: 9 }
        })
      )
    );

    const err: any = await useFloorPlanStore
      .getState()
      .saveFloorPlan('demo-slug')
      .then(
        () => null,
        (e) => e
      );
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('LAYOUT_VERSION_CONFLICT');

    const state = useFloorPlanStore.getState();
    // Borrador intacto: la edición local sigue presente y pendiente
    expect(state.tables.find((t) => t.id === 't1')?.posX).toBe(500);
    expect(state.hasUnsavedChanges).toBe(true);
    expect(state.floorPlanConflict).toMatchObject({ expectedVersion: 7, currentVersion: 9 });
    expect(state.conflictDraft?.find((t) => t.id === 't1')?.posX).toBe(500);
  });

  it('3. recarga del servidor + reintento consciente con versión fresca', async () => {
    useFloorPlanStore.getState().updateTablePositionLocal('t1', 500, 500);
    const fetchMock = vi.fn(async (_url: string, init?: any) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body);
        if (body.expectedVersion === 7) {
          return errJson(409, {
            error: 'LAYOUT_VERSION_CONFLICT',
            message: 'El plano cambió.',
            details: { expectedVersion: 7, currentVersion: 9 }
          });
        }
        return okJson({ success: true, updatedTablesCount: 1, layoutVersion: 10 });
      }
      // GET plano del servidor versión 9 con la mesa en otra posición
      return okJson({
        layout: layoutFixture(9),
        zones: [],
        tables: [tableFixture({ posX: 99, posY: 99, mergedWithTableId: null, mergedWithLabel: null })]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = useFloorPlanStore.getState();
    await store.saveFloorPlan('demo-slug').then(
      () => null,
      (e) => e
    );
    expect(useFloorPlanStore.getState().floorPlanConflict).not.toBeNull();

    // Recarga consciente: trae servidor pero conserva el borrador
    await useFloorPlanStore.getState().reloadServerPlanAfterConflict('demo-slug');
    let state = useFloorPlanStore.getState();
    expect(state.layout.version).toBe(9);
    expect(state.tables.find((t) => t.id === 't1')?.posX).toBe(99);
    expect(state.conflictDraft?.find((t) => t.id === 't1')?.posX).toBe(500);

    // Reintento: restaura el borrador y guarda con la versión fresca
    useFloorPlanStore.getState().restoreDraftAfterConflict();
    await useFloorPlanStore.getState().saveFloorPlan('demo-slug');

    const puts = fetchMock.mock.calls.filter(([, init]: any) => init?.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[1][1].body).expectedVersion).toBe(9);

    state = useFloorPlanStore.getState();
    expect(state.layout.version).toBe(10);
    expect(state.hasUnsavedChanges).toBe(false);
    expect(state.floorPlanConflict).toBeNull();
    expect(state.tables.find((t) => t.id === 't1')?.posX).toBe(500);
  });

  it('4. un snapshot en vivo no pisa la geometría del borrador local', () => {
    useFloorPlanStore.getState().updateTablePositionLocal('t1', 500, 500);

    useFloorPlanStore.getState().handleSnapshot([
      tableFixture({ posX: 99, posY: 99, currentState: TableFSMState.OCCUPIED_NO_ORDER })
    ]);

    const state = useFloorPlanStore.getState();
    expect(state.tables.find((table) => table.id === 't1')).toMatchObject({
      posX: 500,
      posY: 500,
      currentState: TableFSMState.AVAILABLE
    });
    expect(state.isConnected).toBe(true);
    expect(state.hasUnsavedChanges).toBe(true);
  });

  it('5. un fallo no conflictivo conserva el borrador y deja el guardado reintentable', async () => {
    useFloorPlanStore.getState().updateTablePositionLocal('t1', 700, 400);
    vi.stubGlobal('fetch', vi.fn(async () => errJson(503, { message: 'Servidor temporalmente no disponible' })));

    await expect(useFloorPlanStore.getState().saveFloorPlan('demo-slug')).rejects.toMatchObject({
      statusCode: 503
    });

    const state = useFloorPlanStore.getState();
    expect(state.tables.find((table) => table.id === 't1')).toMatchObject({ posX: 700, posY: 400 });
    expect(state.hasUnsavedChanges).toBe(true);
    expect(state.error).toContain('Servidor temporalmente no disponible');
    expect(state.floorPlanConflict).toBeNull();
  });
});
