import React, { useState } from 'react';
import {
  FloorTableDTO,
  TableFSMState,
  STATE_COLORS,
  STATE_LABELS,
  STATE_EMOJIS,
  NEXT_STATE_BUTTON_LABELS,
  getNextState
} from '@mesaya/shared';
import { AdminApi } from '../../lib/api';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import {
  X,
  Clock,
  Users,
  AlertCircle,
  CreditCard,
  Bell,
  ArrowRight,
  Link2,
  Unlink2,
  Trash2,
  Edit2,
  Check,
  Building2,
  ArrowUpRight,
  Sun,
  Wine,
  TreePine
} from 'lucide-react';

interface TableActionModalProps {
  table: FloorTableDTO | null;
  onClose: () => void;
  onStateUpdated: (tableId: string, newState: TableFSMState) => void;
  restaurantSlug: string;
}

export const TableActionModal: React.FC<TableActionModalProps> = ({
  table,
  onClose,
  onStateUpdated,
  restaurantSlug
}) => {
  const {
    tables,
    deleteTableDirect,
    mergeTablesDirect,
    unmergeTableDirect,
    updateTableDirect
  } = useFloorPlanStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState(table?.label || '');
  const [targetMergeId, setTargetMergeId] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  if (!table) return null;

  const fsmState = table.currentState as TableFSMState;
  const nextState = getNextState(fsmState);
  const currentVisual = STATE_COLORS[fsmState] || STATE_COLORS[TableFSMState.AVAILABLE];
  const nextVisual = STATE_COLORS[nextState] || STATE_COLORS[TableFSMState.AVAILABLE];
  const nextButtonLabel = NEXT_STATE_BUTTON_LABELS[fsmState] || 'Siguiente Estado';

  const sectors = [
    { id: 'SALON_PRINCIPAL', label: 'Salón', emoji: '🏛️' },
    { id: 'PLANTA_ALTA', label: 'Piso 2', emoji: '🪜' },
    { id: 'TERRAZA', label: 'Terraza', emoji: '☀️' },
    { id: 'BARRA', label: 'Barra', emoji: '🍸' },
    { id: 'VEREDA', label: 'Vereda', emoji: '🌳' }
  ];

  const mergeCandidates = tables.filter(
    (t) => t.id !== table.id && !t.mergedWithTableId
  );

  const isMerged = !!table.mergedWithTableId;

  const handleNextAction = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AdminApi.tapTableState(table.id, {
        action: 'next',
        expectedCurrentState: fsmState
      });
      onStateUpdated(table.id, res.newState);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al cambiar estado');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipToAction = async (targetState: TableFSMState) => {
    setLoading(true);
    setError(null);
    try {
      const res = await AdminApi.tapTableState(table.id, {
        action: 'skip_to',
        targetState,
        expectedCurrentState: fsmState
      });
      onStateUpdated(table.id, res.newState);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al cambiar estado');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!newLabel.trim()) return;
    setLoading(true);
    try {
      await updateTableDirect(restaurantSlug, table.id, { label: newLabel.trim() });
      setIsEditingLabel(false);
    } catch (e: any) {
      setError('Error al renombrar mesa');
    } finally {
      setLoading(false);
    }
  };

  const handleCapacityChange = async (delta: number) => {
    const newCap = Math.max(1, Math.min(30, (table.capacity || 4) + delta));
    setLoading(true);
    try {
      await updateTableDirect(restaurantSlug, table.id, { capacity: newCap });
    } catch (e) {
      setError('Error al cambiar capacidad');
    } finally {
      setLoading(false);
    }
  };

  const handleSectorChange = async (newSector: string) => {
    setLoading(true);
    try {
      await updateTableDirect(restaurantSlug, table.id, {
        sector: newSector,
        isOutdoor: newSector === 'TERRAZA' || newSector === 'VEREDA'
      });
    } catch (e) {
      setError('Error al mover de piso');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!targetMergeId) return;
    setLoading(true);
    try {
      await mergeTablesDirect(restaurantSlug, table.id, targetMergeId);
      onClose();
    } catch (e) {
      setError('Error al unir mesas');
    } finally {
      setLoading(false);
    }
  };

  const handleUnmerge = async () => {
    setLoading(true);
    try {
      await unmergeTableDirect(restaurantSlug, table.id);
      onClose();
    } catch (e) {
      setError('Error al separar mesas');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteTableDirect(restaurantSlug, table.id);
      onClose();
    } catch (e) {
      setError('Error al eliminar mesa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header with Table Label and Current State Banner */}
        <div
          className="p-5 flex items-center justify-between border-b border-slate-800 shrink-0"
          style={{ backgroundColor: `${currentVisual.hex}18` }}
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl">{STATE_EMOJIS[fsmState]}</span>
            <div>
              {isEditingLabel ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveLabel();
                      if (e.key === 'Escape') setIsEditingLabel(false);
                    }}
                    autoFocus
                    className="px-2.5 py-1 text-sm font-black text-white bg-slate-800 rounded-lg border border-sky-500 focus:outline-none"
                  />
                  <button
                    onClick={handleSaveLabel}
                    className="p-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsEditingLabel(false)}
                    className="p-1 rounded-lg bg-slate-800 text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h2 className="text-xl font-bold text-white tracking-wide">{table.label}</h2>
                  <button
                    onClick={() => {
                      setNewLabel(table.label);
                      setIsEditingLabel(true);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
                    title="Renombrar Mesa"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {isMerged && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black">
                      UNIDA
                    </span>
                  )}
                </div>
              )}

              <p className="text-sm font-semibold mt-0.5" style={{ color: currentVisual.hex }}>
                {STATE_LABELS[fsmState]}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Floor / Sector Switcher */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400">Piso / Sector:</span>
            <div className="flex flex-wrap gap-1.5">
              {sectors.map((s) => {
                const isCurrent = (table.sector || 'SALON_PRINCIPAL') === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSectorChange(s.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                      isCurrent
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Metrics (Time seated & Capacity with +/-) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <p className="text-xs text-slate-400 font-medium">Permanencia</p>
                <p className="text-sm font-bold text-slate-200">
                  {table.occupancyMinutes !== null && table.occupancyMinutes > 0
                    ? `${table.occupancyMinutes} min`
                    : 'Recién iniciada'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-xs text-slate-400 font-medium">Capacidad:</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleCapacityChange(-1)}
                  className="w-5 h-5 rounded bg-slate-750 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center"
                >
                  -
                </button>
                <span className="text-xs font-black text-white px-1">{table.capacity || 4}</span>
                <button
                  onClick={() => handleCapacityChange(1)}
                  className="w-5 h-5 rounded bg-slate-750 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Juntar / Unir Mesas Section */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" />
                <span>Combinación / Unión de Mesas</span>
              </span>
            </div>

            {isMerged ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-200">
                  🔗 Esta mesa está unida con: <strong>{table.mergedWithLabel || 'Mesa compañera'}</strong>
                </p>
                <button
                  onClick={handleUnmerge}
                  disabled={loading}
                  className="w-full py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-rose-950/80 border border-amber-500/40 hover:border-rose-700 text-amber-300 hover:text-rose-300 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <Unlink2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>⚡ Separar Mesas</span>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={targetMergeId}
                  onChange={(e) => setTargetMergeId(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">Elegir mesa para unir...</option>
                  {mergeCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.capacity} pers. - {c.sector})
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleMerge}
                  disabled={!targetMergeId || loading}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                    targetMergeId
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  Unir
                </button>
              </div>
            )}
          </div>

          {/* Active Call Alert (if any) */}
          {table.activeCall && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-3 ${
                table.activeCall.type === 'BILL'
                  ? 'bg-purple-950/40 border-purple-800/50 text-purple-200'
                  : 'bg-amber-950/40 border-amber-800/50 text-amber-200'
              }`}
            >
              {table.activeCall.type === 'BILL' ? (
                <CreditCard className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              ) : (
                <Bell className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm">
                <p className="font-bold">
                  {table.activeCall.type === 'BILL' ? 'Solicitud de Cuenta' : 'Llamado al Mozo'}
                </p>
                <p className="text-xs opacity-90 mt-0.5">
                  Método de pago: <span className="font-semibold">{table.activeCall.paymentMethod}</span>
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center gap-2 text-rose-300 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Primary Action Button (1-Tap for Salon Tablet) */}
          <div className="pt-2">
            <button
              onClick={handleNextAction}
              disabled={loading}
              className="w-full py-3.5 px-6 rounded-xl font-bold text-white text-base shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{
                backgroundColor: nextVisual.hex,
                boxShadow: `0 4px 20px ${nextVisual.hex}40`
              }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>{STATE_EMOJIS[nextState]}</span>
                  <span>{nextButtonLabel}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {/* Secondary Fast Jump Actions */}
          <div className="pt-2 border-t border-slate-800/80">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Acciones Rápidas de Estado
            </p>
            <div className="flex flex-wrap gap-2">
              {fsmState !== TableFSMState.AVAILABLE && (
                <button
                  onClick={() => handleSkipToAction(TableFSMState.AVAILABLE)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 transition-colors"
                >
                  <span>🟢</span>
                  <span>Forzar Libre</span>
                </button>
              )}

              {fsmState !== TableFSMState.TO_CLEAN && (
                <button
                  onClick={() => handleSkipToAction(TableFSMState.TO_CLEAN)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-500 border border-amber-700/30 flex items-center gap-1.5 transition-colors"
                >
                  <span>🟤</span>
                  <span>Marcar Por Limpiar</span>
                </button>
              )}

              {fsmState !== TableFSMState.PAID && (
                <button
                  onClick={() => handleSkipToAction(TableFSMState.PAID)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-600/30 flex items-center gap-1.5 transition-colors"
                >
                  <span>⚪</span>
                  <span>Cobrado en Caja</span>
                </button>
              )}
            </div>
          </div>

          {/* Delete Table Section */}
          <div className="pt-2 border-t border-slate-800/80">
            {isConfirmingDelete ? (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 space-y-2">
                <p className="text-xs font-bold text-rose-300">
                  ¿Eliminar permanentemente {table.label}? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black"
                  >
                    Sí, eliminar del salón
                  </button>
                  <button
                    onClick={() => setIsConfirmingDelete(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsConfirmingDelete(true)}
                className="w-full py-2 px-3 rounded-xl bg-slate-850 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-800/50 text-slate-400 hover:text-rose-400 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar Mesa del Salón</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
