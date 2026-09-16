import React, { useEffect, useState } from 'react';
import { AdminApi } from '../lib/api';
import {
  PaymentMode,
  PAYMENT_MODE_LABELS,
  RestaurantModuleConfigDTO,
  ModuleConfigAuditDTO,
  CapabilityKey,
  CapabilityState
} from '@mesaya/shared';
import {
  Sliders,
  CreditCard,
  ShoppingCart,
  TrendingUp,
  Sparkles,
  Star,
  Users,
  Gift,
  History,
  CheckCircle2,
  AlertCircle,
  Save,
  RefreshCw,
  ExternalLink
} from 'lucide-react';

interface Props {
  restaurantId: string;
}

export const ModuleConfigManager: React.FC<Props> = ({ restaurantId }) => {
  const [config, setConfig] = useState<RestaurantModuleConfigDTO | null>(null);
  const [auditLogs, setAuditLogs] = useState<ModuleConfigAuditDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'modules' | 'audit'>('modules');
  const [rewardItems, setRewardItems] = useState<Array<{ id: string; name: string; pointsCost: number; isAvailable: boolean }>>([]);
  const [newRewardName, setNewRewardName] = useState('');
  const [newRewardCost, setNewRewardCost] = useState('');

  const loadConfig = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await AdminApi.getModuleConfig(restaurantId);
      setConfig(data);
      const logs = await AdminApi.getModuleConfigAudit(restaurantId).catch(() => []);
      setAuditLogs(logs);
      const rewards = await AdminApi.getRewardItems(restaurantId).catch(() => ({ items: [] }));
      setRewardItems(rewards.items || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al cargar configuración de módulos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [restaurantId]);

  const handleToggle = (key: keyof RestaurantModuleConfigDTO) => {
    if (!config) return;
    const capabilityByField: Partial<Record<keyof RestaurantModuleConfigDTO, CapabilityKey>> = {
      allowSplitBill: 'split_bill',
      allowWaitersToCollectCash: 'waiter_cash_collection',
      enableUpsell: 'upsell',
      enableSmartTips: 'smart_tips',
      enableWaitlistPreOrder: 'waitlist_preorder',
      enableRewards: 'rewards'
    };
    const capabilityKey = capabilityByField[key];
    const capability = capabilityKey ? config.capabilities?.[capabilityKey] : undefined;
    if (capability && !capability.effectiveEnabled && !config[key]) {
      setErrorMsg(capability.message || 'Esta capacidad todavía no está disponible.');
      return;
    }
    setConfig({
      ...config,
      [key]: !config[key]
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await AdminApi.updateModuleConfig(restaurantId, {
        ...config,
        changedBy: 'ADMIN_DASHBOARD'
      });
      setConfig(updated);
      setSuccessMsg('Configuración de módulos actualizada exitosamente');
      const logs = await AdminApi.getModuleConfigAudit(restaurantId).catch(() => []);
      setAuditLogs(logs);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRewardItem = async () => {
    const name = newRewardName.trim();
    const pointsCost = Number(newRewardCost);
    if (!name || !Number.isInteger(pointsCost) || pointsCost <= 0) {
      setErrorMsg('Definí un nombre y un costo de puntos válido para el premio.');
      return;
    }
    try {
      const item = await AdminApi.createRewardItem(restaurantId, { name, pointsCost });
      setRewardItems((current) => [...current, item]);
      setNewRewardName('');
      setNewRewardCost('');
      setSuccessMsg('Premio Rewards agregado.');
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo crear el premio Rewards');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 space-x-2">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
        <span className="text-sm font-semibold">Cargando módulos configurables...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-300 flex items-center justify-center mx-auto text-xl">
          ⚙️
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Configuración del Local</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {errorMsg || 'No se pudo sincronizar la configuración con el servidor.'}
          </p>
        </div>
        <button
          type="button"
          onClick={loadConfig}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 mx-auto active:scale-95 transition-all shadow-md shadow-indigo-600/20"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reintentar Conexión</span>
        </button>
      </div>
    );
  }

  const capabilityStatus = (key: CapabilityKey) => {
    const capability = config.capabilities?.[key];
    if (!capability) return null;
    if (capability.state === CapabilityState.AVAILABLE && capability.effectiveEnabled) return null;
    return (
      <p className="mt-1 text-[10px] leading-relaxed text-amber-300/90">
        {capability.message}
      </p>
    );
  };

  const capabilityBlocked = (key: CapabilityKey) => {
    const capability = config.capabilities?.[key];
    return Boolean(capability && !capability.effectiveEnabled && !capability.configuredEnabled);
  };

  return (
    <div className="space-y-6">
      {/* Sub-header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-extrabold text-white flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <span>Módulos & Experiencia de Salón ("Tu Local, Tus Reglas")</span>
          </h2>
          <p className="text-xs text-slate-400">
            Enciende o apaga funciones a medida para adaptar MesaYA al flujo de tu restaurante
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-bold" role="tablist" aria-label="Vistas de configuración del local">
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'modules'}
              onClick={() => setActiveSubTab('modules')}
              className={`px-3 py-1.5 rounded-lg transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                activeSubTab === 'modules'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Interruptores
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'audit'}
              onClick={() => setActiveSubTab('audit')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                activeSubTab === 'audit'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial ({auditLogs.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Guardando...' : 'Guardar Cambios'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div role="status" className="flex items-center gap-2 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="flex items-center gap-2 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {activeSubTab === 'modules' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* MÓDULO 1: Cobro y Cierre de Mesa */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">1. Modalidad de Cobro & Cuenta</h3>
                  <p className="text-xs text-slate-400">Define cómo piden y pagan la cuenta los comensales</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Modo de Pago en Salón</label>
                <select
                  value={config.paymentMode}
                  onChange={(e) => setConfig({ ...config, paymentMode: e.target.value as PaymentMode })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value={PaymentMode.WAITER_ONLY}>
                    {PAYMENT_MODE_LABELS[PaymentMode.WAITER_ONLY]}
                  </option>
                  <option value={PaymentMode.DIGITAL_MP}>
                    {PAYMENT_MODE_LABELS[PaymentMode.DIGITAL_MP]}
                  </option>
                  <option value={PaymentMode.HYBRID}>
                    {PAYMENT_MODE_LABELS[PaymentMode.HYBRID]}
                  </option>
                </select>
                {capabilityStatus('digital_payment')}
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                <div>
                  <p className="text-xs font-bold text-slate-200">Dividir Cuenta (Split Bill)</p>
                  <p className="text-[11px] text-slate-400">Permite dividir en partes iguales o por plato</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.allowSplitBill}
                  aria-label="Dividir cuenta"
                  disabled={capabilityBlocked('split_bill') && !config.allowSplitBill}
                  onClick={() => handleToggle('allowSplitBill')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    config.allowSplitBill ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      config.allowSplitBill ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                {capabilityStatus('split_bill')}
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                <div>
                  <p className="text-xs font-bold text-slate-200">Cobro en efectivo por mozos</p>
                  <p className="text-[11px] text-slate-400">Permite a los mozos liquidar pagos en efectivo sin solicitar PIN de encargado</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.allowWaitersToCollectCash}
                  id="toggle-waiter-cash-collection"
                  onClick={() => handleToggle('allowWaitersToCollectCash')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    config.allowWaitersToCollectCash ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                  aria-label="Habilitar cobro en efectivo por mozos"
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      config.allowWaitersToCollectCash ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                {capabilityStatus('waiter_cash_collection')}
              </div>
            </div>
          </div>

          {/* MÓDULO 2: Carrito Colaborativo & Comandas */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">2. Comandas & Carrito en Mesa</h3>
                  <p className="text-xs text-slate-400">Social dining y control de pedidos digitales</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                <div>
                  <p className="text-xs font-bold text-slate-200">Permitir Comandas Digitales</p>
                  <p className="text-[11px] text-slate-400">Si se apaga, la carta es Food-First solo informativa</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.allowOrdering}
                  aria-label="Permitir comandas digitales"
                  onClick={() => handleToggle('allowOrdering')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    config.allowOrdering ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      config.allowOrdering ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                <div>
                  <p className="text-xs font-bold text-slate-200">Modo manual de revisión</p>
                  <p className="text-[11px] text-slate-400">Si se activa, todas las comandas esperan al mozo; si se apaga, sólo pasan a revisión las excepciones identificadas.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.requireWaiterValidation}
                  aria-label="Modo manual de revisión por el mozo"
                  onClick={() => handleToggle('requireWaiterValidation')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    config.requireWaiterValidation ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      config.requireWaiterValidation ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="rounded-2xl bg-slate-950/60 border border-slate-800/80 p-3">
                <label className="block text-xs font-bold text-slate-200" htmlFor="review-quantity-threshold">Umbral de revisión por cantidad</label>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Más de esta cantidad de un mismo plato queda pendiente para revisar stock e intención. Las alertas de alergia ya contempladas por la carta sólo quedan visibles como contexto.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="review-quantity-threshold"
                    type="number"
                    min={2}
                    max={50}
                    step={1}
                    value={config.reviewQuantityThreshold ?? 6}
                    onChange={(event) => setConfig({ ...config, reviewQuantityThreshold: Number(event.target.value) })}
                    className="w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-slate-500">unidades por línea · 2 a 50</span>
                </div>
              </div>
            </div>
          </div>

          {/* MÓDULO 3: Smart Upselling */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">3. Smart Upselling</h3>
                  <p className="text-xs text-slate-400">Sugerencias automáticas de maridajes y adicionales</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enableUpsell}
                aria-label="Smart Upselling"
                disabled={capabilityBlocked('upsell') && !config.enableUpsell}
                onClick={() => handleToggle('enableUpsell')}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  config.enableUpsell ? 'bg-amber-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    config.enableUpsell ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Ofrece al comensal sugerencias no invasivas (ej. vino sugerido, papas especiales) al agregar un plato. El impacto debe medirse con datos del local; este módulo no promete un aumento.
            </p>
            {capabilityStatus('upsell')}
          </div>

          {/* MÓDULO 4: Smart Tipping & Reseñas Éticas */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Star className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">4. Propinas & Reseñas Google</h3>
                  <p className="text-xs text-slate-400">Smart tips y enlace ético a Google Maps</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                <div>
                  <p className="text-xs font-bold text-slate-200">Sugerencia de Propinas</p>
                  <p className="text-[11px] text-slate-400">Con nombre del mozo ({config.suggestedTipPercentages.join('%, ')}%)</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.enableSmartTips}
                  aria-label="Sugerencia de propinas"
                  disabled={capabilityBlocked('smart_tips') && !config.enableSmartTips}
                  onClick={() => handleToggle('enableSmartTips')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    config.enableSmartTips ? 'bg-purple-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      config.enableSmartTips ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {capabilityStatus('smart_tips')}

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Google Place ID (Direct Review Deep Link)
                </label>
                <input
                  type="text"
                  placeholder="Ej: ChIJN1t_tDeuEmsRUsoyG83frY4"
                  value={config.googlePlaceId || ''}
                  onChange={(e) => setConfig({ ...config, googlePlaceId: e.target.value || null })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                />
                {config.googlePlaceId && (
                  <a
                    href={`https://search.google.com/local/writereview?placeid=${config.googlePlaceId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[11px] text-purple-400 hover:underline"
                  >
                    <span>Probar enlace de reseña</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* MÓDULO 5: Fila Virtual & Pre-Order */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">5. Fila Virtual Inteligente</h3>
                  <p className="text-xs text-slate-400">Gestión de esperas en puerta y pre-pedidos</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enableWaitlist}
                aria-label="Fila virtual inteligente"
                disabled={capabilityBlocked('waitlist') && !config.enableWaitlist}
                onClick={() => handleToggle('enableWaitlist')}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  config.enableWaitlist ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    config.enableWaitlist ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {capabilityStatus('waitlist')}

            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
              <div>
                <p className="text-xs font-bold text-slate-200">Permitir Pre-Order en Espera</p>
                <p className="text-[11px] text-slate-400">El cliente elige su pedido mientras espera en la vereda</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enableWaitlistPreOrder && config.enableWaitlist}
                aria-label="Permitir pre-order en espera"
                disabled={!config.enableWaitlist}
                onClick={() => handleToggle('enableWaitlistPreOrder')}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 ${
                  config.enableWaitlistPreOrder && config.enableWaitlist ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    config.enableWaitlistPreOrder && config.enableWaitlist ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {capabilityStatus('waitlist_preorder')}
          </div>

          {/* MÓDULO 6: Fidelización (Rewards) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">6. MesaYA Rewards (Fidelización)</h3>
                  <p className="text-xs text-slate-400">Puntos automáticos por consumo y canje de premios</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enableRewards}
                aria-label="MesaYA Rewards"
                disabled={capabilityBlocked('rewards') && !config.enableRewards}
                onClick={() => handleToggle('enableRewards')}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  config.enableRewards ? 'bg-rose-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    config.enableRewards ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {capabilityStatus('rewards')}

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Puntos otorgados cada $100 de consumo
              </label>
              <input
                type="number"
                min={1}
                max={100}
                disabled={!config.enableRewards}
                value={config.pointsPerHundredPesos}
                onChange={(e) => setConfig({ ...config, pointsPerHundredPesos: Number(e.target.value) || 1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-rose-500 disabled:opacity-40"
              />
            </div>
            <div className="rounded-2xl bg-slate-950/70 border border-slate-800 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-200">Catálogo de premios</p>
                  <p className="text-[10px] text-slate-500">El canje se confirma desde la pantalla del personal.</p>
                </div>
                <span className="text-[10px] text-slate-500">{rewardItems.length} activos</span>
              </div>
              {rewardItems.length > 0 && <div className="space-y-1">{rewardItems.map((item) => <div key={item.id} className="flex justify-between text-[11px] text-slate-300"><span>{item.name}</span><span className="text-rose-300">{item.pointsCost} pts</span></div>)}</div>}
              <div className="grid grid-cols-[1fr_90px_auto] gap-2 items-end">
                <label className="text-[10px] text-slate-400">Nombre<input value={newRewardName} onChange={(e) => setNewRewardName(e.target.value)} disabled={!config.enableRewards} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white disabled:opacity-40" placeholder="Postre" /></label>
                <label className="text-[10px] text-slate-400">Puntos<input value={newRewardCost} onChange={(e) => setNewRewardCost(e.target.value)} disabled={!config.enableRewards} type="number" min="1" className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white disabled:opacity-40" placeholder="100" /></label>
                <button type="button" onClick={handleCreateRewardItem} disabled={!config.enableRewards} className="px-2.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-[10px] font-bold">Agregar</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* TAB DE AUDITORÍA */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" />
                <span>Historial de Auditoría de Configuración</span>
              </h3>
              <p className="text-xs text-slate-400">
                Registro inmutable de quién y cuándo modificó cada funcionalidad
              </p>
            </div>
            <button
              type="button"
              onClick={loadConfig}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Actualizar</span>
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No hay registros de cambios de configuración todavía.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-indigo-300 font-mono">{log.changedField}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                        {log.changedBy || 'ADMIN'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-slate-400 text-[11px]">
                      <span className="line-through text-slate-500">{log.oldValue || 'null'}</span>
                      <span>➔</span>
                      <span className="text-emerald-400 font-semibold">{log.newValue}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap font-mono">
                    {new Date(log.changedAt).toLocaleString('es-AR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
