import React, { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, RefreshCw, LockKeyhole } from 'lucide-react';
import { StaffApi } from '../lib/api';

interface CashOrder {
  id: string;
  tableId: string;
  tableLabel: string;
  sector: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number; notes?: string | null }>;
}

export const CashManager: React.FC<{ restaurantId: string }> = ({ restaurantId }) => {
  const [orders, setOrders] = useState<CashOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'WAITER_CASH' | 'WAITER_CARD'>('WAITER_CASH');
  const [tipByOrder, setTipByOrder] = useState<Record<string, string>>({});
  const [phoneByOrder, setPhoneByOrder] = useState<Record<string, string>>({});
  const [rewardsConsentByOrder, setRewardsConsentByOrder] = useState<Record<string, boolean>>({});
  const paymentKeys = useRef(new Map<string, string>());

  const refresh = async (signal?: AbortSignal) => {
    try {
      const data = await StaffApi.getCashOrders(restaurantId, signal);
      setOrders(data.orders || []);
      setError(null);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err.message || 'No se pudo cargar la caja');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;
    const tick = async () => {
      if (cancelled) return;
      controller = new AbortController();
      await refresh(controller.signal);
      if (!cancelled) {
        const delay = failures ? Math.min(4000 * Math.pow(1.5, failures), 15000) : 5000;
        timer = setTimeout(tick, document.hidden ? 10000 : delay);
      }
      controller = null;
    };
    tick().catch(() => { failures += 1; });
    const online = () => { if (timer) clearTimeout(timer); failures = 0; tick(); };
    window.addEventListener('online', online);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', online);
    };
  }, [restaurantId]);

  const pay = async (order: CashOrder) => {
    if (!window.confirm(`¿Confirmás cobrar $${order.remainingAmount.toLocaleString('es-AR')} en ${order.tableLabel}?`)) return;
    setBusyOrderId(order.id);
    try {
      let key = paymentKeys.current.get(order.id);
      if (!key) {
        key = `cash-${order.id}-${Date.now()}`;
        paymentKeys.current.set(order.id, key);
      }
      const tipAmount = Math.max(0, Number(tipByOrder[order.id] || 0));
      const customerPhone = rewardsConsentByOrder[order.id] ? (phoneByOrder[order.id] || undefined) : undefined;
      const result = await StaffApi.payOrder(order.id, paymentMethod, tipAmount, key, customerPhone);
      if (result?.rewardsWarning) setError(`Cobro registrado. Rewards requiere revisión: ${result.rewardsWarning}`);
      paymentKeys.current.delete(order.id);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'No se pudo registrar el cobro');
    } finally {
      setBusyOrderId(null);
    }
  };

  const release = async (order: CashOrder) => {
    if (!window.confirm(`¿Liberar ${order.tableLabel}? Se invalidará la sesión y el QR operativo.`)) return;
    setBusyOrderId(order.id);
    try {
      await StaffApi.closeTableSession(order.tableId);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'La mesa aún tiene consumos o llamados pendientes');
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="font-extrabold text-base text-white flex items-center gap-2"><Banknote className="w-5 h-5 text-emerald-400" /> Caja presencial</h2>
          <p className="text-xs text-slate-400 mt-0.5">Cobrá, registrá propina y liberá la mesa desde esta pantalla compartida.</p>
        </div>
        <button onClick={() => refresh()} className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white" aria-label="Actualizar caja"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {error && <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs">{error}</div>}
      {loading && <p className="text-center py-8 text-xs text-slate-400">Cargando cuentas pendientes...</p>}
      {!loading && orders.length === 0 && <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-2xl text-xs text-slate-400">No hay cuentas pendientes de cobro.</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {orders.map((order) => (
          <article key={order.id} className="rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div><h3 className="font-extrabold text-white">{order.tableLabel}</h3><span className="text-[10px] text-slate-400">{order.sector} · {order.status}</span></div>
              <strong className="text-xl text-emerald-300">${order.remainingAmount.toLocaleString('es-AR')}</strong>
            </div>
            <div className="space-y-1 border-y border-slate-800 py-2">
              {order.items.map((item) => <div key={item.id} className="flex justify-between text-xs text-slate-300"><span>{item.quantity}x {item.name}</span><span>${(item.quantity * item.unitPrice).toLocaleString('es-AR')}</span></div>)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">Medio
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"><option value="WAITER_CASH">Efectivo</option><option value="WAITER_CARD">Tarjeta / POS</option></select>
              </label>
              <label className="text-[10px] text-slate-400">Propina
                <input value={tipByOrder[order.id] || ''} onChange={(event) => setTipByOrder((prev) => ({ ...prev, [order.id]: event.target.value }))} type="number" min="0" step="0.01" className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white" placeholder="0" />
              </label>
            </div>
            <label className="block text-[10px] text-slate-400">Teléfono para acreditar Rewards (opcional)
              <input value={phoneByOrder[order.id] || ''} onChange={(event) => setPhoneByOrder((prev) => ({ ...prev, [order.id]: event.target.value }))} type="tel" inputMode="tel" className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white" placeholder="223 555 1234" autoComplete="tel" />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-slate-400">
              <input type="checkbox" checked={Boolean(rewardsConsentByOrder[order.id])} onChange={(event) => setRewardsConsentByOrder((prev) => ({ ...prev, [order.id]: event.target.checked }))} className="accent-rose-500" />
              Cliente acepta recibir puntos Rewards
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busyOrderId === order.id} onClick={() => pay(order)} className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Registrar cobro</button>
              <button disabled={busyOrderId === order.id} onClick={() => release(order)} className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs flex items-center justify-center gap-1"><LockKeyhole className="w-3.5 h-3.5" /> Liberar mesa</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
