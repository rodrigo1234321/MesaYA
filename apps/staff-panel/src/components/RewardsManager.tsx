import React, { useEffect, useState } from 'react';
import { Gift, RefreshCw, Search, Sparkles } from 'lucide-react';
import { StaffApi } from '../lib/api';

type RewardItem = { id: string; name: string; description?: string | null; pointsCost: number; isAvailable: boolean };
type Customer = { points: number; phone: string; consentAt?: string | null } | null;

export const RewardsManager: React.FC<{ restaurantId: string }> = ({ restaurantId }) => {
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer>(null);
  const [items, setItems] = useState<RewardItem[]>([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = async () => {
    try {
      const data = await StaffApi.getRewardItems(restaurantId);
      setItems(data.items || []);
      if (!selectedItem && data.items?.[0]) setSelectedItem(data.items[0].id);
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar los premios');
    }
  };

  useEffect(() => { loadItems(); }, [restaurantId]);

  const search = async () => {
    if (!phone.trim()) return;
    setLoading(true); setError(null); setNotice(null);
    try {
      const data = await StaffApi.getRewardsCustomer(restaurantId, phone);
      setCustomer(data.customer);
      if (!data.customer) setNotice('No hay una cuenta Rewards para este teléfono. Se crea al acreditar el primer cobro.');
    } catch (err: any) {
      setCustomer(null); setError(err.message || 'No se pudo consultar Rewards');
    } finally { setLoading(false); }
  };

  const redeem = async () => {
    const item = items.find((candidate) => candidate.id === selectedItem);
    if (!item || !customer) return;
    if (item.pointsCost > customer.points) {
      setError('El cliente no tiene puntos suficientes para ese premio.');
      return;
    }
    if (!window.confirm(`¿Canjear ${item.name} por ${item.pointsCost} puntos?`)) return;
    setLoading(true); setError(null); setNotice(null);
    try {
      const result = await StaffApi.redeemReward(restaurantId, phone, item.id, `staff-reward-${Date.now()}`);
      setCustomer(result.customer);
      setNotice(`Canje registrado. Saldo restante: ${result.customer.points} puntos.`);
    } catch (err: any) {
      setError(err.message || 'No se pudo canjear el premio');
    } finally { setLoading(false); }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="font-extrabold text-base text-white flex items-center gap-2"><Gift className="w-5 h-5 text-rose-300" /> Rewards</h2>
          <p className="text-xs text-slate-400 mt-0.5">Consultá saldo y canjeá premios desde la pantalla compartida.</p>
        </div>
        <button onClick={() => loadItems()} className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white" aria-label="Actualizar premios"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {error && <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs">{error}</div>}
      {notice && <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs">{notice}</div>}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
        <label className="text-xs text-slate-300">Teléfono del cliente
          <div className="flex gap-2 mt-1">
            <input value={phone} onChange={(event) => setPhone(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} type="tel" inputMode="tel" autoComplete="tel" placeholder="223 555 1234" className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white" />
            <button onClick={search} disabled={loading || !phone.trim()} className="px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"><Search className="w-4 h-4" /></button>
          </div>
        </label>
        {customer && <div className="flex items-center justify-between rounded-xl bg-slate-950/70 border border-slate-800 p-3"><span className="text-xs text-slate-400">Saldo disponible</span><strong className="text-2xl text-rose-300">{customer.points} pts</strong></div>}
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <label className="text-xs text-slate-400">Premio
            <select value={selectedItem} onChange={(event) => setSelectedItem(event.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white">
              {items.length === 0 && <option value="">No hay premios disponibles</option>}
              {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.pointsCost} pts</option>)}
            </select>
          </label>
          <button onClick={redeem} disabled={loading || !customer || !selectedItem} className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Canjear</button>
        </div>
      </div>
    </section>
  );
};
