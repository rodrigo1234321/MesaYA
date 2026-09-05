import React, { useState } from 'react';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import {
  FloorTableDTO,
  TableFSMState,
  STATE_COLORS,
  STATE_LABELS,
  STATE_EMOJIS,
  getNextState,
  NEXT_STATE_BUTTON_LABELS
} from '@mesaya/shared';
import { AdminApi } from '../../lib/api';
import {
  Users,
  Plus,
  Trash2,
  Copy,
  Link2,
  Unlink2,
  Edit2,
  Check,
  X,
  Building2,
  ArrowUpRight,
  Sun,
  Wine,
  TreePine,
  Clock
} from 'lucide-react';

interface FloorPlanCardsViewProps {
  restaurantSlug: string;
}

export const FloorPlanCardsView: React.FC<FloorPlanCardsViewProps> = ({ restaurantSlug }) => {
  const {
    tables,
    activeSector,
    deleteTableDirect,
    mergeTablesDirect,
    unmergeTableDirect,
    updateTableDirect,
    addTableLocal
  } = useFloorPlanStore();

  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [newLabelText, setNewLabelText] = useState('');
  const [targetMergeId, setTargetMergeId] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const sectorsConfig = [
    { id: 'SALON_PRINCIPAL', label: 'Salón Principal', emoji: '🏛️', icon: Building2 },
    { id: 'PLANTA_ALTA', label: 'Segundo Piso (Planta Alta)', emoji: '🪜', icon: ArrowUpRight },
    { id: 'TERRAZA', label: 'Terraza Exterior', emoji: '☀️', icon: Sun },
    { id: 'BARRA', label: 'Barra de Cócteles', emoji: '🍸', icon: Wine },
    { id: 'VEREDA', label: 'Vereda / Patio', emoji: '🌳', icon: TreePine }
  ];

  // Filter tables by activeSector
  const filteredTables = tables.filter((t) => {
    if (activeSector === 'ALL') return true;
    return t.sector === activeSector;
  });

  const handleStartEditLabel = (table: FloorTableDTO) => {
    setEditingLabelId(table.id);
    setNewLabelText(table.label);
  };

  const handleSaveLabel = async (tableId: string) => {
    if (!newLabelText.trim()) return;
    setActionLoading(tableId);
    try {
      await updateTableDirect(restaurantSlug, tableId, { label: newLabelText.trim() });
      setEditingLabelId(null);
    } catch (e) {
      alert('Error al renombrar mesa. Verifica que no haya otra con el mismo nombre.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCapacityChange = async (table: FloorTableDTO, delta: number) => {
    const newCap = Math.max(1, Math.min(30, (table.capacity || 4) + delta));
    setActionLoading(table.id);
    try {
      await updateTableDirect(restaurantSlug, table.id, { capacity: newCap });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSectorChange = async (table: FloorTableDTO, newSector: string) => {
    setActionLoading(table.id);
    try {
      await updateTableDirect(restaurantSlug, table.id, {
        sector: newSector,
        isOutdoor: newSector === 'TERRAZA' || newSector === 'VEREDA'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMerge = async (sourceId: string) => {
    const partnerId = targetMergeId[sourceId];
    if (!partnerId) return;
    setActionLoading(sourceId);
    try {
      await mergeTablesDirect(restaurantSlug, sourceId, partnerId);
      setTargetMergeId((prev) => ({ ...prev, [sourceId]: '' }));
    } catch (e) {
      alert('Error al unir mesas');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnmerge = async (tableId: string) => {
    setActionLoading(tableId);
    try {
      await unmergeTableDirect(restaurantSlug, tableId);
    } catch (e) {
      alert('Error al separar mesas');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (tableId: string) => {
    setActionLoading(tableId);
    try {
      await deleteTableDirect(restaurantSlug, tableId);
      setDeletingId(null);
    } catch (e) {
      alert('Error al eliminar mesa');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDuplicate = async (table: FloorTableDTO) => {
    setActionLoading(table.id);
    try {
      const newLabel = `${table.label} (Copia)`;
      const newTable: FloorTableDTO = {
        ...table,
        id: `new-${Date.now()}`,
        label: newLabel,
        posX: table.posX + 30,
        posY: table.posY + 30,
        currentState: TableFSMState.AVAILABLE,
        mergedWithLabel: null,
        mergedWithTableId: null,
        activeCall: null
      };
      addTableLocal(newTable);
      await updateTableDirect(restaurantSlug, newTable.id, newTable);
    } finally {
      setActionLoading(null);
    }
  };

  const handleTapState = async (table: FloorTableDTO) => {
    setActionLoading(table.id);
    try {
      const res = await AdminApi.tapTableState(table.id, {
        action: 'next',
        expectedCurrentState: table.currentState as TableFSMState
      });
      await updateTableDirect(restaurantSlug, table.id, {
        currentState: res.newState,
        stateChangedAt: new Date().toISOString()
      });
    } catch (e) {
      console.error('Error tapping state:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddNewTable = async () => {
    const currentSector = activeSector === 'ALL' ? 'SALON_PRINCIPAL' : activeSector;
    const sectorCount = tables.filter((t) => t.sector === currentSector).length;
    const sectorLabel = sectorsConfig.find((s) => s.id === currentSector)?.label || 'Mesa';
    const newLabel = `${sectorLabel} ${sectorCount + 1}`;

    const newTable: FloorTableDTO = {
      id: `new-${Date.now()}`,
      restaurantId: '',
      label: newLabel,
      sector: currentSector,
      isOutdoor: currentSector === 'TERRAZA' || currentSector === 'VEREDA',
      posX: 100 + (sectorCount % 5) * 120,
      posY: 100 + Math.floor(sectorCount / 5) * 120,
      width: 85,
      height: 85,
      rotation: 0,
      shape: 'RECT',
      capacity: 4,
      floorZoneId: null,
      zoneName: null,
      currentState: TableFSMState.AVAILABLE,
      stateChangedAt: new Date().toISOString(),
      stateColor: '#22c55e',
      stateEmoji: '🟢',
      occupancyMinutes: null,
      activeCall: null,
      activeSessionToken: null,
      mergedWithTableId: null,
      mergedWithLabel: null
    };

    addTableLocal(newTable);
    await updateTableDirect(restaurantSlug, newTable.id, newTable);
  };

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-slate-950">
      {/* Top Banner / Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span>📋 Gestión y Tarjetas de Salón</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
              {filteredTables.length} mesas visibles
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Vista organizada sin superposiciones: edita nombres, une mesas con 1 clic, cambia capacidades y elimina con total control.
          </p>
        </div>

        <button
          onClick={handleAddNewTable}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Mesa en {sectorsConfig.find((s) => s.id === activeSector)?.label || 'Salón'}</span>
        </button>
      </div>

      {/* Grid of Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTables.map((table) => {
          const fsmState = (table.currentState as TableFSMState) || TableFSMState.AVAILABLE;
          const visual = STATE_COLORS[fsmState] || STATE_COLORS[TableFSMState.AVAILABLE];
          const isMerged = !!table.mergedWithTableId;
          const isLoading = actionLoading === table.id;

          // Merge candidates
          const mergeCandidates = tables.filter(
            (t) => t.id !== table.id && !t.mergedWithTableId
          );

          return (
            <div
              key={table.id}
              className={`rounded-2xl border bg-slate-900/90 backdrop-blur-md p-4 flex flex-col justify-between transition-all duration-200 shadow-xl ${
                isMerged
                  ? 'border-amber-500/60 ring-1 ring-amber-500/40 shadow-amber-500/5'
                  : 'border-slate-800 hover:border-slate-700'
              } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {/* Card Header: Table Name & FSM Status */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  {/* Name with inline editing */}
                  <div className="flex-1">
                    {editingLabelId === table.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newLabelText}
                          onChange={(e) => setNewLabelText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveLabel(table.id);
                            if (e.key === 'Escape') setEditingLabelId(null);
                          }}
                          autoFocus
                          className="w-full px-2.5 py-1 text-sm font-black text-white bg-slate-800 rounded-lg border border-sky-500 focus:outline-none"
                        />
                        <button
                          onClick={() => handleSaveLabel(table.id)}
                          className="p-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950"
                          title="Guardar Nombre"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingLabelId(null)}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <h3 className="text-base font-black text-white tracking-wide truncate">
                          {table.label}
                        </h3>
                        <button
                          onClick={() => handleStartEditLabel(table)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                          title="Renombrar Mesa"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Sector Selector Dropdown */}
                    <div className="mt-1 flex items-center gap-1.5">
                      <select
                        value={table.sector || 'SALON_PRINCIPAL'}
                        onChange={(e) => handleSectorChange(table, e.target.value)}
                        className="text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700/80 rounded-md px-2 py-0.5 focus:outline-none focus:border-amber-500"
                      >
                        {sectorsConfig.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.emoji} {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <button
                    onClick={() => handleTapState(table)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black shadow-sm transition-transform active:scale-95 shrink-0"
                    style={{
                      backgroundColor: `${visual.hex}22`,
                      color: visual.hex,
                      borderColor: `${visual.hex}55`,
                      borderWidth: 1
                    }}
                    title="Clic para avanzar estado en el ciclo RTMS"
                  >
                    <span>{STATE_EMOJIS[fsmState]}</span>
                    <span>{STATE_LABELS[fsmState]}</span>
                  </button>
                </div>

                {/* Occupancy Timer if active */}
                {table.occupancyMinutes !== null && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-300 font-medium px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 w-fit">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>Ocupada hace {table.occupancyMinutes}m</span>
                  </div>
                )}

                {/* Capacity Counter */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>Comensales:</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCapacityChange(table, -1)}
                      className="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-black flex items-center justify-center transition-colors active:scale-90"
                    >
                      -
                    </button>
                    <span className="text-xs font-black text-white w-6 text-center">
                      {table.capacity || 4}
                    </span>
                    <button
                      onClick={() => handleCapacityChange(table, 1)}
                      className="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-black flex items-center justify-center transition-colors active:scale-90"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Juntar / Unir Mesas Section */}
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-amber-300 flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      <span>Unión de Mesas</span>
                    </span>
                    {isMerged && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-black">
                        UNIDAS
                      </span>
                    )}
                  </div>

                  {isMerged ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-amber-200">
                        🔗 Unida a <strong>{table.mergedWithLabel || 'Mesa Compañera'}</strong>
                      </p>
                      <button
                        onClick={() => handleUnmerge(table.id)}
                        className="w-full py-1.5 px-2 rounded-lg bg-amber-500/20 hover:bg-rose-950/80 border border-amber-500/40 hover:border-rose-700 text-amber-300 hover:text-rose-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
                      >
                        <Unlink2 className="w-3 h-3 text-rose-400" />
                        <span>⚡ Separar Mesas</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={targetMergeId[table.id] || ''}
                        onChange={(e) =>
                          setTargetMergeId((prev) => ({ ...prev, [table.id]: e.target.value }))
                        }
                        className="flex-1 text-[11px] bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="">Elegir vecina...</option>
                        {mergeCandidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} ({c.capacity}p)
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleMerge(table.id)}
                        disabled={!targetMergeId[table.id]}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${
                          targetMergeId[table.id]
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        }`}
                      >
                        Unir
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer: Duplicate & Delete actions */}
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleDuplicate(table)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                  title="Duplicar Mesa"
                >
                  <Copy className="w-3.5 h-3.5 text-sky-400" />
                  <span>Clonar</span>
                </button>

                {deletingId === table.id ? (
                  <div className="flex items-center gap-1 animate-fadeIn">
                    <button
                      onClick={() => handleDelete(table.id)}
                      className="px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black"
                    >
                      Sí, borrar
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-1.5 py-1 rounded-md bg-slate-800 text-slate-400 text-[10px]"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingId(table.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors"
                    title="Eliminar Mesa Definitivamente"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add New Table Quick Card */}
        <button
          onClick={handleAddNewTable}
          className="rounded-2xl border-2 border-dashed border-slate-800 hover:border-amber-500/60 bg-slate-900/30 hover:bg-amber-500/5 p-6 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-amber-300 transition-all min-h-[220px] group"
        >
          <div className="w-12 h-12 rounded-2xl bg-slate-800 group-hover:bg-amber-500/20 text-slate-400 group-hover:text-amber-300 flex items-center justify-center transition-colors">
            <Plus className="w-6 h-6" />
          </div>
          <span className="text-sm font-black">
            Agregar Mesa en {sectorsConfig.find((s) => s.id === activeSector)?.label || 'este sector'}
          </span>
          <span className="text-xs text-slate-500 text-center">
            Se crea de inmediato y se sincroniza en tiempo real
          </span>
        </button>
      </div>
    </div>
  );
};
