import React, { useEffect, useState } from 'react';
import { StaffApi } from '../lib/api';
import { WaitlistEntryDTO, WaitlistStatus, TableFSMState } from '@mesaya/shared';
import { Users, Phone, Clock, BellRing, Check, RefreshCw, ShoppingBag, AlertCircle, XCircle, UserX } from 'lucide-react';

interface Props {
  restaurantId: string;
}

interface TableOption {
  id: string;
  label: string;
  capacity?: number;
  sector?: string;
}

export const WaitlistManager: React.FC<Props> = ({ restaurantId }) => {
  const [queue, setQueue] = useState<WaitlistEntryDTO[]>([]);
  const [availableTables, setAvailableTables] = useState<TableOption[]>([]);
  const [selectedTables, setSelectedTables] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [seatingId, setSeatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedPreOrderId, setFailedPreOrderId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [waitlistData, floorPlanData] = await Promise.all([
        StaffApi.getWaitlist(restaurantId),
        StaffApi.getFloorPlan(restaurantId).catch(() => null)
      ]);
      setQueue(waitlistData.queue || []);

      if (floorPlanData && floorPlanData.tables) {
        const free = floorPlanData.tables
          .filter((t: any) => t.currentState === TableFSMState.AVAILABLE)
          .map((t: any) => ({
            id: t.id,
            label: t.label,
            capacity: t.capacity,
            sector: t.sector
          }));
        setAvailableTables(free);
      } else {
        const tables = await StaffApi.getTables(restaurantId).catch(() => []);
        const free = (tables || [])
          .filter((t: any) => !t.currentState || t.currentState === TableFSMState.AVAILABLE)
          .map((t: any) => ({
            id: t.id,
            label: t.label,
            capacity: t.capacity,
            sector: t.sector
          }));
        setAvailableTables(free);
      }
    } catch (err: any) {
      console.error('Error al cargar fila y mesas:', err);
      setErrorMessage(err.message || 'Error al actualizar información');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [restaurantId]);

  const handleCall = async (id: string) => {
    setErrorMessage(null);
    try {
      await StaffApi.callWaitlistGuest(id);
      await loadData();
    } catch (err: any) {
      console.error('Error al llamar:', err);
      setErrorMessage(err.message || 'Error al llamar comensal');
    }
  };

  const handleCancel = async (id: string) => {
    setErrorMessage(null);
    try {
      await StaffApi.cancelWaitlistGuest(id);
      await loadData();
    } catch (err: any) {
      console.error('Error al cancelar turno:', err);
      setErrorMessage(err.message || 'Error al cancelar turno');
    }
  };

  const handleNoShow = async (id: string) => {
    setErrorMessage(null);
    try {
      await StaffApi.markWaitlistNoShow(id);
      await loadData();
    } catch (err: any) {
      console.error('Error al marcar no-show:', err);
      setErrorMessage(err.message || 'Error al marcar no-show');
    }
  };

  const handleSeat = async (id: string, skipPreOrder = false) => {
    const tableId = selectedTables[id];
    if (!tableId || !tableId.trim()) {
      return;
    }
    // E07: recovery explícito con razón auditada; WAITER sin razón es PENDING_HUMAN.
    let skipReason: string | undefined;
    if (skipPreOrder) {
      skipReason = window.prompt('Motivo para omitir el pre-pedido (5..240 caracteres, quedará auditado):', 'Pre-pedido no disponible, se toma pedido manual en mesa') || undefined;
      if (skipReason && (skipReason.trim().length < 5 || skipReason.trim().length > 240)) {
        setErrorMessage('El motivo debe tener entre 5 y 240 caracteres');
        return;
      }
      if (!skipReason) {
        // Permitir MANAGER bypass sin razón corta, pero WAITER debe justificar.
        // El backend exigirá razón para WAITER; mostramos aviso.
        setErrorMessage('Para omitir el pre-pedido se requiere un motivo (o rol MANAGER).');
        return;
      }
    }
    setSeatingId(id);
    setErrorMessage(null);
    setFailedPreOrderId(null);
    try {
      await StaffApi.seatWaitlistGuest(id, tableId.trim(), skipPreOrder, skipReason);
      setSelectedTables(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await loadData();
    } catch (err: any) {
      console.error('Error al sentar:', err);
      setErrorMessage(err.message || 'Error al sentar comensal en la mesa elegida');
      if (err.code === 'PREORDER_PROMOTION_FAILED' || (err.message && err.message.includes('pre-pedido'))) {
        setFailedPreOrderId(id);
      }
    } finally {
      setSeatingId(null);
    }
  };

  if (loading && queue.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 space-x-2">
        <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
        <span className="text-xs font-bold">Cargando fila de espera y mesas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-bold">
          <Users className="w-4 h-4 text-cyan-400" />
          <span>Fila de Espera en Puerta ({queue.length})</span>
          <span className="text-[11px] text-slate-500 font-normal">
            • {availableTables.length} mesas libres
          </span>
        </div>
        <button
          onClick={loadData}
          className="text-xs text-cyan-400 font-semibold flex items-center gap-1 hover:underline"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Refrescar</span>
        </button>
      </div>

      {queue.length === 0 ? (
        <div className="py-12 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-1">
          <p className="text-xs font-bold text-slate-300">No hay grupos esperando en la puerta</p>
          <p className="text-[11px] text-slate-500">
            Apenas un comensal escanee el QR de entrada aparecerá acá
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {queue.map((item, index) => {
            const chosenTableId = selectedTables[item.id] || '';
            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all ${
                  item.status === WaitlistStatus.CALLED
                    ? 'bg-amber-950/20 border-amber-500/40 shadow-lg shadow-amber-950/20'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-300 font-black text-xs flex items-center justify-center font-mono">
                      #{index + 1}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm text-white">{item.guestName}</h4>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-slate-500" />
                          <strong>{item.partySize}</strong> personas
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-500" />
                          {item.phone}
                        </span>
                      </div>
                    </div>
                  </div>

                    <div className="flex flex-wrap items-center gap-2">
                    {item.status === WaitlistStatus.WAITING ? (
                      <button
                        onClick={() => handleCall(item.id)}
                        className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1 shadow-md shadow-amber-500/20 active:scale-95 transition-all"
                      >
                        <BellRing className="w-3.5 h-3.5" />
                        <span>Llamar</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-[11px] flex items-center gap-1 animate-pulse">
                          <Clock className="w-3 h-3" />
                          <span>Llamado</span>
                        </span>
                        <button
                          onClick={() => handleNoShow(item.id)}
                          className="px-2 py-1 rounded-lg border border-red-500/30 bg-red-950/30 hover:bg-red-950/60 text-red-300 text-[11px] font-bold flex items-center gap-1 transition-all"
                          title="Marcar como no-show"
                        >
                          <UserX className="w-3 h-3" />
                          <span>No-show</span>
                        </button>
                      </div>
                    )}

                    {/* Botón de cancelación de turno */}
                    <button
                      onClick={() => handleCancel(item.id)}
                      className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-red-950/40 hover:border-red-500/40 text-slate-400 hover:text-red-300 text-xs font-semibold transition-all"
                      title="Cancelar turno de fila"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>

                    {/* Selector explícito de mesa destino libre antes de permitir sentar */}
                    <div className="flex items-center gap-1.5">
                      <select
                        value={chosenTableId}
                        onChange={(e) => setSelectedTables(prev => ({ ...prev, [item.id]: e.target.value }))}
                        className="bg-slate-800 border border-slate-700 text-xs rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      >
                        <option value="">-- Mesa libre --</option>
                        {availableTables.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.label} (Cap: {t.capacity || '?'})
                          </option>
                        ))}
                      </select>

                      <button
                        disabled={!chosenTableId || seatingId === item.id}
                        onClick={() => handleSeat(item.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shadow-md transition-all ${
                          chosenTableId && seatingId !== item.id
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-95 cursor-pointer'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-50'
                        }`}
                        title={!chosenTableId ? 'Selecciona una mesa libre primero' : 'Sentar al grupo'}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{seatingId === item.id ? 'Sentando...' : 'Sentar'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Pre-Order preview y opción de recuperación */}
                {item.preOrderData && item.preOrderData.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-amber-300">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
                        Pre-orden lista ({item.preOrderData.reduce((s, it) => s + it.quantity, 0)} platos)
                      </span>
                      {failedPreOrderId === item.id && chosenTableId && (
                        <button
                          onClick={() => handleSeat(item.id, true)}
                          className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] shadow-sm transition-all"
                          title="Recovery explícito auditado: exige motivo"
                        >
                          Sentar sin pre-orden (con motivo)
                        </button>
                      )}
                    </div>
                    {failedPreOrderId === item.id && (
                      <p className="text-[10px] text-red-300">
                        La comanda del pre-pedido falló. Podés sentar al grupo sin el pedido automático y tomarles la orden en la mesa.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
