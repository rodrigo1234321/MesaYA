import React, { useState, useEffect, useRef } from 'react';
import { StaffApi } from '../lib/api';
import { playChimeAlert, unlockAudio } from '../lib/audio';
import {
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  ChevronRight,
  X,
  Volume2,
  VolumeX,
  AlertTriangle,
  XCircle,
  PackageX,
  RefreshCw
} from 'lucide-react';

interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string | null;
  unitPrice: number;
  addedByGuest?: string | null;
  participantName?: string | null;
  tandaSeq?: number | null;
}

interface KitchenOrder {
  id: string;
  tableId: string;
  tableLabel: string;
  sector: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  elapsedMinutes: number;
  urgency: 'NORMAL' | 'WARNING' | 'CRITICAL';
  items: KitchenItem[];
}

interface KitchenOrdersManagerProps {
  restaurantId: string;
}

const ALLERGY_REGEX = /(alerg|celiac|tacc|mani|maní|marisc|intoleran|gluten|sin tacc)/i;

export const KitchenOrdersManager: React.FC<KitchenOrdersManagerProps> = ({ restaurantId }) => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Audio chimes & deduplicación autoritativa
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(false);
  const knownOrderIdsRef = useRef<Set<string> | null>(null);

  // Modal para que el mozo cargue una comanda a mano
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [tables, setTables] = useState<any[]>([]);
  const [menu, setMenu] = useState<any>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<{ menuItemId: string; name: string; quantity: number; notes: string }[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Modal para gestión de platos agotados (stock 86)
  const [isStockModalOpen, setIsStockModalOpen] = useState<boolean>(false);
  const [stockMenu, setStockMenu] = useState<any>(null);
  const [stockLoading, setStockLoading] = useState<boolean>(false);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  // Modal para rechazar / cancelar comanda con motivo
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejectSubmitting, setRejectSubmitting] = useState<boolean>(false);

  const fetchOrders = async () => {
    try {
      const data = await StaffApi.getKitchenOrders(restaurantId);
      const incomingOrders: KitchenOrder[] = data.orders || [];
      setOrders(incomingOrders);
      setError(null);

      // Deduplicación autoritativa de sonido:
      // Primer fetch: sembramos los IDs sin alertar al operador
      if (knownOrderIdsRef.current === null) {
        knownOrderIdsRef.current = new Set(incomingOrders.map((o) => o.id));
      } else {
        // Fetches subsiguientes: sólo alertamos si aparecen IDs genuinamente nuevos
        const newOrders = incomingOrders.filter((o) => !knownOrderIdsRef.current!.has(o.id));
        if (newOrders.length > 0) {
          if (isAudioEnabled) {
            playChimeAlert();
          }
          newOrders.forEach((o) => knownOrderIdsRef.current!.add(o.id));
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar comandas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 4000);
    return () => clearInterval(interval);
  }, [restaurantId, isAudioEnabled]);

  const toggleAudio = () => {
    if (!isAudioEnabled) {
      unlockAudio();
      setIsAudioEnabled(true);
      playChimeAlert();
    } else {
      setIsAudioEnabled(false);
    }
  };

  const openNewOrderModal = async () => {
    setIsModalOpen(true);
    setSelectedItems([]);
    try {
      const [tablesData, menuData] = await Promise.all([
        StaffApi.getTables(restaurantId),
        StaffApi.getMenu(restaurantId)
      ]);
      setTables(tablesData || []);
      if (tablesData && tablesData.length > 0) {
        setSelectedTableId(tablesData[0].id);
      }
      setMenu(menuData || null);
    } catch (err) {
      console.error('Error al cargar datos para comanda:', err);
    }
  };

  const openStockModal = async () => {
    setIsStockModalOpen(true);
    setStockLoading(true);
    try {
      const menuData = await StaffApi.getMenu(restaurantId);
      setStockMenu(menuData || null);
    } catch (err) {
      console.error('Error al cargar carta para agotados:', err);
    } finally {
      setStockLoading(false);
    }
  };

  const handleToggleItemAvailability = async (itemId: string, currentAvailability: boolean) => {
    setTogglingItemId(itemId);
    try {
      const newAvailability = !currentAvailability;
      await StaffApi.updateMenuItemAvailability(restaurantId, itemId, newAvailability);
      if (stockMenu && stockMenu.categories) {
        const updatedCategories = stockMenu.categories.map((cat: any) => ({
          ...cat,
          items: cat.items.map((it: any) =>
            it.id === itemId ? { ...it, isAvailable: newAvailability } : it
          )
        }));
        setStockMenu({ ...stockMenu, categories: updatedCategories });
      }
    } catch (err: any) {
      alert(err.message || 'Error al actualizar disponibilidad');
    } finally {
      setTogglingItemId(null);
    }
  };

  const handleAddItemToForm = (item: any) => {
    setSelectedItems((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id);
      if (existing) {
        return prev.map((i) => (i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { menuItemId: item.id, name: item.name, quantity: 1, notes: '' }];
    });
  };

  const handleRemoveItemFromForm = (menuItemId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.menuItemId !== menuItemId));
  };

  const handleSubmitOrder = async () => {
    if (!selectedTableId || selectedItems.length === 0) return;
    setSubmitting(true);
    try {
      for (const it of selectedItems) {
        await StaffApi.addItemByStaff(selectedTableId, it.menuItemId, it.quantity, it.notes);
      }
      setIsModalOpen(false);
      setSelectedItems([]);
      await fetchOrders();
    } catch (err: any) {
      alert(err.message || 'Error al enviar pedido a cocina');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      await StaffApi.updateOrderStatus(orderId, newStatus);
      await fetchOrders();
    } catch (err: any) {
      console.error('Error al actualizar estado:', err);
      alert(err.message || 'Error al actualizar estado');
    }
  };

  const handleValidateOrder = async (orderId: string) => {
    try {
      await StaffApi.validateOrder(orderId);
      await fetchOrders();
    } catch (err: any) {
      console.error('Error al validar comanda:', err);
      alert(err.message || 'Error al validar comanda');
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingOrderId) return;
    setRejectSubmitting(true);
    try {
      await StaffApi.updateOrderStatus(rejectingOrderId, 'CANCELLED');
      setRejectingOrderId(null);
      setRejectReason('');
      await fetchOrders();
    } catch (err: any) {
      alert(err.message || 'Error al rechazar comanda');
    } finally {
      setRejectSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Call to Action & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="font-extrabold text-base text-white flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-amber-400" />
            <span>Comandas & Cocina (KDS Unificado)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Muestra todos los pedidos del salón (desde el QR del cliente o cargados por el mozo).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Audio Chime Button */}
          <button
            onClick={toggleAudio}
            title="Activar/Desactivar avisos de audio para comandas nuevas"
            className={`flex items-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
              isAudioEnabled
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-500/20'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {isAudioEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
            <span>{isAudioEnabled ? 'Audio KDS ON' : 'Activar Audio'}</span>
          </button>

          {/* Out of stock management button */}
          <button
            onClick={openStockModal}
            className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 font-bold text-xs active:scale-95 transition-all"
          >
            <PackageX className="w-4 h-4 text-amber-400" />
            <span>Agotados (Stock)</span>
          </button>

          {/* Manual order button */}
          <button
            onClick={openNewOrderModal}
            className="flex items-center gap-1.5 py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Cargar Comanda</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-10 text-slate-400 text-xs animate-pulse">
          Cargando comandas activas de cocina...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs">
          {error}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="text-center py-12 bg-slate-900/50 border border-slate-800/80 rounded-2xl space-y-2">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
            🍳
          </div>
          <h3 className="font-bold text-sm text-slate-200">No hay comandas en preparación</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Todas las órdenes del salón fueron despachadas y servidas.
          </p>
        </div>
      )}

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {orders.map((order) => {
          let urgencyBorder = 'border-slate-800 bg-slate-900/90';
          let badgeBg = 'bg-slate-800 text-slate-300';

          if (order.urgency === 'WARNING') {
            urgencyBorder = 'border-amber-500/50 bg-gradient-to-br from-amber-950/20 to-slate-900';
            badgeBg = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
          } else if (order.urgency === 'CRITICAL') {
            urgencyBorder = 'border-red-500/80 bg-gradient-to-br from-red-950/30 to-slate-900 animate-pulse';
            badgeBg = 'bg-red-500/30 text-red-200 border border-red-500/50';
          }

          const hasAllergy = order.items.some((it) => it.notes && ALLERGY_REGEX.test(it.notes));

          return (
            <div key={order.id} className={`rounded-2xl border p-4 space-y-3 shadow-lg ${urgencyBorder}`}>
              {/* Order Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-black text-sm text-white">
                    {order.tableLabel.replace(/[^0-9]/g, '') || '#'}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-white">{order.tableLabel}</h3>
                    <span className="text-[10px] text-slate-400 font-medium">{order.sector}</span>
                  </div>
                </div>

                <div className="text-right flex flex-col items-end gap-0.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${badgeBg}`}>
                    <Clock className="w-2.5 h-2.5" />
                    <span>hace {order.elapsedMinutes} min</span>
                  </span>
                  <span className="text-[10px] font-mono font-semibold text-slate-300">
                    {order.status === 'PENDING_VALIDATION' && '🟡 Por Validar'}
                    {order.status === 'CONFIRMED' && '🟡 Por Validar (Mozo/Alérgenos)'}
                    {order.status === 'IN_KITCHEN' && '🔥 En Cocina'}
                    {order.status === 'READY_TO_SERVE' && '🔔 Listo para Servir'}
                  </span>
                </div>
              </div>

              {/* Allergen Warning Banner */}
              {hasAllergy && (
                <div className="p-2.5 rounded-xl bg-red-950/80 border border-red-500/60 text-red-200 text-[11px] font-bold flex items-center gap-2 animate-pulse">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>⚠️ ALERTA ALÉRGENOS / CELÍACO — Confirmar antes de preparar</span>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-1.5 py-1">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between bg-slate-950/60 p-2.5 rounded-xl border border-slate-850">
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-amber-400 text-xs">{item.quantity}x</span>
                        <span className="font-bold text-xs text-white">{item.name}</span>
                        {item.tandaSeq && (
                          <span className="text-[9px] bg-slate-800 text-slate-300 font-mono px-1 rounded">
                            Tanda #{item.tandaSeq}
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className={`text-[11px] italic pl-4 mt-0.5 ${ALLERGY_REGEX.test(item.notes) ? 'text-red-300 font-semibold' : 'text-slate-400'}`}>
                          "{item.notes}"
                        </p>
                      )}
                      {(item.participantName || item.addedByGuest) && (
                        <span className="text-[10px] text-slate-400 block pl-4 mt-0.5">
                          👤 {item.participantName || item.addedByGuest}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      ${(item.unitPrice * item.quantity).toLocaleString('es-AR')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Action Buttons for Kitchen & Waiter */}
              <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
                {order.status === 'IN_KITCHEN' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'READY_TO_SERVE')}
                    className="flex-1 py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                  >
                    <span>🔔 Listo para servir</span>
                  </button>
                )}

                {order.status === 'READY_TO_SERVE' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'SERVED')}
                    className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/30 active:scale-95 transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Entregado a Mesa ✓</span>
                  </button>
                )}

                {(order.status === 'PENDING_VALIDATION' || order.status === 'CONFIRMED') && (
                  <button
                    onClick={() => handleValidateOrder(order.id)}
                    className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-md shadow-indigo-600/20"
                  >
                    <span>Validar y enviar a cocina</span>
                  </button>
                )}

                {/* Reject / Cancel button */}
                <button
                  onClick={() => setRejectingOrderId(order.id)}
                  title="Rechazar o cancelar comanda"
                  className="py-2 px-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition-all"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Rechazar</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL: CARGAR COMANDA MANUAL A MESA */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-lg p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                  <span>🍳 Cargar Comanda a Mesa</span>
                </h3>
                <p className="text-xs text-slate-400">Toma de pedido presencial por el mozo</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Select Table */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">Seleccionar Mesa:</label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                {tables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.sector || 'Salón'})
                  </option>
                ))}
              </select>
            </div>

            {/* Dishes Selection */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <span className="text-xs font-bold text-slate-300 block">Elegir Platos de la Carta:</span>
              {menu?.categories?.map((cat: any) => (
                <div key={cat.id} className="space-y-1.5">
                  <h4 className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider">{cat.name}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {cat.items?.map((item: any) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleAddItemToForm(item)}
                        className="p-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 flex items-center justify-between text-left group transition-all"
                      >
                        <div className="min-w-0 pr-1">
                          <span className="font-bold text-xs text-white block truncate">{item.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">${item.price.toLocaleString('es-AR')}</span>
                        </div>
                        <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-300 flex items-center justify-center font-bold text-xs group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
                          +
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Selected Items Summary */}
            {selectedItems.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 p-3 rounded-2xl space-y-2 max-h-36 overflow-y-auto">
                <span className="text-[11px] font-bold text-slate-300 block">Platos a enviar ({selectedItems.length}):</span>
                {selectedItems.map((it) => (
                  <div key={it.menuItemId} className="flex items-center justify-between gap-2 text-xs border-b border-slate-850 pb-1.5">
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-white block truncate">{it.quantity}x {it.name}</span>
                      <input
                        type="text"
                        placeholder="Nota de cocina (ej: jugoso, sin cebolla)"
                        value={it.notes}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedItems(prev => prev.map(p => p.menuItemId === it.menuItemId ? { ...p, notes: val } : p));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 mt-0.5 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItemFromForm(it.menuItemId)}
                      className="text-red-400 hover:text-red-300 p-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={selectedItems.length === 0 || submitting}
                onClick={handleSubmitOrder}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
              >
                {submitting ? 'Enviando...' : 'Enviar a Cocina 🍳'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GESTIÓN DE AGOTADOS (STOCK) */}
      {isStockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-xl p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                  <PackageX className="w-5 h-5 text-amber-400" />
                  <span>Control de Platos Agotados (Stock)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Desactiva platos que se quedaron sin insumos para impedir que comensales los pidan
                </p>
              </div>
              <button
                onClick={() => setIsStockModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {stockLoading ? (
              <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                <span>Cargando platos del local...</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {stockMenu?.categories?.map((cat: any) => (
                  <div key={cat.id} className="space-y-2">
                    <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider">
                      {cat.name} ({cat.items?.length || 0})
                    </h4>
                    <div className="space-y-1.5">
                      {cat.items?.map((item: any) => {
                        const isAvailable = item.isAvailable !== false;
                        const isToggling = togglingItemId === item.id;

                        return (
                          <div
                            key={item.id}
                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                              isAvailable
                                ? 'bg-slate-950/60 border-slate-800'
                                : 'bg-red-950/30 border-red-500/40'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <span className={`font-bold text-xs block truncate ${isAvailable ? 'text-white' : 'text-slate-400 line-through'}`}>
                                {item.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ${item.price.toLocaleString('es-AR')}
                              </span>
                            </div>

                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleToggleItemAvailability(item.id, isAvailable)}
                              className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50 active:scale-95 flex items-center gap-1.5 ${
                                isAvailable
                                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/30'
                              }`}
                            >
                              {isToggling ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : isAvailable ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5" />
                              )}
                              <span>{isAvailable ? 'Disponible' : 'Agotado (86)'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsStockModalOpen(false)}
                className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECHAZAR COMANDA CON MOTIVO */}
      {rejectingOrderId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  <span>Rechazar Comanda</span>
                </h3>
                <p className="text-xs text-slate-400">Esta acción cancelará la comanda en cocina</p>
              </div>
              <button
                onClick={() => setRejectingOrderId(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300">Motivo del rechazo (opcional):</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Ej: Insumos agotados, mesa canceló verbalmente, etc."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 h-24"
              />
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRejectingOrderId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={rejectSubmitting}
                onClick={handleConfirmReject}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black text-xs shadow-lg shadow-red-600/30 active:scale-95 transition-all"
              >
                {rejectSubmitting ? 'Cancelando...' : 'Confirmar Rechazo ✕'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
