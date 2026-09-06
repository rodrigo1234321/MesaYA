import React, { useEffect, useState } from 'react';
import { CallEventData, CallStatus, CallType, PaymentMethod, PAYMENT_METHOD_LABELS, SECTOR_LABELS } from '@mesaya/shared';
import { Clock, CheckCircle2, Navigation, MessageCircle, UserX } from 'lucide-react';

interface CallCardProps {
  call: CallEventData;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReleaseTable?: (tableId: string, callId: string) => void;
  onOpenBilling?: (tableId: string, tableLabel: string) => void;
}

export const CallCard: React.FC<CallCardProps> = ({ call, onAcknowledge, onResolve, onReleaseTable, onOpenBilling }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    function calc() {
      const start = new Date(call.createdAt).getTime();
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - start) / 1000)));
    }
    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [call.createdAt]);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const isOverdue = elapsedSeconds >= 180 && call.status === CallStatus.PENDING; // > 3 min
  const isInProgress = call.status === CallStatus.IN_PROGRESS;

  // Semáforo colors
  let borderClass = 'border-amber-500/40 bg-gradient-to-br from-amber-950/20 to-slate-900';
  let badgeBg = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  let badgeText = 'Pendiente';

  if (isInProgress) {
    borderClass = 'border-emerald-500/50 bg-gradient-to-br from-emerald-950/30 to-slate-900';
    badgeBg = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    badgeText = 'En camino';
  } else if (isOverdue) {
    borderClass = 'border-red-500/80 bg-gradient-to-br from-red-950/40 to-slate-900 shadow-lg shadow-red-950/40 animate-pulse';
    badgeBg = 'bg-red-500/30 text-red-200 border-red-500/50';
    badgeText = 'Urgente (>3m)';
  }

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 transition-all space-y-3.5 ${borderClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-xl bg-slate-800/90 border border-slate-700/80 flex items-center justify-center font-black text-sm text-white shadow-inner">
            {call.tableLabel.replace(/[^0-9]/g, '') || '#'}
          </div>
          <div>
            <h3 className="font-extrabold text-base text-white tracking-tight flex items-center gap-1.5">
              {call.tableLabel}
            </h3>
            <span className="text-[11px] font-semibold text-slate-400">
              {SECTOR_LABELS[call.sector] || call.sector}
            </span>
          </div>
        </div>

        <div className="text-right flex flex-col items-end space-y-1">
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeBg}`}>
            {badgeText}
          </span>
          <span className="text-[11px] font-mono font-medium text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeFormatted}
          </span>
        </div>
      </div>

      {/* Main Request Context */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200">
            {call.type === CallType.BILL && '💳 Pedido de Cuenta'}
            {call.type === CallType.WAITER && '🙋‍♂️ Llamado de Asistencia'}
            {call.type === CallType.SUPPLIES && '🧂 Insumos / Vajilla'}
            {call.type === CallType.CUSTOM && '💬 Consulta'}
          </span>
          {call.origin === 'WHATSAPP_FALLBACK' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded-full">
              <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
            </span>
          )}
        </div>

        {call.type === CallType.BILL && (
          <div className="text-xs font-semibold text-indigo-300">
            Medio de Pago: <span className="text-white font-bold">{PAYMENT_METHOD_LABELS[call.paymentMethod] || call.paymentMethod}</span>
          </div>
        )}

        {call.note && (
          <p className="text-xs text-slate-300 italic bg-slate-900/80 p-2 rounded-lg border border-slate-800">
            "{call.note}"
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {!isInProgress ? (
          <button
            onClick={() => onAcknowledge(call.id)}
            className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-amber-200 font-bold text-xs active:scale-95 transition-all"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>En camino</span>
          </button>
        ) : (
          <div className="flex items-center justify-center space-x-1 py-2.5 px-3 rounded-xl bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 font-bold text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Atendiendo</span>
          </div>
        )}

        <button
          onClick={() => onResolve(call.id)}
          className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 active:scale-95 transition-all"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Atendido ✓</span>
        </button>
      </div>

      {/* Cobro Presencial en Mesa */}
      {onOpenBilling && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => onOpenBilling(call.tableId, call.tableLabel)}
            className="w-full py-2 px-3 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <span>💳 Ver Cuenta y Cobro en Mesa</span>
          </button>
        </div>
      )}

      {/* Quick Security Action: Liberar Mesa (Invalidates Token) */}
      {onReleaseTable && (
        <div className="pt-0.5 text-center">
          <button
            onClick={() => onReleaseTable(call.tableId, call.tableLabel)}
            className="w-full py-1.5 px-3 rounded-lg bg-slate-900/80 hover:bg-red-950/40 border border-slate-800 hover:border-red-500/40 text-[11px] font-semibold text-slate-400 hover:text-red-300 transition-all flex items-center justify-center gap-1"
          >
            <UserX className="w-3 h-3" />
            <span>Mesa se retiró (Cerrar sesión e invalidar QR)</span>
          </button>
        </div>
      )}
    </div>
  );
};
