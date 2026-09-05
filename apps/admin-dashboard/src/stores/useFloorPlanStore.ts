import { create } from 'zustand';
import {
  FloorTableDTO,
  FloorZoneDTO,
  FloorLayoutDTO,
  TableStateChangedEvent,
  TableFSMState,
  TableShape
} from '@mesaya/shared';
import { AdminApi } from '../lib/api';

interface FloorPlanConflictInfo {
  expectedVersion: number;
  currentVersion: number | null;
  message: string;
}

interface FloorPlanStoreState {
  // Data
  layout: FloorLayoutDTO;
  zones: FloorZoneDTO[];
  tables: FloorTableDTO[];
  loading: boolean;
  error: string | null;

  // Viewport
  scale: number;
  offset: { x: number; y: number };

  // UI state
  selectedTableId: string | null;
  isEditorMode: boolean;
  viewMode: 'CANVAS' | 'CARDS';
  filterState: string; // 'ALL' or TableFSMState
  filterZoneId: string | null;
  activeSector: string; // 'ALL' | 'SALON_PRINCIPAL' | 'PLANTA_ALTA' | 'TERRAZA' | 'BARRA' | 'VEREDA'
  isConnected: boolean;
  hasUnsavedChanges: boolean;
  floorPlanConflict: FloorPlanConflictInfo | null;
  conflictDraft: FloorTableDTO[] | null;

