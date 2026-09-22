import React, { useState, useEffect, useMemo } from 'react';
import { StaffApi, type StaffTableItemDTO } from '../lib/api';
import type { RestaurantMenuResponse, MenuCategoryDTO, MenuItemDTO } from '@mesaya/shared';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  RotateCcw,
  RefreshCw,
  Bell,
  Printer
} from 'lucide-react';

interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string | null;
  tags?: string[];
  guestName?: string | null;
  unitPrice: number;
  unitPriceMinor?: number | null;
}

interface KitchenOrder {
  id: string;
  tableId: string;
  tableLabel: string;
  sector: string;
  status: string;
  totalAmount: number;
  totalAmountMinor?: number | null;
  createdAt: string;
  elapsedMinutes: number;
  urgency: 'NORMAL' | 'WARNING' | 'CRITICAL';
  items: KitchenItem[];
}

interface KitchenOrdersManagerProps {
  restaurantId: string;
}

type FilterStatus = 'ALL' | 'IN_KITCHEN' | 'READY_TO_SERVE';

export const KitchenOrdersManager: React.FC<KitchenOrdersManagerProps> = ({ restaurantId }) => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ orderId: string; message: string; isError?: boolean } | null>(null);

  // E20 — comanda de cocina imprimible/portable en un puesto único.
  // Sólo estado local: abrir/reimprimir nunca muta la orden ni crea un pedido.
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [printVariant, setPrintVariant] = useState<'original' | 'reprint'>('original');
  const [printFormat, setPrintFormat] = useState<'58' | '80' | 'A4'>('80');
  const [printRequests, setPrintRequests] = useState<Record<string, number>>({});

  // Modal para que el mozo cargue una comanda a mano
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [tables, setTables] = useState<StaffTableItemDTO[]>([]);
  const [menu, setMenu] = useState<RestaurantMenuResponse | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<{ menuItemId: string; name: string; quantity: number; notes: string }[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchOrders = async (signal?: AbortSignal, isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const data = await StaffApi.getKitchenOrders(restaurantId, signal);
      setOrders(data.orders || []);
      setError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err.message || 'Error al cargar comandas');
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      controller = new AbortController();
      try {
        await fetchOrders(controller.signal);
        failures = 0;
        schedule(typeof document !== 'undefined' && document.hidden ? 10000 : 4000);
      } catch (_) {
        failures += 1;
        schedule(Math.min(4000 * Math.pow(1.5, failures), 15000));
      } finally {
        controller = null;
      }
    };

    tick();
    const handleOnline = () => {
      if (timer) clearTimeout(timer);
      failures = 0;
      tick();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [restaurantId]);

  const [modalError, setModalError] = useState<string | null>(null);

  const manualOrderFocusTrapRef = useFocusTrap(isModalOpen, () => {
    setModalError(null);
    setIsModalOpen(false);
  });
  const printOrderFocusTrapRef = useFocusTrap(!!printOrderId, () => setPrintOrderId(null));

  const openNewOrderModal = async () => {
    setIsModalOpen(true);
    setModalError(null);
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
      setModalError(err instanceof Error ? err.message : 'No se pudieron cargar las mesas o la carta para crear la comanda.');
    }
  };

  const handleAddItemToForm = (item: MenuItemDTO) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.menuItemId === item.id);
      if (existing) {
        return prev.map(i => i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { menuItemId: item.id, name: item.name, quantity: 1, notes: '' }];
    });
  };

  const handleRemoveItemFromForm = (menuItemId: string) => {
    setSelectedItems(prev => prev.filter(i => i.menuItemId !== menuItemId));
  };

  const handleSubmitOrder = async () => {
    if (!selectedTableId || selectedItems.length === 0) return;
    setSubmitting(true);
    setModalError(null);
    try {
      // Una comanda presencial es una tanda única y atómica. El endpoint
      // legado por ítem queda disponible para compatibilidad, pero no debe
      // convertir una selección de varias líneas en varias escrituras que se
      // mezclen con una ronda existente.
      await StaffApi.addManualOrderByStaff(selectedTableId, selectedItems.map((it) => ({
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        notes: it.notes
      })));
      setIsModalOpen(false);
      setSelectedItems([]);
      await fetchOrders();
    } catch (err: any) {
      setModalError(err?.message || 'Error al enviar pedido a cocina. Por favor reintenta.');
    } finally {
      setSubmitting(false);
    }
  };

  // Transición: En cocina -> Listo para servir (avisa a salón generando ORDER_DELIVERY)
  const handleMarkReady = async (orderId: string) => {
    setActionInProgress(prev => ({ ...prev, [orderId]: true }));
    setFeedback(null);
    try {
      await StaffApi.updateOrderStatus(orderId, 'READY_TO_SERVE');
      setFeedback({ orderId, message: '🔔 ¡Listo para servir! Aviso enviado al salón.' });
      await fetchOrders();
    } catch (err: any) {
      if (err?.code === 'ORDER_FINAL_STATE' || err?.message?.includes('final')) {
        setFeedback({ orderId, message: 'La comanda ya fue cancelada o cerrada en salón.', isError: true });
      } else {
        setFeedback({ orderId, message: err?.message || 'Error al actualizar comanda', isError: true });
      }
      await fetchOrders();
    } finally {
      setActionInProgress(prev => ({ ...prev, [orderId]: false }));
    }
  };

  // Excepción autorizada y auditada: Devolver a preparación (rehacer comanda)
  const handleRevertToKitchen = async (orderId: string) => {
    const confirmed = window.confirm('¿Devolver esta comanda a preparación para rehacerla?');
    if (!confirmed) return;

    setActionInProgress(prev => ({ ...prev, [orderId]: true }));
    setFeedback(null);
    try {
      await StaffApi.updateOrderStatus(orderId, 'IN_KITCHEN', { reason: 'Rehecho en cocina' });
      setFeedback({ orderId, message: '↩ Comanda devuelta a preparación. Salón notificado.' });
      await fetchOrders();
    } catch (err: any) {
      setFeedback({ orderId, message: err?.message || 'No se pudo devolver la comanda', isError: true });
      await fetchOrders();
    } finally {
      setActionInProgress(prev => ({ ...prev, [orderId]: false }));
    }
  };

  // Validar comanda pendiente de revisión
  const handleValidate = async (orderId: string) => {
    setActionInProgress(prev => ({ ...prev, [orderId]: true }));
    setFeedback(null);
    try {
      await StaffApi.updateOrderStatus(orderId, 'IN_KITCHEN');
      setFeedback({ orderId, message: 'Comanda validada e ingresada a cocina.' });
      await fetchOrders();
    } catch (err: any) {
      setFeedback({ orderId, message: err?.message || 'Error al validar comanda', isError: true });
      await fetchOrders();
    } finally {
      setActionInProgress(prev => ({ ...prev, [orderId]: false }));
    }
  };

  // E20 — canal honesto a cocina con papel/diálogo del navegador.
  // No llama a ReceiptService, PAYMENT_RECEIPT/PRE_BILL_DETAIL, updateOrderStatus,
  // addManualOrderByStaff ni a ningún StaffApi de mutación: sólo registra en
  // estado local que se solicitó la hoja. Si el navegador cancela el diálogo,
  // no hay callback que marque entrega/cobro/estado; reimprimir no crea pedido.
  const requestBrowserPrint = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      const schedule = (cb: () => void) => {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => window.setTimeout(cb, 0));
        } else {
          window.setTimeout(cb, 0);
        }
      };
      schedule(() => window.print());
    }
  };

  const handleOpenKitchenPrint = (order: KitchenOrder) => {
    const prior = printRequests[order.id] ?? 0;
    setPrintVariant(prior > 0 ? 'reprint' : 'original');
    setPrintOrderId(order.id);
    setPrintRequests((prev) => ({ ...prev, [order.id]: (prev[order.id] ?? 0) + 1 }));
    requestBrowserPrint();
  };

  // Una segunda solicitud desde la hoja también es una reimpresión local.
  // Nunca crea otra orden ni vuelve a consultar/mutuar el backend.
  const handleRequestKitchenPrint = () => {
    if (!printOrderId) return;
    const prior = printRequests[printOrderId] ?? 0;
    setPrintVariant(prior > 0 ? 'reprint' : 'original');
    setPrintRequests((prev) => ({ ...prev, [printOrderId]: (prev[printOrderId] ?? 0) + 1 }));
    requestBrowserPrint();
  };

  const handleCloseKitchenPrint = () => {
    setPrintOrderId(null);
  };

  const printOrder = useMemo(
    () => orders.find((o) => o.id === printOrderId) ?? null,
    [orders, printOrderId]
  );

  const filteredOrders = useMemo(() => {
    if (filter === 'IN_KITCHEN') {
      return orders.filter(o => o.status === 'IN_KITCHEN' || o.status === 'PENDING_VALIDATION');
    }
    if (filter === 'READY_TO_SERVE') {
      return orders.filter(o => o.status === 'READY_TO_SERVE');
    }
    return orders;
  }, [orders, filter]);

  const countInKitchen = useMemo(() => orders.filter(o => o.status === 'IN_KITCHEN' || o.status === 'PENDING_VALIDATION').length, [orders]);
  const countReady = useMemo(() => orders.filter(o => o.status === 'READY_TO_SERVE').length, [orders]);

  return (
    <div className="space-y-4 e20-kitchen-scope">
      {/* Header KDS con Filtros y Acciones */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-base text-white flex items-center gap-2">
              <span>Cocina & KDS (Segundo Puesto)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700">
                {orders.length} comandas
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Camino pedido → preparación → entrega. Listo avisa al salón sin cerrar entrega.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtros rápidos */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filter === 'ALL' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todas ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('IN_KITCHEN')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filter === 'IN_KITCHEN' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              En preparación ({countInKitchen})
            </button>
            <button
              type="button"
              onClick={() => setFilter('READY_TO_SERVE')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filter === 'READY_TO_SERVE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              Listas para retirar ({countReady})
            </button>
          </div>

          <button
            type="button"
            onClick={() => fetchOrders(undefined, true)}
            title="Refrescar comandas"
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={openNewOrderModal}
            className="flex items-center gap-1.5 py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <Plus className="w-4 h-4" />
            <span>+ Cargar Comanda</span>
          </button>
        </div>
      </div>

      {/* E20 — guía visible del modo de una pantalla, junto a los controles. */}
      <div className="e20-no-print p-3 rounded-xl bg-slate-900/70 border border-slate-800 text-xs text-slate-300 space-y-1">
        <p className="font-bold text-slate-100">Modo de una pantalla: comanda a cocina sin hardware dedicado</p>
        <p>
          Imprimí o copiá los datos con el diálogo del navegador, llevá la comanda a cocina
          y completá la recepción manual en la misma hoja. Si no hay canal validado a cocina,
          queda pendiente el gate humano/físico: llevar el papel y registrar quién lo recibe.
        </p>
        <p className="text-slate-400">
          La hoja dice COMANDA DE COCINA y no es un recibo económico. Registrar la solicitud
          no confirma que salió papel; cancelar el diálogo no cambia la orden.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label htmlFor="e20-print-format-global" className="font-bold text-slate-200">
            Formato de impresión:
          </label>
          <select
            id="e20-print-format-global"
            aria-label="Formato de impresión"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value as '58' | '80' | 'A4')}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <option value="58">58 mm</option>
            <option value="80">80 mm</option>
            <option value="A4">A4</option>
          </select>
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

      {!loading && filteredOrders.length === 0 && (
        <div className="text-center py-12 bg-slate-900/50 border border-slate-800/80 rounded-2xl space-y-2">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
            🍳
          </div>
          <h3 className="font-bold text-sm text-slate-200">
            {filter === 'ALL'
              ? 'No hay comandas activas en cocina'
              : filter === 'IN_KITCHEN'
              ? 'No hay comandas en preparación'
              : 'No hay comandas esperando retiro'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {filter === 'ALL'
              ? 'Todas las órdenes del salón fueron despachadas y servidas.'
              : 'Los platos fueron despachados o la vista tiene un filtro aplicado.'}
          </p>
        </div>
      )}

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredOrders.map((order) => {
          let urgencyBorder = 'border-slate-800 bg-slate-900/90';
          let badgeBg = 'bg-slate-800 text-slate-300';

          if (order.urgency === 'WARNING') {
            urgencyBorder = 'border-amber-500/50 bg-gradient-to-br from-amber-950/20 to-slate-900';
            badgeBg = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
          } else if (order.urgency === 'CRITICAL') {
            urgencyBorder = 'border-red-500/80 bg-gradient-to-br from-red-950/30 to-slate-900 animate-pulse';
            badgeBg = 'bg-red-500/30 text-red-200 border border-red-500/50';
          }

          const isActing = Boolean(actionInProgress[order.id]);
          const currentFeedback = feedback?.orderId === order.id ? feedback : null;
          const printCount = printRequests[order.id] ?? 0;
          const isReprint = printCount > 0;

          return (
            <div key={order.id} className={`rounded-2xl border p-4 space-y-3 shadow-lg transition-all ${urgencyBorder}`}>
              {/* Order Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-black text-base text-white">
                    {order.tableLabel.replace(/[^0-9]/g, '') || '#'}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-white">{order.tableLabel}</h3>
                    <span className="text-[10px] text-slate-400 font-medium">{order.sector}</span>
                  </div>
                </div>

                <div className="text-right flex flex-col items-end gap-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${badgeBg}`}>
                    <Clock className="w-3 h-3" />
                    <span>hace {order.elapsedMinutes} min</span>
                  </span>
                  <span className="text-[10px] font-semibold">
                    {order.status === 'PENDING_VALIDATION' && (
                      <span className="text-amber-400">🟡 Por Validar</span>
                    )}
                    {order.status === 'IN_KITCHEN' && (
                      <span className="text-amber-300">🔥 En Preparación</span>
                    )}
                    {order.status === 'READY_TO_SERVE' && (
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <Bell className="w-3 h-3 animate-pulse" /> Listo · Salón avisado
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Items List con Conservación de Notas y Alérgenos */}
              <div className="space-y-2 py-1">
                {order.items.map((item) => {
                  const hasAllergens = (item.tags || []).some(t =>
                    t.includes('GLUTEN_FREE') || t.includes('CELIAC') || t.includes('CELIACO')
                  );
                  const isVegan = (item.tags || []).includes('VEGAN');
                  const isVegetarian = (item.tags || []).includes('VEGETARIAN');

                  return (
                    <div
                      key={item.id}
                      className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/90 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="font-black text-amber-400 text-sm">{item.quantity}x</span>
                          <span className="font-bold text-xs text-white leading-tight">{item.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          ${(item.unitPrice * item.quantity).toLocaleString('es-AR')}
                        </span>
                      </div>

                      {/* Alérgenos / Tags de la carta */}
                      {(item.tags && item.tags.length > 0) && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {hasAllergens && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              🌾 Sin TACC
                            </span>
                          )}
                          {isVegan && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              🌱 Vegano
                            </span>
                          )}
                          {isVegetarian && !isVegan && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                              🥗 Vegetariano
                            </span>
                          )}
                        </div>
                      )}

                      {/* Comensal */}
                      {item.guestName && (
                        <p className="text-[10px] text-indigo-300 font-medium">Comensal: {item.guestName}</p>
                      )}

                      {/* Modificaciones / Notas destacadas */}
                      {item.notes && (
                        <div className="p-1.5 rounded-lg bg-amber-950/40 border border-amber-500/40 flex items-start gap-1.5 text-amber-200 text-[11px] font-medium">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <span className="italic leading-snug font-semibold">{item.notes}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Feedback inline */}
              {currentFeedback && (
                <div
                  className={`p-2 rounded-xl text-xs font-semibold ${
                    currentFeedback.isError
                      ? 'bg-rose-950/50 border border-rose-500/50 text-rose-200'
                      : 'bg-emerald-950/50 border border-emerald-500/50 text-emerald-200'
                  }`}
                >
                  {currentFeedback.message}
                </div>
              )}

              {/* Botones de Acción de Cocina (Listo no equivale a Entregado) */}
              <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isActing}
                  onClick={() => handleOpenKitchenPrint(order)}
                  aria-label={`${isReprint ? 'Reimprimir comanda' : 'Imprimir comanda'} ${order.tableLabel} ${order.id}`}
                  title="Abrir la comanda de cocina para imprimir con el diálogo del navegador"
                  className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-900 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                >
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isReprint ? 'Reimprimir comanda' : 'Imprimir comanda'}</span>
                </button>
                {order.status === 'IN_KITCHEN' && (
                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleMarkReady(order.id)}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
                  >
                    <Bell className="w-4 h-4" />
                    <span>{isActing ? 'Avisando al salón...' : '🔔 Listo para servir (Avisar a salón)'}</span>
                  </button>
                )}

                {order.status === 'READY_TO_SERVE' && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-200 text-xs flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Esperando retiro por mozo</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-300">Entrega en salón</span>
                    </div>

                    <button
                      type="button"
                      disabled={isActing}
                      onClick={() => handleRevertToKitchen(order.id)}
                      className="w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
                      title="Devolver a preparación si se requiere rehacer el plato"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isActing ? 'Actualizando...' : '↩ Devolver a preparación (Rehacer)'}</span>
                    </button>
                  </div>
                )}

                {order.status === 'PENDING_VALIDATION' && (
                  <button
                    type="button"
                    disabled={isActing}
                    onClick={() => handleValidate(order.id)}
                    className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                  >
                    <span>{isActing ? 'Validando...' : 'Validar y enviar a preparación'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL: CARGAR COMANDA MANUAL A MESA */}
      {isModalOpen && (
        <div ref={manualOrderFocusTrapRef} role="dialog" aria-modal="true" aria-labelledby="kitchen-order-modal-title" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-lg p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 id="kitchen-order-modal-title" className="font-extrabold text-base text-white flex items-center gap-2">
                  <span>🍳 Cargar Comanda a Mesa</span>
                </h3>
                <p className="text-xs text-slate-400">Toma de pedido presencial por el mozo</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setIsModalOpen(false);
                }}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
                aria-label="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {modalError}
              </div>
            )}

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
              {menu?.categories?.map((cat: MenuCategoryDTO) => (
                <div key={cat.id} className="space-y-1.5">
                  <h4 className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider">{cat.name}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {cat.items?.map((item: MenuItemDTO) => (
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
                      aria-label={`Eliminar ${it.name} de la comanda`}
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
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={selectedItems.length === 0 || submitting}
                onClick={handleSubmitOrder}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                {submitting ? 'Enviando...' : 'Enviar a Cocina 🍳'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* E20 — hoja de comanda de cocina imprimible/portable (una pantalla). */}
      {printOrder && (
        <div ref={printOrderFocusTrapRef} className="e20-print-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="e20-kitchen-ticket-title"
            className={`e20-kitchen-ticket e20-format-${printFormat} w-full max-w-md bg-white text-slate-950 rounded-xl p-5 space-y-3 shadow-2xl`}
          >
            <div className="border-b-2 border-dashed border-slate-400 pb-2 space-y-1">
              <h3 id="e20-kitchen-ticket-title" className="font-black text-lg tracking-wide">
                COMANDA DE COCINA
              </h3>
              <p className="text-xs font-bold">
                {printVariant === 'reprint'
                  ? 'REIMPRESIÓN / SOLICITUD DE COPIA — no crea otro pedido'
                  : 'Original para llevar a cocina — no crea otro pedido al reimprimir'}
              </p>
              <p className="text-xs">No es un recibo económico. No llama a caja ni marca cobro.</p>
            </div>

            <dl className="text-xs space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="font-bold">ID de comanda:</dt>
                <dd className="font-mono break-all">{printOrder.id}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-bold">Mesa:</dt>
                <dd>{printOrder.tableLabel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-bold">Sector:</dt>
                <dd>{printOrder.sector}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-bold">Fecha/hora:</dt>
                <dd>{printOrder.createdAt}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-bold">Emitida:</dt>
                <dd>{new Date(printOrder.createdAt).toLocaleString('es-AR')}</dd>
              </div>
            </dl>

            <div className="space-y-1.5">
              <h4 className="font-bold text-xs uppercase tracking-wider">Ítems y cantidades</h4>
              <ul className="space-y-1.5">
                {printOrder.items.map((item) => (
                  <li key={item.id} className="border border-slate-300 rounded-lg p-2 text-xs space-y-0.5">
                    <p>
                      <span className="font-black">{item.quantity}x </span>
                      <span className="font-bold">{item.name}</span>
                    </p>
                    {item.guestName && <p>Comensal: {item.guestName}</p>}
                    {item.notes && <p className="italic">Notas: {item.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border border-slate-400 rounded-lg p-2 text-xs space-y-1 bg-slate-50">
              <p className="font-bold">
                Abrir o imprimir esta hoja no confirma entrega, cobro ni cambio de estado.
              </p>
              <p>
                Registrar la solicitud no confirma que salió papel. Si el navegador cancela el
                diálogo, la orden queda igual y se puede reintentar como reimpresión.
              </p>
              <p>Listo para servir sigue esperando retiro por mozo; el salón entrega.</p>
            </div>

            <section aria-label="Entrega manual" className="border-2 border-slate-900 rounded-lg p-2.5 text-xs space-y-1.5">
              <h4 className="font-black uppercase tracking-wider">Recepción física / entrega manual</h4>
              <p>Llevar esta comanda a cocina y completar la recepción sin crear otro pedido.</p>
              <p>Entregó: ________________________________</p>
              <p>Recibió: ________________________________</p>
              <p>Hora de recepción: ______:______</p>
              <p>Iniciales / firma: ______________________</p>
              <p>Conciliación: ___________________________</p>
            </section>

            <div className="e20-no-print flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="e20-print-format" className="font-bold">
                Formato de impresión:
              </label>
              <select
                id="e20-print-format"
                aria-label="Formato de impresión"
                value={printFormat}
                onChange={(e) => setPrintFormat(e.target.value as '58' | '80' | 'A4')}
                className="border border-slate-400 rounded-lg px-2 py-1.5 text-xs bg-white text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
                <option value="A4">A4</option>
              </select>
            </div>

            <div className="e20-no-print flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRequestKitchenPrint}
                aria-label={`${printVariant === 'reprint' ? 'Reimprimir' : 'Imprimir'} comanda ${printOrder.tableLabel} con el diálogo del navegador`}
                className="flex-1 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                {printVariant === 'reprint' ? 'Reimprimir con diálogo del navegador' : 'Imprimir con diálogo del navegador'}
              </button>
              <button
                type="button"
                onClick={handleCloseKitchenPrint}
                aria-label="Cerrar hoja de comanda de cocina"
                className="flex-1 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs border border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                Cerrar hoja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
