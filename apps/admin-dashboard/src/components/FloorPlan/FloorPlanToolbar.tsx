import React from 'react';
import { TableFSMState } from '@mesaya/shared';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Edit3,
  Eye,
  Save,
  Plus,
  Building2,
  LayoutGrid,
  Map
} from 'lucide-react';

interface FloorPlanToolbarProps {
  onSaveLayout?: () => void;
  saving?: boolean;
  onAddTable?: () => void;
}

export const FloorPlanToolbar: React.FC<FloorPlanToolbarProps> = ({
  onSaveLayout,
  saving = false,
  onAddTable
}) => {
  const {
    scale,
    setScale,
    setOffset,
    isEditorMode,
    toggleEditorMode,
    viewMode,
    setViewMode,
    filterState,
    setFilterState,
    activeSector,
    setActiveSector,
    tables,
    isConnected,
    hasUnsavedChanges
  } = useFloorPlanStore();

  const sectorsList = [
    { id: 'ALL', label: 'Todo el Local', emoji: '🌐' },
    { id: 'SALON_PRINCIPAL', label: 'Salón Principal (PB)', emoji: '🏛️' },
    { id: 'PLANTA_ALTA', label: 'Segundo Piso', emoji: '🪜' },
    { id: 'TERRAZA', label: 'Terraza', emoji: '☀️' },
    { id: 'BARRA', label: 'Barra', emoji: '🍸' },
    { id: 'VEREDA', label: 'Vereda / Patio', emoji: '🌳' },
  ];

  // Summary counts
  const availableCount = tables.filter((t) => t.currentState === TableFSMState.AVAILABLE).length;
  const occupiedCount = tables.filter(
    (t) =>
      t.currentState !== TableFSMState.AVAILABLE &&
      t.currentState !== TableFSMState.RESERVED &&
      t.currentState !== TableFSMState.TO_CLEAN
  ).length;
  const billCount = tables.filter((t) => t.currentState === TableFSMState.BILL_REQUESTED).length;
  const toCleanCount = tables.filter((t) => t.currentState === TableFSMState.TO_CLEAN).length;

  const handleZoomIn = () => setScale(Math.min(2.5, scale + 0.15));
  const handleZoomOut = () => setScale(Math.max(0.4, scale - 0.15));
  const handleResetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
      {/* Left: Mode Toggle & Status Pills */}
      <div className="flex items-center gap-2">
        {/* Mode Switcher */}
        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => isEditorMode && toggleEditorMode()}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              !isEditorMode
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Salón en Vivo</span>
          </button>

          <button
            onClick={() => !isEditorMode && toggleEditorMode()}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              isEditorMode
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Editor Plano</span>
          </button>
        </div>

        {/* Live SSE Status Pill */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            isConnected
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
              : 'bg-rose-950/40 text-rose-400 border-rose-800/50 animate-pulse'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
            }`}
          />
          <span>{isConnected ? 'En Vivo' : 'Reconectando...'}</span>
        </div>

        {/* Editor Actions */}
        {isEditorMode && (
          <div className="flex items-center gap-2 ml-2">
            {onAddTable && (
              <button
                onClick={onAddTable}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-sky-400" />
                <span>Nueva Mesa</span>
              </button>
            )}

            {onSaveLayout && (
              <button
                onClick={onSaveLayout}
                disabled={saving || !hasUnsavedChanges}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  hasUnsavedChanges
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/40'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Guardando...' : hasUnsavedChanges ? 'Guardar Cambios' : 'Guardado'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Middle: Live Stats Pills */}
      {!isEditorMode && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            onClick={() => setFilterState('ALL')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
              filterState === 'ALL'
                ? 'bg-slate-800 text-white border-slate-600'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            Total: <span className="font-bold">{tables.length}</span>
          </button>

          <button
            onClick={() => setFilterState(TableFSMState.AVAILABLE)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-colors ${
              filterState === TableFSMState.AVAILABLE
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500'
                : 'bg-slate-900/60 text-emerald-400/80 border-slate-800 hover:border-emerald-800'
            }`}
          >
            <span>🟢</span>
            <span>Libres:</span>
            <span className="font-bold">{availableCount}</span>
          </button>

          <button
            onClick={() => setFilterState(TableFSMState.OCCUPIED_NO_ORDER)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-colors ${
              filterState === TableFSMState.OCCUPIED_NO_ORDER
                ? 'bg-amber-950/60 text-amber-300 border-amber-500'
                : 'bg-slate-900/60 text-amber-400/80 border-slate-800 hover:border-amber-800'
            }`}
          >
            <span>🟡</span>
            <span>Ocupadas:</span>
            <span className="font-bold">{occupiedCount}</span>
          </button>

          {billCount > 0 && (
            <button
              onClick={() => setFilterState(TableFSMState.BILL_REQUESTED)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-colors ${
                filterState === TableFSMState.BILL_REQUESTED
                  ? 'bg-purple-950/60 text-purple-300 border-purple-500'
                  : 'bg-purple-950/30 text-purple-400 border-purple-900 animate-pulse'
              }`}
            >
              <span>🟣</span>
              <span>Cuentas:</span>
              <span className="font-bold">{billCount}</span>
            </button>
          )}

          {toCleanCount > 0 && (
            <button
              onClick={() => setFilterState(TableFSMState.TO_CLEAN)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-colors ${
                filterState === TableFSMState.TO_CLEAN
                  ? 'bg-amber-950/60 text-amber-300 border-amber-700'
                  : 'bg-slate-900/60 text-amber-500/80 border-slate-800'
              }`}
            >
              <span>🟤</span>
              <span>Limpieza:</span>
              <span className="font-bold">{toCleanCount}</span>
            </button>
          )}
        </div>
      )}

      {/* Right Controls: View Mode & Zoom */}
      <div className="flex items-center gap-2">
        {/* View Mode Toggle (Plano 2D vs Tarjetas) */}
        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setViewMode('CANVAS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'CANVAS'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Vista de plano interactivo 2D"
          >
            <Map className="w-3.5 h-3.5" />
            <span>Plano 2D</span>
          </button>
          <button
            onClick={() => setViewMode('CARDS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'CARDS'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Vista organizada en tarjetas sin superposiciones"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Tarjetas</span>
          </button>
        </div>

        {/* Zoom Controls (only active in canvas mode) */}
        {viewMode === 'CANVAS' && (
          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl border border-slate-700/60">
            <button
              onClick={handleZoomOut}
              title="Alejar"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <span className="text-xs font-mono text-slate-300 px-1.5 min-w-[42px] text-center">
              {Math.round(scale * 100)}%
            </span>

            <button
              onClick={handleZoomIn}
              title="Acercar"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              onClick={handleResetZoom}
              title="Restablecer vista"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors ml-0.5"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Sub-Bar: Pisos & Sectores del Salón */}
      <div className="w-full pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex items-center gap-1.5 py-0.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Piso / Sector:</span>
          </span>

          {sectorsList.map((sec) => {
            const isSelected = activeSector === sec.id;
            const count = sec.id === 'ALL'
              ? tables.length
              : tables.filter((t) => t.sector === sec.id).length;

            return (
              <button
                key={sec.id}
                onClick={() => setActiveSector(sec.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
                  isSelected
                    ? isEditorMode
                      ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20 font-black'
                      : 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-black'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/50'
                }`}
              >
                <span>{sec.emoji}</span>
                <span>{sec.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-black ml-0.5 ${
                    isSelected
                      ? 'bg-slate-950/25 text-slate-950'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {activeSector !== 'ALL' && (
          <span className="text-xs text-slate-400 italic shrink-0 hidden lg:inline">
            Mesas en <strong>{sectorsList.find(s => s.id === activeSector)?.label}</strong>
          </span>
        )}
      </div>
    </div>
  );
};
