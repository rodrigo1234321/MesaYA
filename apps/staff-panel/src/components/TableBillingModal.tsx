import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TableBillDTO } from '@mesaya/shared';
import { StaffApi } from '../lib/api';
import {
  CreditCard,
  Banknote,
  QrCode,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  UserCheck,
  Receipt,
  UserX
} from 'lucide-react';

interface TableBillingModalProps {
  tableId: string;
  tableLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onSettled?: () => void;
}

export const TableBillingModal: React.FC<TableBillingModalProps> = ({
  tableId,
  tableLabel,
  isOpen,
  onClose,
  onSettled
}) => {
  const [bill, setBill] = useState<TableBillDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [settling, setSettling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Payment Form State
  const [method, setMethod] = useState<'WAITER_CASH' | 'WAITER_CARD' | 'WAITER_MP_QR'>('WAITER_CASH');
  const [amountPesos, setAmountPesos] = useState<string>('');
  const [tipPesos, setTipPesos] = useState<string>('0');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [revertingId, setRevertingId] = useState<string | null>(null);

  // Idempotencia persistente en reintentos para no duplicar cobros ante fallos de red o recarga de página
  const pendingPaymentRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const getStoredPayment = useCallback((tId: string): { fingerprint: string; idempotencyKey: string } | null => {
    try {
      const raw = sessionStorage.getItem(`mesaya_pending_payment_${tId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const saveStoredPayment = useCallback((tId: string, data: { fingerprint: string; idempotencyKey: string } | null) => {
    try {
      if (data) {
        sessionStorage.setItem(`mesaya_pending_payment_${tId}`, JSON.stringify(data));
      } else {
        sessionStorage.removeItem(`mesaya_pending_payment_${tId}`);
      }
    } catch {}
  }, []);

  const fetchBill = useCallback(async () => {
    if (!tableId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await StaffApi.getTableBill(tableId);
      setBill(data);
      // Default amount to remaining balance in pesos
      const remPesos = (data.remainingCents / 100).toFixed(2);
      setAmountPesos(remPesos === '0.00' ? '' : remPesos);
    } catch (err: any) {
      setError(err.message || 'Error al cargar la cuenta');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    if (isOpen) {
      fetchBill();
      setSuccessMsg(null);
      // Intentar recuperar pago pendiente persistido en sessionStorage
      const stored = getStoredPayment(tableId);
      if (stored) {
        pendingPaymentRef.current = stored;
      }
    }
  }, [isOpen, fetchBill, tableId, getStoredPayment]);

  const participants = React.useMemo(() => {
    if (!bill?.items) return [];
    const map = new Map<string, { id: string; name: string; unpaidCents: number }>();
    for (const it of bill.items) {
      const pId = it.claimedByGuest || it.participantId;
      const pName = it.participantName || it.addedByGuest;
      if (pId) {
        const entry = map.get(pId) || { id: pId, name: pName || 'Comensal', unpaidCents: 0 };
        if (!it.isPaid) {
          entry.unpaidCents += it.lineTotalCents;
        }
        map.set(pId, entry);
      }
    }
    return Array.from(map.values());
  }, [bill]);

  if (!isOpen) return null;

  const handleSettle = async () => {
    if (!bill) return;
    const parsedAmount = parseFloat(amountPesos.replace(',', '.'));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Por favor ingresa un monto válido mayor a 0');
      return;
    }

    const amountCents = Math.round(parsedAmount * 100);
    if (amountCents > bill.remainingCents) {
      setError(`El monto ($${parsedAmount}) no puede superar el saldo pendiente ($${(bill.remainingCents / 100).toFixed(2)})`);
      return;
    }

    const parsedTip = parseFloat(tipPesos.replace(',', '.')) || 0;
    const tipCents = Math.max(0, Math.round(parsedTip * 100));

    // Si es un reintento con los mismos parámetros, reutiliza la misma clave de idempotencia (memoria o sessionStorage)
    const fingerprint = `${tableId}_${amountCents}_${method}_${tipCents}_${selectedParticipantId || 'all'}`;
    const stored = getStoredPayment(tableId);
    let idempotencyKey: string;

    if (pendingPaymentRef.current && pendingPaymentRef.current.fingerprint === fingerprint) {
      idempotencyKey = pendingPaymentRef.current.idempotencyKey;
    } else if (stored && stored.fingerprint === fingerprint) {
      idempotencyKey = stored.idempotencyKey;
      pendingPaymentRef.current = stored;
    } else {
      idempotencyKey = `pay_${tableId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const paymentData = { fingerprint, idempotencyKey };
      pendingPaymentRef.current = paymentData;
      saveStoredPayment(tableId, paymentData);
    }

    try {
      setSettling(true);
      setError(null);
      setSuccessMsg(null);

      await StaffApi.settlePayment({
        tableId,
        amountCents,
        paymentMethod: method,
        tipCents,
        idempotencyKey,
        participantId: selectedParticipantId || undefined
      });

      // Cobro exitoso: limpiar la clave pendiente tanto de memoria como de sessionStorage
      pendingPaymentRef.current = null;
      saveStoredPayment(tableId, null);
      setSuccessMsg('Cobro registrado exitosamente.');
      await fetchBill();
      onSettled?.();
    } catch (err: any) {
      setError(err.message || 'No se pudo procesar el cobro');
    } finally {
      setSettling(false);
    }
  };

  const handleRevert = async (paymentId: string) => {
    if (!window.confirm('¿Confirmas revertir este cobro? El saldo de la mesa se reabrirá.')) return;
    try {
      setRevertingId(paymentId);
      setError(null);
      await StaffApi.revertPayment(paymentId, 'Reversión autorizada por personal de salón');
      setSuccessMsg('Pago revertido correctamente.');
      await fetchBill();
      onSettled?.();
    } catch (err: any) {
      setError(err.message || 'Error al revertir el cobro');
    } finally {
      setRevertingId(null);
    }
  };

  const handleCloseSession = async () => {
    if (!window.confirm(`¿Confirmas liberar y cerrar la sesión de ${tableLabel}?`)) return;
    try {
      await StaffApi.closeTableSession(tableId);
      onSettled?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo cerrar la mesa');
    }
  };

  const remainingPesos = bill ? bill.remainingCents / 100 : 0;
  const totalPesos = bill ? bill.totalCents / 100 : 0;
  const paidPesos = bill ? bill.paidCents / 100 : 0;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 space-y-4 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                Caja y Cuenta — {tableLabel}
              </h2>
              <span className="text-[11px] text-slate-400 font-medium">
                Cobro presencial en salón / Efectivo, Tarjeta o QR
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={fetchBill}
              title="Actualizar cuenta"
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto space-y-4 pr-1 flex-1">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {loading && !bill ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs">Consultando cuenta autoritativa...</span>
            </div>
          ) : bill ? (
            <>
              {/* Financial Balance Summary Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Balance de la Mesa
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold border ${
                      bill.status === 'PAID'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {bill.status === 'PAID' ? 'CUENTA SALDADA ✓' : 'SALDO PENDIENTE'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800/80 text-center">
                  <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Total</span>
                    <span className="text-xs sm:text-sm font-black text-white font-mono">
                      ${totalPesos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Cobrado</span>
                    <span className="text-xs sm:text-sm font-black text-emerald-400 font-mono">
                      ${paidPesos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/80 border border-amber-500/30">
                    <span className="text-[10px] text-amber-400 block font-bold">Resta Cobrar</span>
                    <span className="text-xs sm:text-sm font-black text-amber-300 font-mono">
                      ${remainingPesos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Fully Paid Call to Action */}
                {bill.status === 'PAID' && (
                  <div className="pt-2">
                    <button
                      onClick={handleCloseSession}
                      className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
                    >
                      <UserX className="w-4 h-4" />
                      <span>Liberar Mesa y Cerrar Sesión</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Settlement Section (Only if balance remains) */}
              {bill.remainingCents > 0 && (
                <div className="p-4 rounded-2xl bg-slate-950/70 border border-indigo-500/30 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <span>⚡ Registrar Cobro en Mesa</span>
                    </h3>
                    <span className="text-[10px] text-slate-400">Personal Autorizado</span>
                  </div>

                  {/* Payment Method Selector */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setMethod('WAITER_CASH')}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all ${
                        method === 'WAITER_CASH'
                          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/60 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      <span>Efectivo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMethod('WAITER_CARD')}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all ${
                        method === 'WAITER_CARD'
                          ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/60 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Tarjeta</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMethod('WAITER_MP_QR')}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all ${
                        method === 'WAITER_MP_QR'
                          ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/60 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      <QrCode className="w-4 h-4" />
                      <span>QR Salón</span>
                    </button>
                  </div>

                  {/* Participant Filter / Selector */}
                  {participants.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-400 block">Cobrar a Comensal:</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedParticipantId('');
                            setAmountPesos(remainingPesos.toFixed(2));
                          }}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all ${
                            !selectedParticipantId
                              ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                        >
                          Toda la Mesa
                        </button>
                        {participants.map((p) => {
                          const isSel = selectedParticipantId === p.id;
                          const pUnpaidPesos = (p.unpaidCents / 100).toFixed(2);
                          return (
                            <button
                              key={`part-select-${p.id}`}
                              type="button"
                              onClick={() => {
                                setSelectedParticipantId(p.id);
                                if (p.unpaidCents > 0) {
                                  setAmountPesos(pUnpaidPesos);
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all ${
                                isSel
                                  ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50'
                                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                              }`}
                            >
                              👤 {p.name} (${pUnpaidPesos})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Quick Preset Buttons */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 block">Montos Rápidos:</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAmountPesos(remainingPesos.toFixed(2))}
                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-mono text-[11px] font-bold transition-all"
                      >
                        Total (${remainingPesos.toFixed(2)})
                      </button>

                      {bill.equalParts &&
                        bill.equalParts.slice(0, 3).map((ep) => {
                          const partPesos = (ep.amountCents / 100).toFixed(2);
                          return (
                            <button
                              key={`preset-part-${ep.totalParts}`}
                              type="button"
                              onClick={() => setAmountPesos(partPesos)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-mono text-[11px] font-bold transition-all"
                            >
                              1/{ep.totalParts} (${partPesos})
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* Inputs: Amount & Tip */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-300 block mb-1">
                        Importe a Cobrar ($):
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={amountPesos}
                        onChange={(e) => setAmountPesos(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono font-bold text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-300 block mb-1">
                        Propina Optativa ($):
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={tipPesos}
                        onChange={(e) => setTipPesos(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono font-bold text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Action: Settle Button */}
                  <button
                    type="button"
                    onClick={handleSettle}
                    disabled={settling}
                    className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold text-xs shadow-md shadow-indigo-600/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    {settling ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>
                      {settling
                        ? 'Registrando cobro...'
                        : `Confirmar Cobro de $${amountPesos || '0.00'}`}
                    </span>
                  </button>
                </div>
              )}

              {/* Transactions History */}
              {bill.settledPayments && bill.settledPayments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <span>💳 Pagos Registrados ({bill.settledPayments.length})</span>
                  </h4>
                  <div className="space-y-1.5">
                    {bill.settledPayments.map((p) => {
                      const pPesos = (p.amountCents / 100).toFixed(2);
                      const isRef = p.status === 'REFUNDED';
                      return (
                        <div
                          key={p.id}
                          className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                            isRef
                              ? 'bg-slate-900/40 border-slate-800 text-slate-500 line-through'
                              : 'bg-slate-950/80 border-slate-800 text-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-white">${pPesos}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                                {p.paymentMethod === 'WAITER_CASH'
                                  ? '💵 Efectivo'
                                  : p.paymentMethod === 'WAITER_CARD'
                                  ? '💳 Tarjeta'
                                  : '📱 QR Salón'}
                              </span>
                              {p.tipCents > 0 && (
                                <span className="text-[10px] text-amber-400 font-mono">
                                  +${(p.tipCents / 100).toFixed(2)} prop.
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 block mt-0.5">
                              {new Date(p.createdAt).toLocaleTimeString('es-AR')} • Ref: {p.id.slice(0, 8)}
                            </span>
                          </div>

                          {!isRef && (
                            <button
                              type="button"
                              onClick={() => handleRevert(p.id)}
                              disabled={revertingId === p.id}
                              className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] font-bold flex items-center gap-1 transition-all"
                            >
                              <RotateCcw className={`w-3 h-3 ${revertingId === p.id ? 'animate-spin' : ''}`} />
                              <span>Revertir</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Itemized Consumptions Breakdown */}
              {bill.items && bill.items.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <span>📋 Detalle de Consumos de la Mesa</span>
                  </h4>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {bill.items.map((item) => (
                      <div
                        key={item.id}
                        className="p-2 rounded-xl bg-slate-950/60 border border-slate-850 flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white truncate">{item.productName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">×{item.quantity}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                            {item.participantName && (
                              <span className="flex items-center gap-0.5 text-indigo-300">
                                <UserCheck className="w-2.5 h-2.5" />
                                {item.participantName}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="font-mono font-bold text-slate-200 shrink-0">
                          ${(item.lineTotalCents / 100).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
