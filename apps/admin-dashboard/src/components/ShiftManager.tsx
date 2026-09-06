import React, { useState } from 'react';
import { AdminApi } from '../lib/api';
import { Play, Square, RefreshCw, ShieldCheck, Clock } from 'lucide-react';

interface ShiftManagerProps {
  currentShift: any;
  restaurantId: string;
  onRefresh: () => void;
}

export const ShiftManager: React.FC<ShiftManagerProps> = ({ currentShift, restaurantId, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isShiftActive = Boolean(currentShift && !currentShift.closedAt && currentShift.id);

  const handleOpenShift = async () => {
    if (!window.confirm('¿Deseas abrir un nuevo turno? Esto rotará todos los tokens UUID de las mesas para mayor seguridad anti-spam.')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await AdminApi.openShift(restaurantId);
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'No se pudo abrir el turno');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseShift = async () => {
    if (!window.confirm('¿Cerrar el turno actual? Se invalidarán todas las sesiones activas en el salón.')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await AdminApi.closeShift(currentShift.id, restaurantId);
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'No se pudo cerrar el turno');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            isShiftActive
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}>
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-base text-white">Estado del Turno de Salón</h3>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                isShiftActive
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}>
                {isShiftActive ? 'TURNO ACTIVO' : 'TURNO CERRADO'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isShiftActive
                ? `Iniciado: ${new Date(currentShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Tokens rotativos vigentes`
                : 'No hay turno activo. Abre el turno para habilitar los llamados de mesas.'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          {!isShiftActive ? (
            <button
              onClick={handleOpenShift}
              disabled={loading}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Abrir Turno de Salón</span>
            </button>
          ) : (
            <>
              <button
                onClick={handleOpenShift}
                disabled={loading}
                title="Regenera tokens manteniendo el servicio"
                className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 active:scale-95 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rotar Tokens</span>
              </button>
              <button
                onClick={handleCloseShift}
                disabled={loading}
                className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-200 font-bold text-xs active:scale-95 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Cerrar Turno</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs border-t border-slate-800/80">
        <div className="flex items-center space-x-2 text-slate-400">
          <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Anti-Spam: TTL de 3 horas por comensal</span>
        </div>
        <div className="flex items-center space-x-2 text-slate-400">
          <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Rate Limit: 1 llamado activo por mesa</span>
        </div>
        <div className="flex items-center space-x-2 text-slate-400">
          <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Fallback WhatsApp: 100% garantizado</span>
        </div>
      </div>
    </div>
  );
};