  // Actions
  setFloorPlanData: (data: { layout: FloorLayoutDTO; zones: FloorZoneDTO[]; tables: FloorTableDTO[] }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setScale: (scale: number) => void;
  setOffset: (offset: { x: number; y: number }) => void;
  selectTableCell: (id: string | null) => void;
  toggleEditorMode: () => void;
  setViewMode: (mode: 'CANVAS' | 'CARDS') => void;
  setFilterState: (state: string) => void;
  setFilterZoneId: (zoneId: string | null) => void;
  setActiveSector: (sector: string) => void;
  setIsConnected: (connected: boolean) => void;

  // Real-time Event Handlers
  handleSnapshot: (snapshotTables: FloorTableDTO[]) => void;
  handleStateChanged: (event: TableStateChangedEvent) => void;

  // Direct Async Actions (immediate persistence)
  deleteTableDirect: (restaurantSlug: string, tableId: string) => Promise<void>;
  mergeTablesDirect: (restaurantSlug: string, tableId1: string, tableId2: string) => Promise<void>;
  unmergeTableDirect: (restaurantSlug: string, tableId: string) => Promise<void>;
  updateTableDirect: (restaurantSlug: string, tableId: string, updates: Partial<FloorTableDTO>) => Promise<void>;

  // Editor Actions (persistencia consciente de versión, Etapa 26)
  saveFloorPlan: (restaurantSlug: string) => Promise<void>;
  reloadServerPlanAfterConflict: (restaurantSlug: string) => Promise<void>;
  restoreDraftAfterConflict: () => void;
  dismissFloorPlanConflict: () => void;
  updateTablePositionLocal: (tableId: string, posX: number, posY: number) => void;
  updateTableGeometryLocal: (
    tableId: string,
    updates: Partial<Pick<FloorTableDTO, 'width' | 'height' | 'rotation' | 'shape' | 'capacity' | 'floorZoneId' | 'label' | 'sector' | 'isOutdoor' | 'mergedWithLabel' | 'mergedWithTableId'>>
  ) => void;
  addTableLocal: (table: FloorTableDTO) => void;
  duplicateTableLocal: (tableId: string) => void;
  mergeTablesLocal: (tableId1: string, tableId2: string) => void;
  unmergeTableLocal: (tableId: string) => void;
  removeTableLocal: (tableId: string) => void;
  markChangesSaved: () => void;
}

function serializeTablesForSave(tables: FloorTableDTO[]) {
  return tables.map((t) => ({
    id: t.id,
    label: t.label,
    sector: t.sector,
    isOutdoor: t.isOutdoor,
    posX: t.posX,
    posY: t.posY,
    width: t.width,
    height: t.height,
    rotation: t.rotation,
    shape: t.shape,
    capacity: t.capacity,
    floorZoneId: t.floorZoneId,
    mergedWithTableId: t.mergedWithTableId
  }));
}

export const useFloorPlanStore = create<FloorPlanStoreState>((set, get) => {
  // Etapa 26: persistencia con precondición de versión. Ante 409 el borrador
  // local se conserva intacto (tablas + hasUnsavedChanges) y se expone el
  // conflicto para recarga/reintento consciente.
  const persistTables = async (restaurantSlug: string, tables: FloorTableDTO[]): Promise<number> => {
    const { layout } = get();
    const expectedVersion = layout.version;
    try {
      const result = await AdminApi.updateFloorPlan(restaurantSlug, {
        canvasWidth: layout.canvasWidth,
        canvasHeight: layout.canvasHeight,
        gridSize: layout.gridSize,
        backgroundUrl: layout.backgroundUrl,
        tables: serializeTablesForSave(tables),
        expectedVersion
      });
      const layoutVersion = typeof result?.layoutVersion === 'number' ? result.layoutVersion : expectedVersion;
      set((state) => ({
        layout: { ...state.layout, version: layoutVersion },
        hasUnsavedChanges: false,
        floorPlanConflict: null,
        conflictDraft: null,
        error: null
      }));
      return layoutVersion;
    } catch (e: any) {
      if (e?.statusCode === 409 && e?.code === 'LAYOUT_VERSION_CONFLICT') {
        const currentVersion = typeof e?.details?.currentVersion === 'number' ? e.details.currentVersion : null;
        set({
          floorPlanConflict: {
            expectedVersion,
            currentVersion,
            message: e.message || 'El plano cambió en el servidor.'
          },
          conflictDraft: tables.map((t) => ({ ...t })),
          error: 'Otro editor guardó el plano antes. Tu borrador se conserva: recargá el plano del servidor y reintentá de forma consciente.'
        });
      }
      throw e;
    }
  };

  return {
  layout: {
    id: '',
    restaurantId: '',
    name: 'Principal',
    canvasWidth: 1200,
    canvasHeight: 800,
    gridSize: 20,
    backgroundUrl: null,
    isActive: true,
    version: 0
  },
  zones: [],
  tables: [],
  loading: true,
  error: null,

  scale: 1,
  offset: { x: 0, y: 0 },

  selectedTableId: null,
  isEditorMode: false,
  viewMode: 'CANVAS',
  filterState: 'ALL',
  filterZoneId: null,
  activeSector: 'SALON_PRINCIPAL',
  isConnected: false,
  hasUnsavedChanges: false,
  floorPlanConflict: null,
  conflictDraft: null,

  setFloorPlanData: (data) =>
    set({
      layout: data.layout,
      zones: data.zones,
      tables: data.tables,
      loading: false,
      error: null,
      hasUnsavedChanges: false,
      floorPlanConflict: null,
      conflictDraft: null
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setScale: (scale) => set({ scale }),
  setOffset: (offset) => set({ offset }),
  selectTableCell: (id) => set({ selectedTableId: id }),
  toggleEditorMode: () => set((state) => ({ isEditorMode: !state.isEditorMode })),
  setViewMode: (viewMode) => set({ viewMode }),
  setFilterState: (filterState) => set({ filterState }),
  setFilterZoneId: (filterZoneId) => set({ filterZoneId }),
  setActiveSector: (activeSector) => set({ activeSector }),
  setIsConnected: (isConnected) => set({ isConnected }),

  handleSnapshot: (snapshotTables) =>
    set((state) => {
      // Merge snapshot with existing positions
      return {
        tables: snapshotTables,
        isConnected: true
      };
    }),

  handleStateChanged: (event) =>
    set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== event.tableId) return t;
        return {
          ...t,
          currentState: event.newState,
          stateColor: event.stateColor,
          stateEmoji: event.stateEmoji,
          stateChangedAt: event.timestamp,
          occupancyMinutes: event.occupancyMinutes,
          activeCall: event.activeCall
            ? {
                id: event.activeCall.id,
                type: event.activeCall.type,
                paymentMethod: event.activeCall.paymentMethod,
                createdAt: event.timestamp
              }
            : null
        };
      })
    })),

  updateTablePositionLocal: (tableId, posX, posY) =>
    set((state) => ({
      hasUnsavedChanges: true,
      tables: state.tables.map((t) => (t.id === tableId ? { ...t, posX, posY } : t))
    })),

  updateTableGeometryLocal: (tableId, updates) =>
    set((state) => ({
      hasUnsavedChanges: true,
      tables: state.tables.map((t) => (t.id === tableId ? { ...t, ...updates } : t))
    })),

  addTableLocal: (table) =>
    set((state) => ({
      hasUnsavedChanges: true,
      tables: [...state.tables, table]
    })),

  duplicateTableLocal: (tableId) =>
    set((state) => {
      const orig = state.tables.find((t) => t.id === tableId);
      if (!orig) return state;
      const newTable: FloorTableDTO = {
        ...orig,
        id: `new-${Date.now()}`,
        label: `${orig.label} (Copia)`,
        posX: orig.posX + 30,
        posY: orig.posY + 30,
        currentState: TableFSMState.AVAILABLE,
        mergedWithLabel: null,
        mergedWithTableId: null,
        activeCall: null
      };
      return {
        hasUnsavedChanges: true,
        tables: [...state.tables, newTable],
        selectedTableId: newTable.id
      };
    }),

  mergeTablesLocal: (tableId1, tableId2) =>
    set((state) => {
      const t1 = state.tables.find((t) => t.id === tableId1);
      const t2 = state.tables.find((t) => t.id === tableId2);
      if (!t1 || !t2) return state;

      const combinedCapacity = (t1.capacity || 4) + (t2.capacity || 4);
      const combinedLabel = `${t1.label} + ${t2.label}`;

      return {
        hasUnsavedChanges: true,
        tables: state.tables.map((t) => {
          if (t.id === tableId1) {
            return {
              ...t,
              label: combinedLabel,
              capacity: combinedCapacity,
              mergedWithLabel: t2.label,
              mergedWithTableId: t2.id
            };
          }
          if (t.id === tableId2) {
            return {
              ...t,
              label: `${t2.label} (Unida)`,
              mergedWithLabel: t1.label,
              mergedWithTableId: t1.id
            };
          }
          return t;
        })
      };
    }),

  unmergeTableLocal: (tableId) =>
    set((state) => {
      const t1 = state.tables.find((t) => t.id === tableId);
      if (!t1 || !t1.mergedWithTableId) return state;
      const partnerId = t1.mergedWithTableId;

      return {
        hasUnsavedChanges: true,
        tables: state.tables.map((t) => {
          if (t.id === tableId) {
            const cleanLabel = t.label.includes(' + ') ? t.label.split(' + ')[0] : t.label;
            return {
              ...t,
              label: cleanLabel,
              capacity: Math.max(2, Math.floor((t.capacity || 4) / 2)),
              mergedWithLabel: null,
              mergedWithTableId: null
            };
          }
          if (t.id === partnerId) {
            const cleanPartnerLabel = t.label.replace(' (Unida)', '');
            return {
              ...t,
              label: cleanPartnerLabel,
              mergedWithLabel: null,
              mergedWithTableId: null
            };
          }
          return t;
        })
      };
    }),

  // Direct Async Actions with Immediate Backend Persistence
  deleteTableDirect: async (restaurantSlug: string, tableId: string) => {
    try {
      await AdminApi.deleteTable(restaurantSlug, tableId);
      set((state) => ({
        selectedTableId: state.selectedTableId === tableId ? null : state.selectedTableId,
        tables: state.tables
          .filter((t) => t.id !== tableId)
          .map((t) =>
            t.mergedWithTableId === tableId
              ? { ...t, mergedWithTableId: null, mergedWithLabel: null }
              : t
          )
      }));
    } catch (err) {
      console.error('Failed to delete table:', err);
      throw err;
    }
  },

  mergeTablesDirect: async (restaurantSlug: string, tableId1: string, tableId2: string) => {
    const state = get();
    const t1 = state.tables.find((t) => t.id === tableId1);
    const t2 = state.tables.find((t) => t.id === tableId2);
    if (!t1 || !t2) return;

    const combinedCapacity = (t1.capacity || 4) + (t2.capacity || 4);
    const combinedLabel = `${t1.label} + ${t2.label}`;

    const updatedTables = state.tables.map((t) => {
      if (t.id === tableId1) {
        return {
          ...t,
          label: combinedLabel,
          capacity: combinedCapacity,
          mergedWithLabel: t2.label,
          mergedWithTableId: t2.id
        };
      }
      if (t.id === tableId2) {
        return {
          ...t,
          label: `${t2.label} (Unida)`,
          mergedWithLabel: t1.label,
          mergedWithTableId: t1.id
        };
      }
      return t;
    });

    set({ tables: updatedTables });

    try {
      await persistTables(restaurantSlug, updatedTables);
    } catch (e) {
      console.error('Error saving merged tables:', e);
      throw e;
    }
  },

  unmergeTableDirect: async (restaurantSlug: string, tableId: string) => {
    const state = get();
    const t1 = state.tables.find((t) => t.id === tableId);
    if (!t1 || !t1.mergedWithTableId) return;
    const partnerId = t1.mergedWithTableId;

    const updatedTables = state.tables.map((t) => {
      if (t.id === tableId) {
        const cleanLabel = t.label.includes(' + ') ? t.label.split(' + ')[0] : t.label;
        return {
          ...t,
          label: cleanLabel,
          capacity: Math.max(2, Math.floor((t.capacity || 4) / 2)),
          mergedWithLabel: null,
          mergedWithTableId: null
        };
      }
      if (t.id === partnerId) {
        const cleanPartnerLabel = t.label.replace(' (Unida)', '');
        return {
          ...t,
          label: cleanPartnerLabel,
          mergedWithLabel: null,
          mergedWithTableId: null
        };
      }
      return t;
    });

    set({ tables: updatedTables });

    try {
      await persistTables(restaurantSlug, updatedTables);
    } catch (e) {
      console.error('Error saving unmerged tables:', e);
      throw e;
    }
  },

  updateTableDirect: async (restaurantSlug: string, tableId: string, updates: Partial<FloorTableDTO>) => {
    const state = get();
    const updatedTables = state.tables.map((t) => (t.id === tableId ? { ...t, ...updates } : t));
    set({ tables: updatedTables });

    try {
      await persistTables(restaurantSlug, updatedTables);
    } catch (e) {
      console.error('Error updating table:', e);
      throw e;
    }
  },

  removeTableLocal: (tableId) =>
    set((state) => ({
      hasUnsavedChanges: true,
      selectedTableId: state.selectedTableId === tableId ? null : state.selectedTableId,
      tables: state.tables.filter((t) => t.id !== tableId)
    })),

  markChangesSaved: () => set({ hasUnsavedChanges: false }),

  saveFloorPlan: async (restaurantSlug: string) => {
    const { tables } = get();
    await persistTables(restaurantSlug, tables);
  },

  reloadServerPlanAfterConflict: async (restaurantSlug: string) => {
    // Recarga consciente: trae el plano del servidor pero conserva el
    // borrador local en conflictDraft para no perder ningún cambio.
    const draftBackup = get().tables.map((t) => ({ ...t }));
    const data = await AdminApi.getFloorPlan(restaurantSlug);
    set({
      layout: data.layout,
      zones: data.zones,
      tables: data.tables,
      loading: false,
      error: null,
      hasUnsavedChanges: true,
      conflictDraft: draftBackup
    });
  },

  restoreDraftAfterConflict: () => {
    const { conflictDraft } = get();
    if (!conflictDraft) return;
    set({ tables: conflictDraft, conflictDraft: null, hasUnsavedChanges: true });
  },

  dismissFloorPlanConflict: () => set({ floorPlanConflict: null })
  };
});
