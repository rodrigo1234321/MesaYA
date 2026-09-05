import React, { useEffect, useState } from 'react';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import { useFloorPlanSSE } from '../../hooks/useFloorPlanSSE';
import { AdminApi } from '../../lib/api';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { FloorPlanToolbar } from './FloorPlanToolbar';
import { FloorPlanCardsView } from './FloorPlanCardsView';
import { TableActionModal } from './TableActionModal';
import { TableEditorSidebar } from './TableEditorSidebar';
import { FloorTableDTO, TableFSMState } from '@mesaya/shared';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface FloorPlanManagerProps {
  restaurantSlug: string;
}

export const FloorPlanManager: React.FC<FloorPlanManagerProps> = ({ restaurantSlug }) => {
  const {
    loading,
    error,
    tables,
    layout,
    selectedTableId,
    selectTableCell,
    isEditorMode,
    viewMode,
    activeSector,
    setFloorPlanData,
    setLoading,
    setError,
    addTableLocal,
    saveFloorPlan,
    floorPlanConflict,
    reloadServerPlanAfterConflict,
    restoreDraftAfterConflict,
    dismissFloorPlanConflict,
    handleStateChanged
  } = useFloorPlanStore();

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 1. Activate Live SSE Realtime Connection
  useFloorPlanSSE(restaurantSlug);

  // 2. Fetch initial floor plan layout from REST API
  const loadFloorPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await AdminApi.getFloorPlan(restaurantSlug);
      setFloorPlanData(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar plano de mesas');
    }
  };

  useEffect(() => {
    loadFloorPlan();
  }, [restaurantSlug]);

  // 3. Save layout in bulk (for editor mode) — Etapa 26: pasa por el action
  // versionado del store (expectedVersion + preservación del borrador ante 409).
  const handleSaveLayout = async () => {
    setSaving(true);
    try {
      await saveFloorPlan(restaurantSlug);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      if (err?.statusCode !== 409 || err?.code !== 'LAYOUT_VERSION_CONFLICT') {
        alert(err.message || 'Error al guardar plano');
      }
      // 409: el store conserva el borrador y expone floorPlanConflict (banner).
    } finally {
      setSaving(false);
    }
  };

  // 3b. Reintento consciente tras conflicto: restaura el borrador preservado
  // sobre la versión fresca del servidor y vuelve a guardar.
  const handleRetryAfterConflict = async () => {
    setSaving(true);
    try {
      restoreDraftAfterConflict();
      await saveFloorPlan(restaurantSlug);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      if (err?.statusCode !== 409 || err?.code !== 'LAYOUT_VERSION_CONFLICT') {
        alert(err.message || 'Error al guardar plano');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReloadServerPlan = async () => {
    setSaving(true);
    try {
      await reloadServerPlanAfterConflict(restaurantSlug);
    } catch (err: any) {
      alert(err.message || 'Error al recargar el plano del servidor');
    } finally {
      setSaving(false);
    }
  };

  // 4. Add a new table in editor mode
  const handleAddTable = () => {
    const newNumber = tables.length + 1;
    const targetSector = activeSector !== 'ALL' ? activeSector : 'SALON_PRINCIPAL';
    const isOutdoor = targetSector === 'TERRAZA' || targetSector === 'VEREDA';

    const newTable: FloorTableDTO = {
      id: `new-${Date.now()}`,
      restaurantId: layout.restaurantId,
      label: `Mesa ${newNumber}`,
      sector: targetSector,
      isOutdoor,
      posX: 200,
      posY: 200,
      width: 80,
      height: 80,
      rotation: 0,
      shape: 'RECT',
      capacity: 4,
      floorZoneId: null,
      currentState: TableFSMState.AVAILABLE,
      stateChangedAt: new Date().toISOString(),
      stateColor: '#22c55e',
      stateEmoji: '🟢',
      occupancyMinutes: null,
      activeCall: null
    };

    addTableLocal(newTable);
    selectTableCell(newTable.id);
  };

  const selectedTable = tables.find((t) => t.id === selectedTableId) || null;

  if (loading && tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] bg-slate-950 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-3" />
        <p className="text-sm font-medium">Cargando plano en vivo de {restaurantSlug}...</p>
      </div>
    );
  }

  if (error && tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] bg-slate-950 text-slate-300 p-6 text-center">
        <AlertCircle className="w-10 h-10 text-rose-500 mb-3" />
        <h3 className="text-lg font-bold text-white mb-1">No se pudo cargar el plano</h3>
        <p className="text-sm text-slate-400 max-w-md mb-4">{error}</p>
        <button
          onClick={loadFloorPlan}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-bold text-white border border-slate-700 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Reintentar</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-130px)] bg-slate-950 overflow-hidden rounded-2xl border border-slate-800/80 shadow-2xl">
      {/* Top Toolbar */}
      <FloorPlanToolbar
        onSaveLayout={handleSaveLayout}
        saving={saving}
        onAddTable={handleAddTable}
      />

      {/* Etapa 26: conflicto de versión visible, borrador preservado */}
      {floorPlanConflict && (
        <div className="px-4 py-3 bg-amber-950/60 border-b border-amber-800/60 flex flex-wrap items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-bold text-amber-200">
              Otro editor guardó el plano antes (versión actual {floorPlanConflict.currentVersion ?? 'desconocida'}). Tu borrador se conserva, no se perdió ningún cambio.
            </p>
            <p className="text-xs text-amber-300/80">{floorPlanConflict.message}</p>
          </div>
          <button
            onClick={handleReloadServerPlan}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recargar plano del servidor</span>
          </button>
          <button
            onClick={handleRetryAfterConflict}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            <span>Reintentar con mis cambios</span>
          </button>
          <button
            onClick={dismissFloorPlanConflict}
            className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs font-bold"
          >
            <span>Ocultar</span>
          </button>
        </div>
      )}

      {/* Main Workspace (Canvas vs Cards View) */}
      <div className="flex flex-1 relative overflow-hidden">
        {viewMode === 'CANVAS' ? (
          <>
            {/* Konva Stage Canvas */}
            <div className="flex-1 h-full relative">
              <FloorPlanCanvas />

              {/* Success Toast */}
              {saveSuccess && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg animate-bounce">
                  ✓ Plano de mesas guardado correctamente
                </div>
              )}
            </div>

            {/* Editor Sidebar (only in Editor Mode) */}
            {isEditorMode && selectedTable && (
              <TableEditorSidebar restaurantSlug={restaurantSlug} />
            )}
          </>
        ) : (
          <FloorPlanCardsView restaurantSlug={restaurantSlug} />
        )}
      </div>

      {/* 1-Tap Action Modal for Salon Tablet (in Viewer Mode) */}
      {!isEditorMode && selectedTable && (
        <TableActionModal
          table={selectedTable}
          restaurantSlug={restaurantSlug}
          onClose={() => selectTableCell(null)}
          onStateUpdated={(tableId, newState) => {
            handleStateChanged({
              tableId,
              tableLabel: selectedTable.label,
              restaurantId: selectedTable.restaurantId,
              floorZoneId: selectedTable.floorZoneId,
              zoneName: selectedTable.zoneName ?? null,
              previousState: selectedTable.currentState,
              newState,
              stateColor: '#22c55e',
              stateEmoji: '🟢',
              trigger: '1-Tap Tablet Modal',
              source: 'STAFF_TERMINAL_TAP' as any,
              staffUserId: null,
              staffName: null,
              occupancyMinutes: selectedTable.occupancyMinutes,
              activeCall: null,
              timestamp: new Date().toISOString()
            });
          }}
        />
      )}
    </div>
  );
};
