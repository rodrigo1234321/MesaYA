import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CallStatus,
  CallType,
  PaymentMethod as GuestPaymentMethod,
  OrderStatus,
  SECTOR_LABELS,
  ServiceAccountDTO,
  ServiceTaskDTO,
  ServiceWorkspaceDTO,
  StaffUserDTO,
  TableFSMState,
  STATE_LABELS
} from '@mesaya/shared';
import {
  AlertCircle,
  Banknote,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coffee,
  ExternalLink,
  Filter,
  LayoutDashboard,
  LockKeyhole,
  MapPinned,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  UserRound,
  Users,
  X
} from 'lucide-react';
import { StaffApi } from '../lib/api';

interface ServiceWorkspaceProps {
  restaurantId: string;
  currentUser: StaffUserDTO;
  onOpenKitchen?: () => void;
  onRequireOperatorPin?: (action?: { label: string; action?: () => void }) => void;
  syncSnapshot?: ServiceWorkspaceDTO | null;
  syncLoading?: boolean;
  syncError?: string | null;
  syncLastSuccessTimestamp?: number | null;
  onRefresh?: () => Promise<boolean | void>;
}

type TaskFilter = 'ALL' | 'CALL' | 'ORDER' | 'ACCOUNT' | 'CLEAN';
type PaymentMethod =
  | 'WAITER_CASH'
  | 'WAITER_CARD'
  | 'WAITER_CARD_DEBIT'
  | 'WAITER_CARD_CREDIT'
  | 'WAITER_MP_QR'
  | 'WAITER_TRANSFER';

function requestedPaymentLabel(method?: GuestPaymentMethod | string | null) {
  if (!method || method === 'NOT_APPLICABLE') return 'Sin preferencia informada';
  if (method === GuestPaymentMethod.CASH || method === 'CASH') return 'Efectivo';
  if (method === GuestPaymentMethod.CARD || method === 'CARD') return 'Tarjeta (Débito/Crédito)';
  if (method === GuestPaymentMethod.CARD_DEBIT || method === 'CARD_DEBIT') return 'Tarjeta Débito';
  if (method === GuestPaymentMethod.CARD_CREDIT || method === 'CARD_CREDIT') return 'Tarjeta Crédito';
  if (method === GuestPaymentMethod.MERCADO_PAGO || method === 'MERCADO_PAGO') return 'Mercado Pago (QR)';
  if (method === 'WAITER_CARD_DEBIT') return 'Tarjeta Débito';
  if (method === 'WAITER_CARD_CREDIT') return 'Tarjeta Crédito';
  if (method === 'WAITER_TRANSFER') return 'Transferencia';
  return String(method);
}

function waiterPaymentForRequested(method?: GuestPaymentMethod | string | null): PaymentMethod | '' {
  if (!method) return '';
  if (method === GuestPaymentMethod.CASH || method === 'CASH') return 'WAITER_CASH';
  if (method === GuestPaymentMethod.CARD || method === 'CARD') return 'WAITER_CARD';
  if (method === GuestPaymentMethod.CARD_DEBIT || method === 'CARD_DEBIT') return 'WAITER_CARD_DEBIT';
  if (method === GuestPaymentMethod.CARD_CREDIT || method === 'CARD_CREDIT') return 'WAITER_CARD_CREDIT';
  if (method === GuestPaymentMethod.MERCADO_PAGO || method === 'MERCADO_PAGO') return 'WAITER_MP_QR';
  if (method === 'WAITER_CARD_DEBIT') return 'WAITER_CARD_DEBIT';
  if (method === 'WAITER_CARD_CREDIT') return 'WAITER_CARD_CREDIT';
  if (method === 'WAITER_TRANSFER') return 'WAITER_TRANSFER';
  return '';
}

const TASK_FILTER_LABELS: Record<TaskFilter, string> = {
  ALL: 'Todo',
  CALL: 'Personas',
  ORDER: 'Cocina',
  ACCOUNT: 'Cuentas', CLEAN: 'Limpieza'
};

const TASK_KIND_LABELS: Record<string, string> = {
  CALL: 'Solicitud',
  ORDER_VALIDATION: 'Validación',
  ORDER_PREPARATION: 'Cocina',
  ORDER_DELIVERY: 'Entrega',
  ACCOUNT_COLLECTION: 'Cobro', TABLE_CLEANUP: 'Limpieza'
};

const STATE_TEXT: Record<string, string> = {
  [TableFSMState.AVAILABLE]: 'Disponible',
  [TableFSMState.RESERVED]: 'Reservada',
  [TableFSMState.OCCUPIED_NO_ORDER]: 'Ocupada sin pedido',
  [TableFSMState.ORDER_IN_KITCHEN]: 'Pedido en cocina',
  [TableFSMState.EATING]: 'Comiendo',
  [TableFSMState.BILL_REQUESTED]: 'Cuenta solicitada',
  [TableFSMState.PAID]: 'Cobrado',
  [TableFSMState.TO_CLEAN]: 'Por limpiar'
};

function formatMinor(amountMinor: number) {
  return `$${(Math.max(0, amountMinor) / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function sectorLabel(sector: string) {
  return SECTOR_LABELS[sector as keyof typeof SECTOR_LABELS] || sector || 'Salón';
}

function taskFilterMatches(task: ServiceTaskDTO, filter: TaskFilter) {
  // Las cuentas abiertas son contexto de la pestaña Cuentas, no una alerta
  // permanente en Todo. El llamado BILL sí sigue apareciendo mientras está
  // activo porque requiere atención.
  if (filter === 'ALL') return task.kind !== 'ACCOUNT_COLLECTION';
  if (filter === 'CALL') return task.kind === 'CALL';
  if (filter === 'ORDER') return task.kind.startsWith('ORDER_');
  if (filter === 'ACCOUNT') return task.kind === 'ACCOUNT_COLLECTION' || task.payload.callType === CallType.BILL;
  return task.kind === 'TABLE_CLEANUP';
}

function taskStatusLabel(task: ServiceTaskDTO) {
  if (task.kind === 'ACCOUNT_COLLECTION') return 'Pendiente de cobro';
  if (task.kind === 'TABLE_CLEANUP') return 'Pendiente de limpieza';
  if (task.kind === 'CALL') {
    return task.status === CallStatus.IN_PROGRESS ? 'En atención' : 'Pendiente';
  }
  if (task.status === OrderStatus.PENDING_VALIDATION) return 'Pendiente de validar';
  if (task.status === OrderStatus.IN_KITCHEN) return 'En preparación';
  if (task.status === OrderStatus.READY_TO_SERVE) return 'Listo para entregar';
  return task.status;
}

function taskActionLabel(task: ServiceTaskDTO) {
  if (task.kind === 'CALL') {
    // E10-E11: la acción atiende el llamado y abre el contexto de mesa/cuenta;
    // no crea la cuenta (la cuenta vive por ocupación/tandas aceptadas).
    if (task.payload.callType === CallType.BILL) return task.status === CallStatus.PENDING ? 'Atender y ver cuenta' : 'Ver cuenta';
    return task.status === CallStatus.PENDING ? 'Atender y resolver' : 'Marcar atendido';
  }
  if (task.kind === 'ORDER_VALIDATION') return task.payload.reviewReason ? 'Aceptar y enviar' : 'Validar y enviar';
  if (task.kind === 'ORDER_PREPARATION') return 'Marcar listo';
  if (task.kind === 'ORDER_DELIVERY') return 'Entregado';
  if (task.kind === 'TABLE_CLEANUP') return 'Mesa lista';
  // E10: el cobro no se resuelve por act/claim; se liquida en el contexto de mesa.
  return 'Ver cuenta';
}

function accountRoundStatusLabel(status: string) {
  if (status === OrderStatus.CONFIRMED) return 'Recibida';
  if (status === OrderStatus.IN_KITCHEN) return 'En cocina';
  if (status === OrderStatus.READY_TO_SERVE) return 'Lista';
  if (status === OrderStatus.SERVED) return 'Servida';
  if (status === OrderStatus.PAID) return 'Pagada';
  return status;
}

export const ServiceWorkspace: React.FC<ServiceWorkspaceProps> = ({
  restaurantId,
  currentUser,
  onOpenKitchen,
  onRequireOperatorPin,
  syncSnapshot,
  syncLoading,
  syncError,
  syncLastSuccessTimestamp,
  onRefresh
}) => {
  const [snapshot, setSnapshot] = useState<ServiceWorkspaceDTO | null>(syncSnapshot ?? null);
  const [loading, setLoading] = useState(syncSnapshot !== undefined ? (syncLoading ?? false) : true);
  const [error, setError] = useState<string | null>(syncError ?? null);

  useEffect(() => {
    if (syncSnapshot !== undefined) {
      setSnapshot(syncSnapshot);
      setLoading(syncLoading ?? false);
      if (syncError !== undefined) setError(syncError);
    }
  }, [syncSnapshot, syncLoading, syncError]);
  const [filter, setFilter] = useState<TaskFilter>('ALL');
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const frozenTasksRef = useRef<ServiceTaskDTO[]>([]);
  const previousTaskIdsRef = useRef<Set<string>>(new Set());
  const [newlyArrivedTaskIds, setNewlyArrivedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualMenu, setManualMenu] = useState<any | null>(null);
  const [manualItems, setManualItems] = useState<Array<{ menuItemId: string; name: string; price: number; quantity: number }>>([]);
  const [manualDraftsByTableId, setManualDraftsByTableId] = useState<Record<string, Array<{ menuItemId: string; name: string; price: number; quantity: number }>>>({});
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [paymentMethodBySession, setPaymentMethodBySession] = useState<Record<string, PaymentMethod | ''>>({});
  const [tipBySession, setTipBySession] = useState<Record<string, string>>({});
  const [responsibleBySession, setResponsibleBySession] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  // E09: entregas propias recientes con ventana visible de 30s para deshacer.
  const [recentDeliveries, setRecentDeliveries] = useState<Record<string, number>>({});
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [reauthAccount, setReauthAccount] = useState<ServiceAccountDTO | null>(null);
  const [reauthPin, setReauthPin] = useState('');
  const [reauthSubmitting, setReauthSubmitting] = useState(false);
  const settlementKeys = useRef(new Map<string, string>());
  const queueRef = useRef<HTMLElement | null>(null);
  const tableContextRef = useRef<HTMLDivElement | null>(null);
  const pendingTableFocusRef = useRef<string | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastSelectedTableTriggerRef = useRef<HTMLElement | null>(null);

  const requestTableContext = (tableId: string, triggerElement?: HTMLElement) => {
    if (triggerElement) {
      lastSelectedTableTriggerRef.current = triggerElement;
    }
    pendingTableFocusRef.current = tableId;
    setSelectedTableId(tableId);
  };

  // E11: Navegación por teclado físico y focus management accesible
  // Escape nunca confirma pago ni mutaciones destructivas; cierra contextos en cascada.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // Atajo '/' para enfocar rápidamente el buscador de mesa (si no se está escribiendo)
      if (event.key === '/' && !isInputActive && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const searchInput = document.getElementById('table-search-input');
        if (searchInput) {
          searchInput.focus();
        }
        return;
      }

      // Escape: Cierra modales / contextos en orden inverso. NUNCA confirma pagos.
      if (event.key === 'Escape') {
        if (reauthAccount) {
          event.preventDefault();
          if (!reauthSubmitting) {
            setReauthAccount(null);
            setReauthPin('');
          }
          return;
        }
        if (manualOrderOpen) {
          event.preventDefault();
          if (!manualSubmitting) {
            setManualOrderOpen(false);
          }
          return;
        }
        if (filterMenuOpen) {
          event.preventDefault();
          setFilterMenuOpen(false);
          filterButtonRef.current?.focus();
          return;
        }
        if (selectedTableId) {
          event.preventDefault();
          setSelectedTableId(null);
          // Restaurar foco al elemento que abrió la mesa o al buscador
          if (lastSelectedTableTriggerRef.current) {
            lastSelectedTableTriggerRef.current.focus();
            lastSelectedTableTriggerRef.current = null;
          } else {
            document.getElementById('table-search-input')?.focus();
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reauthAccount, reauthSubmitting, manualOrderOpen, manualSubmitting, filterMenuOpen, selectedTableId]);

  // E07: el atajo de cocina no navega fuera de Servicio; enfoca la cola con filtro Cocina.
  const focusKitchen = () => {
    if (onOpenKitchen) { onOpenKitchen(); return; }
    setFilter('ORDER');
    queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const refresh = async (signal?: AbortSignal): Promise<boolean> => {
    if (onRefresh) {
      try {
        await onRefresh();
        return true;
      } catch {
        return false;
      }
    }
    try {
      const data = await StaffApi.getServiceWorkspace(restaurantId, signal);
      if (signal?.aborted) return false;
      setSnapshot(data);
      setError(null);
      return true;
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !signal?.aborted) {
        setError(err.message || 'Servicio no está disponible por el momento');
      }
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (syncSnapshot !== undefined) {
      // E08: Sincronización gobernada por el shell único. No arrancar ciclos duplicados.
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;
    let inFlight = false;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const ok = await refresh(controller.signal);
        failures = ok ? 0 : failures + 1;
      } catch (_) {
        // refresh already classifies the error; this guard keeps the scheduler
        // resilient if a future adapter throws outside that boundary.
        failures += 1;
      } finally {
        inFlight = false;
        controller = null;
        if (!cancelled) {
          const baseDelay = document.hidden ? 15000 : 5000;
          schedule(Math.min(30000, baseDelay * Math.pow(1.7, failures)));
        }
      }
    };

    const refreshNow = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };

    const markOffline = () => setError('Sin conexión con el servidor; se conserva el último snapshot y se reintentará automáticamente.');

    void tick();
    window.addEventListener('online', refreshNow);
    window.addEventListener('offline', markOffline);
    document.addEventListener('visibilitychange', refreshNow);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', refreshNow);
      window.removeEventListener('offline', markOffline);
      document.removeEventListener('visibilitychange', refreshNow);
    };
  }, [restaurantId]);

  const tables = snapshot?.floorPlan.tables || [];
  const accounts = snapshot?.accounts || [];
  const tasks = snapshot?.tasks || [];
  const allowWaitersToCollectCash = Boolean(snapshot?.allowWaitersToCollectCash);
  const availableSectors = useMemo(() => {
    const sectors = new Set(tasks.map((task) => task.sector).filter(Boolean));
    return ['ALL', ...[...sectors].sort((a, b) => sectorLabel(a).localeCompare(sectorLabel(b), 'es'))];
  }, [tasks]);
  // Detección de tareas recién llegadas para alertar visualmente sin saltos sorpresivos
  useEffect(() => {
    if (tasks.length === 0) return;
    const incomingIds = new Set(tasks.map((t) => t.targetId));
    if (previousTaskIdsRef.current.size > 0) {
      const brandNew = new Set<string>();
      for (const id of incomingIds) {
        if (!previousTaskIdsRef.current.has(id)) {
          brandNew.add(id);
        }
      }
      if (brandNew.size > 0) {
        setNewlyArrivedTaskIds(brandNew);
        const timer = setTimeout(() => setNewlyArrivedTaskIds(new Set()), 4000);
        return () => clearTimeout(timer);
      }
    }
    previousTaskIdsRef.current = incomingIds;
  }, [tasks]);

  // Prioridad canónica de atención física:
  // 1. CALL (Mozo pedido en salón)
  // 2. ORDER_DELIVERY (Plato listo en pase)
  // 3. ACCOUNT_COLLECTION (Comensal listo para pagar)
  // 4. ORDER_VALIDATION (Excepción en comanda)
  // 5. TABLE_CLEANUP (Mesa por limpiar)
  const taskPriority = (t: ServiceTaskDTO): number => {
    switch (t.kind) {
      case 'CALL': return 1;
      case 'ORDER_DELIVERY': return 2;
      case 'ACCOUNT_COLLECTION': return 3;
      case 'ORDER_VALIDATION': return 4;
      case 'TABLE_CLEANUP': return 5;
      default: return 6;
    }
  };

  const sortTasks = (taskList: ServiceTaskDTO[]): ServiceTaskDTO[] => {
    return [...taskList].sort((a, b) => {
      const pDiff = taskPriority(a) - taskPriority(b);
      if (pDiff !== 0) return pDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  };

  const isInteracting = Boolean(hoveredTaskId || focusedTaskId || actionBusy);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter((task) => {
      const matchesFilter = taskFilterMatches(task, filter);
      const matchesSector = selectedSector === 'ALL' || task.sector === selectedSector;
      const matchesSearch = !q ||
        task.tableLabel.toLowerCase().includes(q) ||
        task.title.toLowerCase().includes(q) ||
        task.summary.toLowerCase().includes(q);
      return matchesFilter && matchesSector && matchesSearch;
    });
  }, [tasks, filter, selectedSector, searchQuery]);

  const visibleTasks = useMemo(() => {
    if (isInteracting && frozenTasksRef.current.length > 0) {
      // Congelar posiciones: actualizar datos de las existentes y anexar nuevas al final
      const taskMap = new Map(filteredTasks.map((t) => [t.taskKey, t]));
      const preserved: ServiceTaskDTO[] = [];
      for (const f of frozenTasksRef.current) {
        if (taskMap.has(f.taskKey)) {
          preserved.push(taskMap.get(f.taskKey)!);
          taskMap.delete(f.taskKey);
        }
      }
      for (const remaining of taskMap.values()) {
        preserved.push(remaining);
      }
      return preserved;
    }
    const sorted = sortTasks(filteredTasks);
    frozenTasksRef.current = sorted;
    return sorted;
  }, [filteredTasks, isInteracting]);
  const selectedTable = tables.find((table) => table.id === selectedTableId) || null;
  // E10-E11: la tarjeta sintética ACCOUNT_COLLECTION vive sólo en la cola global;
  // en el panel la cuenta ya tiene Registrar pago/Cobrar y cerrar a la derecha.
  // TABLE_CLEANUP también vive en la cola; en el panel el control canónico es el
  // bloque derecho "Mesa lista", para no duplicar dos botones para la misma mesa.
  const selectedTasksAll = selectedTable ? tasks.filter((task) => task.tableId === selectedTable.id) : [];
  const selectedTasks = selectedTasksAll.filter((task) => task.kind !== 'ACCOUNT_COLLECTION' && task.kind !== 'TABLE_CLEANUP');
  const selectedAccount = selectedTable ? accounts.find((account) => account.tableId === selectedTable.id) || null : null;
  const accountForTask = (task: ServiceTaskDTO) => accounts.find((account) => account.tableId === task.tableId) || null;

  // La propina elegida por el cliente llega como importe en centavos y se
  // precarga una sola vez en el campo del cobro. Si el mozo la edita o la
  // borra, el polling no debe pisar esa decisión local.
  useEffect(() => {
    if (accounts.length === 0) return;
    setTipBySession((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const account of accounts) {
        const requestedTipMinor = Number(account.requestedTipMinor || 0);
        if (requestedTipMinor <= 0 || Object.prototype.hasOwnProperty.call(previous, account.tableSessionId)) continue;
        next[account.tableSessionId] = (requestedTipMinor / 100).toFixed(2);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [accounts]);

  useEffect(() => {
    if (!selectedTableId || pendingTableFocusRef.current !== selectedTableId || !tableContextRef.current) return;
    const target = tableContextRef.current;
    pendingTableFocusRef.current = null;
    requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
      target.focus({ preventScroll: true });
    });
  }, [selectedTableId, selectedAccount]);

  const setFailure = (err: any) => {
    setActionError(err?.message || 'La acción no se pudo completar; la tarjeta sigue visible para reintentar.');
  };

  const handleTask = async (task: ServiceTaskDTO) => {
    // E10: ACCOUNT_COLLECTION no usa claim/act/resolve; el cobro vive en el
    // contexto de mesa con los comandos canónicos de cuenta por sesión.
    if (task.kind === 'ACCOUNT_COLLECTION') {
      requestTableContext(task.tableId);
      const account = accountForTask(task);
      const requested = task.payload.paymentMethod || account?.requestedPaymentMethod;
      const waiterMethod = waiterPaymentForRequested(requested);
      if (account && waiterMethod) {
        setPaymentMethodBySession((previous) => previous[account.tableSessionId]
          ? previous
          : { ...previous, [account.tableSessionId]: waiterMethod });
      }
      return;
    }
    if (task.kind === 'TABLE_CLEANUP') {
      setSelectedTableId(task.tableId);
      await handleMarkClean(task.targetId, task.tableLabel);
      return;
    }
    if (task.claim && task.claim.staffUserId !== currentUser.id) {
      setFailure(new Error(`La tarea está siendo atendida por ${task.claim.staffName || 'otro operador'}.`));
      return;
    }
    setActionBusy(task.taskKey);
    setActionError(null);
    try {
      // E06: una sola intención atómica (claim+mutación+resolve en el servidor).
      // E09: se usa el resultado de actTask, sin segunda llamada claim/resolve.
      const res = await StaffApi.actServiceTask(task.kind, task.targetId, { action: 'COMPLETE' });
      if (task.kind === 'ORDER_DELIVERY' && res?.status === 'SERVED') {
        const expiresAt = Date.now() + 30_000;
        setRecentDeliveries((prev) => ({ ...prev, [task.targetId]: expiresAt }));
        const prevTimer = undoTimers.current.get(task.targetId);
        if (prevTimer) clearTimeout(prevTimer);
        undoTimers.current.set(task.targetId, setTimeout(() => {
          setRecentDeliveries((prev) => {
            const next = { ...prev };
            delete next[task.targetId];
            return next;
          });
          undoTimers.current.delete(task.targetId);
        }, 30_000));
      }
      requestTableContext(task.tableId);
      await refresh();
    } catch (err: any) {
      setFailure(err);
      await refresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleUndoDelivery = async (targetId: string, tableId: string) => {
    setActionBusy(`ORDER_DELIVERY:${targetId}:undo`);
    setActionError(null);
    try {
      await StaffApi.actServiceTask('ORDER_DELIVERY', targetId, { action: 'UNDO' });
      setRecentDeliveries((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      const timer = undoTimers.current.get(targetId);
      if (timer) { clearTimeout(timer); undoTimers.current.delete(targetId); }
      setSelectedTableId(tableId);
      await refresh();
    } catch (err: any) {
      setFailure(err);
      await refresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleRejectTask = async (task: ServiceTaskDTO) => {
    if (task.kind !== 'ORDER_VALIDATION' || !task.payload.reviewReason) return;
    if (task.claim && task.claim.staffUserId !== currentUser.id) {
      setFailure(new Error(`La tarea está siendo atendida por ${task.claim.staffName || 'otro operador'}.`));
      return;
    }
    const reason = window.prompt(
      `Motivo para rechazar la comanda de ${task.tableLabel}:`,
      task.payload.reviewReason.detail || ''
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setFailure(new Error('El rechazo necesita un motivo explícito; la comanda sigue pendiente.'));
      return;
    }
    setActionBusy(task.taskKey);
    setActionError(null);
    try {
      await StaffApi.actServiceTask(task.kind, task.targetId, { action: 'REJECT', reason: reason.trim() });
      setSelectedTableId(task.tableId);
      await refresh();
    } catch (err: any) {
      setFailure(err);
      await refresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleRelease = async (task: ServiceTaskDTO) => {
    if (!task.claim || (task.claim.staffUserId !== currentUser.id && currentUser.role !== 'MANAGER')) return;
    setActionBusy(`${task.taskKey}:release`);
    setActionError(null);
    try {
      await StaffApi.releaseServiceTask(task.kind, task.targetId);
      await refresh();
    } catch (err: any) {
      setFailure(err);
    } finally {
      setActionBusy(null);
    }
  };

  type SettleMode = 'keep' | 'close';
  const [reauthMode, setReauthMode] = useState<SettleMode>('keep');

  const settleFailure = (err: any): string => {
    const code = err?.code as string | undefined;
    const status = err?.statusCode as number | undefined;
    if (code === 'TOKEN_SCOPE_MISMATCH') {
      return 'El PIN temporal del Encargado no corresponde a esta mesa o ya expiró. Solicitá el PIN nuevamente sobre esta mesa.';
    }
    if (code === 'STALE_ACCOUNT_VERSION' || code === 'VERSION_MISMATCH' || code === 'ACCOUNT_VERSION_MISMATCH') {
      return `${err?.message || 'La cuenta cambió mientras cobrabas (otra ronda o pago registrado en otro equipo).'} Actualizá la mesa y volvé a intentarlo con el saldo visible.`;
    }
    if (code === 'SETTLE_CONFLICT' || code === 'CLOSE_CONFLICT') {
      return `${err?.message || 'Otro cobro se registró primero para esta cuenta.'} Se actualizó la mesa; reintentá sólo si persiste el saldo.`;
    }
    if (code === 'NOTHING_TO_SETTLE') {
      return 'La cuenta ya no tiene saldo pendiente; la mesa fue actualizada.';
    }
    if (code === 'OVERPAYMENT') {
      return `${err?.message || 'El monto supera el saldo pendiente.'} Ajustá el monto al saldo visible y reintentá.`;
    }
    if (code === 'DIGITAL_METHOD_UNAVAILABLE') {
      return `${err?.message || 'El método digital no está disponible en este local.'} Cobrá en efectivo o con otro método habilitado.`;
    }
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      return 'Ese reintento cambió algún dato (monto, método o propina). Repetilo con exactamente los mismos valores o actualizá la mesa.';
    }
    if (code === 'BALANCE_REMAINING' || code === 'PENDING_ITEMS' || code === 'DRAFT_UNRESOLVED' || code === 'PENDING_VALIDATION_UNRESOLVED') {
      return `${err?.message || 'Quedan pedidos o tandas pendientes antes de cerrar.'} Registrá el pago parcial con "Registrar pago y mantener mesa" o resolvé los pendientes.`;
    }
    if (code === 'SETTLE_CLOSURE_INCOMPLETE') {
      return `${err?.message || 'El cobro quedó registrado pero no se pudo liberar la mesa.'} Reintentá con exactamente los mismos valores para completar el pase a limpieza.`;
    }
    if (status === 409) {
      return `${err?.message || 'La cuenta cambió mientras cobrabas (otra ronda o pago).'} Actualizá la mesa y volvé a intentarlo con el saldo visible.`;
    }
    if (status === 403 || code === 'FORBIDDEN' || code === 'ROLE_REQUIRED' || code === 'SETTLE_REQUIRES_MANAGER') {
      return 'Tu rol no puede liquidar este medio de cobro. Pedí el PIN de un Encargado; la mesa y tu sesión se conservan.';
    }
    if (err?.name === 'TypeError' || err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('Failed to fetch')) {
      return 'Se perdió la conexión con el servidor. Comprobando el resultado del cobro... Presione reintentar para verificar si el pago impactó sin duplicar cobro.';
    }
    return err?.message || 'La acción no se pudo completar; la tarjeta sigue visible para reintentar.';
  };

  // E10: cobro directo por comandos canónicos, sin cadena claim -> settle -> resolve.
  // Clave idempotente determinista por sesión+versión+modo: el reintento con los
  // mismos valores no duplica; cambiar monto/método/propina crea otra intención.
  const runSettlement = async (account: ServiceAccountDTO, mode: SettleMode, authToken?: string): Promise<boolean> => {
    if (account.account.saldoMinor <= 0) {
      setActionError('La cuenta ya no tiene saldo pendiente; actualizando la mesa.');
      await refresh();
      return false;
    }
    const busyKey = `settle:${mode}:${account.tableSessionId}`;
    setActionBusy(busyKey);
    setActionError(null);
    try {
      const paymentMethod = paymentMethodBySession[account.tableSessionId]
        || waiterPaymentForRequested(account.requestedPaymentMethod);
      if (!paymentMethod) {
        setActionError('Elegí el medio de cobro antes de registrar el pago.');
        return false;
      }
      const hasLocalTipDraft = Object.prototype.hasOwnProperty.call(tipBySession, account.tableSessionId);
      const tipInput = hasLocalTipDraft
        ? tipBySession[account.tableSessionId]
        : (Number(account.requestedTipMinor || 0) / 100).toFixed(2);
      const tipMinor = Math.max(0, Math.round(Number(tipInput || 0) * 100));
      const amountMinor = Math.max(0, Math.round(Number(account.account.saldoMinor) || 0));
      const normMethod = String(paymentMethod).toUpperCase();
      const keyId = [mode, account.tableSessionId, account.account.version, normMethod, amountMinor, tipMinor].join(':');
      let idempotencyKey = settlementKeys.current.get(keyId);
      if (!idempotencyKey) {
        idempotencyKey = `service-${mode}-${account.tableSessionId}-${account.account.version}-${normMethod}-${amountMinor}-${tipMinor}`;
        settlementKeys.current.set(keyId, idempotencyKey);
      }
      const responsibleStaffUserId = responsibleBySession[account.tableSessionId]
        || account.responsibleStaffUserId
        || currentUser.id;
      const payload = {
        idempotencyKey,
        expectedAccountVersion: account.account.version,
        method: paymentMethod,
        amountMinor: account.account.saldoMinor,
        tipMinor,
        responsibleStaffUserId
      };
      if (mode === 'close') {
        await StaffApi.settleAndCloseSessionAccount(account.tableSessionId, payload, authToken);
      } else {
        await StaffApi.settleSessionAccount(account.tableSessionId, payload, authToken);
      }
      setTipBySession((prev) => ({ ...prev, [account.tableSessionId]: '' }));
      requestTableContext(account.tableId);
      await refresh();
      return true;
    } catch (err: any) {
      const stale = (err as any)?.code === 'STALE_ACCOUNT_VERSION' || (err as any)?.code === 'VERSION_MISMATCH' || (err as any)?.code === 'ACCOUNT_VERSION_MISMATCH' || (err as any)?.code === 'SETTLE_CONFLICT' || (err as any)?.code === 'CLOSE_CONFLICT';
      if (stale) {
        for (const k of [...settlementKeys.current.keys()]) {
          if (k.startsWith(`${mode}:${account.tableSessionId}:`)) settlementKeys.current.delete(k);
        }
      }
      setActionError(settleFailure(err));
      await refresh();
      return false;
    } finally {
      setActionBusy(null);
    }
  };

  // E12 (S12/S13/H05): permiso específico de cobro en efectivo.
  // Si allowWaitersToCollectCash está activo y el método es efectivo, el mozo puede liquidar directamente.
  // Para métodos digitales/tarjeta o si el permiso está inactivo, se solicita PIN temporal de encargado.
  const handleCollect = async (account: ServiceAccountDTO, mode: SettleMode) => {
    const selectedMethod = paymentMethodBySession[account.tableSessionId] || waiterPaymentForRequested(account.requestedPaymentMethod);
    const isCash = selectedMethod === 'WAITER_CASH';
    const canCollectDirectly = currentUser.role === 'MANAGER' || (allowWaitersToCollectCash && isCash);

    if (!canCollectDirectly) {
      setReauthAccount(account);
      setReauthMode(mode);
      setReauthPin('');
      setActionError(null);
      return;
    }
    await runSettlement(account, mode);
  };

  const handleReauthSubmit = async () => {
    if (!reauthAccount || reauthPin.length < 4 || reauthSubmitting) return;
    setReauthSubmitting(true);
    setActionError(null);
    try {
      const credentials = await StaffApi.loginTemporary({
        restaurantSlug: currentUser.restaurantId,
        pin: reauthPin,
        terminalId: StaffApi.getTerminalId(),
        purpose: 'CASH_COLLECT',
        tableId: reauthAccount.tableId,
        sessionId: reauthAccount.tableSessionId
      });
      if (credentials.staffUser.role !== 'MANAGER' || credentials.staffUser.restaurantId !== currentUser.restaurantId) {
        throw new Error('El PIN no corresponde a un Encargado de este restaurante.');
      }
      const collected = await runSettlement(reauthAccount, reauthMode, credentials.token);
      if (collected) {
        setReauthAccount(null);
        setReauthPin('');
      }
    } catch (err: any) {
      setActionError(err?.message || 'No se pudo reautorizar el cobro. La cuenta permanece sin cambios.');
    } finally {
      setReauthSubmitting(false);
    }
  };

  // E11: confirmación física de limpieza dentro de Servicio.
  // TO_CLEAN -> AVAILABLE vía tap skip_to y prepara la próxima sesión.
  const handleMarkClean = async (tableId: string, tableLabel: string) => {
    const busyKey = `clean:${tableId}`;
    setActionBusy(busyKey);
    setActionError(null);
    try {
      await StaffApi.tapTableState(tableId, {
        action: 'skip_to',
        targetState: 'AVAILABLE',
        expectedCurrentState: 'TO_CLEAN',
        note: 'Mesa lista'
      } as any);
      await refresh();
    } catch (err: any) {
      const status = (err as any)?.statusCode;
      const code = (err as any)?.code as string | undefined;
      const conflict = code === 'STATE_CONFLICT' || code === 'STALE_STATE' || code === 'TABLE_STATE_CONFLICT' || status === 409;
      setActionError(
        conflict
          ? `Otra terminal cambió ${tableLabel} primero (conflicto de estado). Se actualizó el mapa; reintentá sólo si sigue "Por limpiar".`
          : (err?.message || `No se pudo marcar ${tableLabel} como lista; sigue "Por limpiar" y se puede reintentar.`)
      );
      await refresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleCloseTable = async () => {
    if (!selectedTable || !window.confirm(`¿Confirmás que ${selectedTable.label} se retiró? Se cerrará la ocupación y se invalidará el QR operativo.`)) return;
    setActionBusy(`close:${selectedTable.id}`);
    setActionError(null);
    try {
      await StaffApi.closeTableSession(selectedTable.id);
      await refresh();
      setSelectedTableId(null);
    } catch (err: any) {
      setFailure(err);
      await refresh();
    } finally {
      setActionBusy(null);
    }
  };

  const openManualOrder = async () => {
    if (!selectedTable) {
      setActionError('Elegí una mesa antes de cargar un pedido presencial.');
      return;
    }
    setActionError(null);
    try {
      if (!manualMenu) {
        const menu = await StaffApi.getMenu(restaurantId);
        setManualMenu(menu);
      }
      const existingDraft = manualDraftsByTableId[selectedTable.id] || [];
      setManualItems(existingDraft);
      setManualOrderOpen(true);
    } catch (err: any) {
      setFailure(err);
    }
  };

  const addManualItem = (item: any) => {
    const menuItemId = item.id || item.menuItemId;
    if (!menuItemId || !selectedTable) return;
    setManualItems((previous) => {
      const found = previous.find((line) => line.menuItemId === menuItemId);
      const next = found
        ? previous.map((line) => line.menuItemId === menuItemId ? { ...line, quantity: Math.min(50, line.quantity + 1) } : line)
        : [...previous, { menuItemId, name: item.name, price: item.price, quantity: 1 }];
      setManualDraftsByTableId((prev) => ({ ...prev, [selectedTable.id]: next }));
      return next;
    });
  };

  const removeManualItem = (id: string) => {
    if (!selectedTable) return;
    setManualItems((previous) => {
      const next = previous.flatMap((line) =>
        line.menuItemId === id ? (line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []) : [line]
      );
      setManualDraftsByTableId((prev) => ({ ...prev, [selectedTable.id]: next }));
      return next;
    });
  };

  const submitManualOrder = async () => {
    if (!selectedTable || manualItems.length === 0) return;
    setManualSubmitting(true);
    setActionError(null);
    try {
      await StaffApi.addManualOrderByStaff(selectedTable.id, manualItems.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity
      })));
      setManualOrderOpen(false);
      setManualDraftsByTableId((prev) => {
        const next = { ...prev };
        delete next[selectedTable.id];
        return next;
      });
      setManualItems([]);
      await refresh();
    } catch (err: any) {
      setFailure(err);
    } finally {
      setManualSubmitting(false);
    }
  };

  const mapWidth = snapshot?.floorPlan.layout.canvasWidth || 1200;
  const mapHeight = snapshot?.floorPlan.layout.canvasHeight || 800;
  const snapshotAgeSeconds = snapshot ? Math.max(0, Math.floor((now - new Date(snapshot.generatedAt).getTime()) / 1000)) : null;
  const snapshotStale = snapshotAgeSeconds !== null && snapshotAgeSeconds > (snapshot?.staleAfterSeconds || 12);
  const selectedPaymentMethod = selectedAccount
    ? paymentMethodBySession[selectedAccount.tableSessionId]
      || waiterPaymentForRequested(selectedAccount.requestedPaymentMethod)
      || ''
    : '';

  return (
    <section className="space-y-3" aria-labelledby="service-workspace-title">
      {/* Portada Atención (E09): Barra compacta sin duplicar headers y accesible E11 */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          {/* Selector de Sector */}
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 min-h-[48px] text-xs sm:text-sm text-slate-300">
            <span className="text-slate-400 font-bold hidden sm:inline">Sector:</span>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="bg-transparent text-white font-bold text-xs sm:text-sm focus-visible:outline-none cursor-pointer py-1.5"
              aria-label="Filtrar por sector del salón"
            >
              <option value="ALL" className="bg-slate-900 text-white">Todos los sectores</option>
              {availableSectors.filter((s) => s !== 'ALL').map((sector) => (
                <option key={sector} value={sector} className="bg-slate-900 text-white">
                  {sectorLabel(sector)}
                </option>
              ))}
            </select>
          </div>

          {/* Buscador de Mesa rápido (atajo '/' en PC) */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              id="table-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar mesa..."
              aria-label="Buscar mesa por número o nombre (atajo tecla barra /)"
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none w-32 sm:w-44 min-h-[48px] h-[48px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white text-sm font-bold focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none rounded-lg"
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>

          {/* Menú compacto de Filtros avanzados */}
          <div className="relative">
            <button
              ref={filterButtonRef}
              id="service-filter-menu-button"
              type="button"
              onClick={() => setFilterMenuOpen((open) => !open)}
              className={`px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors min-h-[48px] h-[48px] focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
                filter !== 'ALL'
                  ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-100'
                  : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
              }`}
              aria-haspopup="menu"
              aria-expanded={filterMenuOpen}
              aria-controls="service-filter-menu-dropdown"
              aria-label="Filtros avanzados de trabajo"
            >
              <Filter className="w-4 h-4 text-slate-400" />
              <span>{filter === 'ALL' ? 'Filtro' : TASK_FILTER_LABELS[filter]}</span>
              <span className="opacity-60 text-xs">▾</span>
            </button>

            {filterMenuOpen && (
              <div
                id="service-filter-menu-dropdown"
                role="menu"
                aria-labelledby="service-filter-menu-button"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-52 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl space-y-1.5"
              >
                {(Object.keys(TASK_FILTER_LABELS) as TaskFilter[]).map((key) => {
                  const count = key === 'ALL' ? tasks.length : tasks.filter((task) => taskFilterMatches(task, key)).length;
                  return (
                    <button
                      key={key}
                      role="menuitem"
                      type="button"
                      onClick={() => { setFilter(key); setFilterMenuOpen(false); }}
                      className={`w-full min-h-[48px] rounded-xl px-3 py-2.5 text-left text-xs sm:text-sm font-bold flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
                        filter === key ? 'bg-indigo-600 text-white font-black' : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <span>{TASK_FILTER_LABELS[key]}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Métricas compactas y toggle de mapa */}
        <div className="flex items-center gap-2.5 text-xs sm:text-sm">
          <span className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-bold text-slate-300 flex items-center">
            {visibleTasks.length} {visibleTasks.length === 1 ? 'pendiente' : 'pendientes'}
          </span>
          <button
            type="button"
            onClick={() => setShowMap((prev) => !prev)}
            className={`px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center gap-2 min-h-[48px] h-[48px] transition-colors lg:hidden focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none ${
              showMap ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200' : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
            }`}
            title="Alternar plano de mesas"
          >
            <MapPinned className="w-4 h-4 text-cyan-400" />
            <span>{showMap ? 'Ocultar mapa' : 'Mapa'}</span>
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-300 hover:text-white min-h-[48px] min-w-[48px] h-[48px] w-[48px] flex items-center justify-center shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
            aria-label="Actualizar Servicio"
            title="Actualizar ahora"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-100">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            {error} {snapshot ? 'Se conserva el último snapshot.' : ''}
          </span>
          <button type="button" onClick={() => void refresh()} className="font-black underline text-amber-200 hover:text-white">Reintentar</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(350px,0.9fr)] gap-4 items-start">
        {/* Columna Izquierda: Cola de atención (en móvil/tablet vertical se oculta cuando hay mesa abierta para mostrar el detalle de inmediato sin scroll) */}
        <section
          ref={queueRef}
          className={`rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4 space-y-3 ${
            selectedTable ? 'hidden lg:block' : 'block'
          }`}
          aria-labelledby="service-queue-title"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 id="service-queue-title" className="font-black text-white flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-300" /> Cola de atención</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Cada tarjeta conserva su mesa, origen, antigüedad y responsable.</p>
            </div>
            <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-black text-slate-300">{visibleTasks.length} visibles</span>
          </div>

          {loading && !snapshot ? (
            <div className="py-16 text-center text-xs text-slate-400 animate-pulse">Cargando pendientes y cocina…</div>
          ) : visibleTasks.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
              <p className="mt-2 text-sm font-black text-emerald-100">No hay trabajo en este filtro</p>
              <p className="mt-1 text-xs text-slate-400">El mapa sigue disponible como contexto de mesa.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleTasks.map((task) => (
                <ServiceTaskCard
                  key={task.taskKey}
                  task={task}
                  account={accountForTask(task)}
                  currentUser={currentUser}
                  busy={actionBusy === task.taskKey || (task.kind === 'TABLE_CLEANUP' && actionBusy === `clean:${task.targetId}`)}
                  isNew={newlyArrivedTaskIds.has(task.targetId)}
                  onHoverStart={() => setHoveredTaskId(task.taskKey)}
                  onHoverEnd={() => setHoveredTaskId(null)}
                  onFocusStart={() => setFocusedTaskId(task.taskKey)}
                  onFocusEnd={() => setFocusedTaskId(null)}
                  onOpenTable={() => requestTableContext(task.tableId)}
                  onAction={() => void handleTask(task)}
                  onReject={() => void handleRejectTask(task)}
                  onRelease={() => void handleRelease(task)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Columna Derecha en Desktop / Vista Principal en Mobile/Tablet cuando hay mesa abierta */}
        <div className={`space-y-4 ${selectedTable ? 'block' : (showMap ? 'block' : 'hidden lg:block')}`}>
          {selectedTable ? (
            <div ref={tableContextRef} id={`table-context-${selectedTable.id}`} tabIndex={-1} className="focus:outline-none" aria-label={`Contexto de ${selectedTable.label}`}>
              <TableContextPanel
                table={selectedTable}
                tasks={selectedTasks}
                account={selectedAccount}
                currentUser={currentUser}
                actionBusy={actionBusy}
                paymentMethod={selectedPaymentMethod}
                setPaymentMethod={(value) => selectedAccount && setPaymentMethodBySession((previous) => ({ ...previous, [selectedAccount.tableSessionId]: value }))}
                tip={selectedAccount
                  ? Object.prototype.hasOwnProperty.call(tipBySession, selectedAccount.tableSessionId)
                    ? tipBySession[selectedAccount.tableSessionId]
                    : Number(selectedAccount.requestedTipMinor || 0) > 0
                      ? (Number(selectedAccount.requestedTipMinor) / 100).toFixed(2)
                      : ''
                  : ''}
                setTip={(value) => selectedAccount && setTipBySession((prev) => ({ ...prev, [selectedAccount.tableSessionId]: value }))}
                responsibleStaffUserId={selectedAccount ? (responsibleBySession[selectedAccount.tableSessionId] || selectedAccount.responsibleStaffUserId || currentUser.id) : currentUser.id}
                setResponsibleStaffUserId={(value) => selectedAccount && setResponsibleBySession((prev) => ({ ...prev, [selectedAccount.tableSessionId]: value }))}
                hasManualDraft={Boolean(manualDraftsByTableId[selectedTable.id]?.length)}
                onAction={(task) => void handleTask(task)}
                onReject={(task) => void handleRejectTask(task)}
                onSettle={(account, mode) => void handleCollect(account, mode)}
                onMarkClean={(tableId, label) => void handleMarkClean(tableId, label)}
                onAddOrder={() => void openManualOrder()}
                onCloseTable={() => void handleCloseTable()}
                onClose={() => setSelectedTableId(null)}
              />
            </div>
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4 space-y-3" aria-labelledby="service-map-title">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 id="service-map-title" className="font-black text-white flex items-center gap-2"><MapPinned className="w-4 h-4 text-cyan-300" /> Mapa contextual</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Sólo lectura · tocá una mesa para abrir su contexto.</p>
                </div>
                <button type="button" onClick={focusKitchen} className="inline-flex items-center gap-1 rounded-xl border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[10px] font-black text-amber-200 hover:bg-amber-500/20" title="Enfocar cocina dentro de Servicio">
                  <ChefHat className="w-3.5 h-3.5" /> Cocina <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-2">
                <p id="service-map-description" className="sr-only">Mapa de {tables.length} mesas, sólo lectura. Cada mesa es seleccionable para abrir su contexto.</p>
                {tables.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-500">No hay plano configurado.</div>
                ) : (
                  <svg viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="w-full h-[235px] sm:h-[290px]" role="group" aria-labelledby="service-map-title service-map-description">
                    <rect width={mapWidth} height={mapHeight} fill="#020617" rx="24" />
                    {tables.map((table) => {
                      const tableTasks = tasks.filter((task) => task.tableId === table.id);
                      const isSelected = selectedTableId === table.id;
                      const x = table.posX || 0;
                      const y = table.posY || 0;
                      const width = Math.max(45, table.width || 100);
                      const height = Math.max(35, table.height || 70);
                      const fill = table.stateColor || '#64748b';
                      return (
                        <g
                          key={table.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${table.label}: ${STATE_TEXT[table.currentState] || STATE_LABELS[table.currentState as TableFSMState] || table.currentState}${tableTasks.length ? `, ${tableTasks.length} pendientes` : ''}`}
                          onClick={() => setSelectedTableId(table.id)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedTableId(table.id); } }}
                          className="cursor-pointer"
                        >
                          {table.shape === 'ROUND' ? (
                            <circle cx={x + width / 2} cy={y + height / 2} r={Math.min(width, height) / 2} fill={`${fill}45`} stroke={isSelected ? '#f8fafc' : fill} strokeWidth={isSelected ? 7 : 3} />
                          ) : (
                            <rect x={x} y={y} width={width} height={height} rx={table.shape === 'BOOTH' ? 8 : 16} fill={`${fill}45`} stroke={isSelected ? '#f8fafc' : fill} strokeWidth={isSelected ? 7 : 3} />
                          )}
                          <text x={x + width / 2} y={y + height / 2 - 4} textAnchor="middle" fill="#f8fafc" fontSize={Math.max(14, Math.min(23, width / 4))} fontWeight="800">{table.label.slice(0, 12)}</text>
                          <text x={x + width / 2} y={y + height / 2 + 18} textAnchor="middle" fill="#cbd5e1" fontSize="13">{table.stateEmoji} {tableTasks.length ? `· ${tableTasks.length}` : ''}</text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-400" role="group" aria-label="Leyenda de estados">
                <span><strong className="text-emerald-300">Disponible</strong> · lista</span>
                <span><strong className="text-amber-300">Ocupada</strong> · atención</span>
                <span><strong className="text-orange-300">Cocina</strong> · preparación</span>
                <span><strong className="text-purple-300">Cuenta</strong> · cobro solicitado</span>
              </div>
            </section>
          )}
        </div>
      </div>

      {Object.entries(recentDeliveries).filter(([, exp]) => exp > now).map(([targetId, expiresAt]) => (
        <div key={targetId} role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-950/30 px-3.5 py-3 text-xs text-emerald-100">
          <span>Entrega registrada. Podés corregirla durante {Math.max(0, Math.ceil((expiresAt - now) / 1000))}s.</span>
          <button
            type="button"
            onClick={() => {
              const task = tasks.find((t) => t.targetId === targetId);
              void handleUndoDelivery(targetId, task?.tableId || selectedTableId || '');
            }}
            disabled={actionBusy === `ORDER_DELIVERY:${targetId}:undo`}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {actionBusy === `ORDER_DELIVERY:${targetId}:undo` ? 'Corrigiendo…' : 'Deshacer entrega'}
          </button>
        </div>
      ))}

      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-3.5 py-3 text-xs text-rose-100">
          <span className="flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-300" />{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-black text-rose-300 hover:text-white" aria-label="Cerrar mensaje">Cerrar</button>
        </div>
      )}

      {manualOrderOpen && selectedTable && (
        <ManualOrderModal
          tableLabel={selectedTable.label}
          menu={manualMenu}
          items={manualItems}
          submitting={manualSubmitting}
          onAdd={addManualItem}
          onRemove={removeManualItem}
          onSubmit={() => void submitManualOrder()}
          onClose={() => setManualOrderOpen(false)}
        />
      )}

      {reauthAccount && (
        <ManagerReauthModal
          tableLabel={reauthAccount.tableLabel}
          pin={reauthPin}
          submitting={reauthSubmitting}
          onPinChange={setReauthPin}
          onSubmit={() => void handleReauthSubmit()}
          onClose={() => { if (!reauthSubmitting) { setReauthAccount(null); setReauthPin(''); } }}
        />
      )}
    </section>
  );
};

const SummaryChip: React.FC<{ label: string; value: number; tone: 'indigo' | 'rose' | 'amber' | 'orange' | 'emerald' }> = ({ label, value, tone }) => {
  const tones = {
    indigo: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-100',
    rose: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    orange: 'border-orange-400/30 bg-orange-500/10 text-orange-100',
    emerald: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
  };
  return <div className={`rounded-xl border px-3 py-2 ${tones[tone]}`}><div className="text-lg font-black leading-none">{value}</div><div className="mt-1 text-[10px] font-bold opacity-80">{label}</div></div>;
};

const ServiceTaskCard: React.FC<{
  task: ServiceTaskDTO;
  account: ServiceAccountDTO | null;
  currentUser: StaffUserDTO;
  busy: boolean;
  isNew?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onFocusStart?: () => void;
  onFocusEnd?: () => void;
  onOpenTable: () => void;
  onAction: () => void;
  onReject: () => void;
  onRelease: () => void;
}> = ({
  task,
  account,
  currentUser,
  busy,
  isNew,
  onHoverStart,
  onHoverEnd,
  onFocusStart,
  onFocusEnd,
  onOpenTable,
  onAction,
  onReject,
  onRelease
}) => {
  const isOtherClaim = Boolean(task.claim && task.claim.staffUserId !== currentUser.id);
  const isOwnClaim = Boolean(task.claim && task.claim.staffUserId === currentUser.id);
  const isBill = task.kind === 'CALL' && task.payload.callType === CallType.BILL;
  const isAccountCollection = task.kind === 'ACCOUNT_COLLECTION';
  const isReview = task.kind === 'ORDER_VALIDATION' && Boolean(task.payload.reviewReason);
  const badge = task.kind === 'ORDER_DELIVERY' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : isBill ? 'border-purple-400/40 bg-purple-500/10 text-purple-200' : task.kind === 'ORDER_PREPARATION' ? 'border-orange-400/40 bg-orange-500/10 text-orange-200' : 'border-amber-400/40 bg-amber-500/10 text-amber-200';
  return (
    <article
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onFocusStart}
      onBlur={onFocusEnd}
      className={`rounded-2xl border p-4 space-y-3.5 transition-all ${
        isNew ? 'ring-2 ring-indigo-500/70 border-indigo-400 bg-indigo-950/40' : ''
      } ${
        isOtherClaim ? 'border-slate-700 bg-slate-950/60 opacity-90' : 'border-slate-700/80 bg-slate-950/70 hover:border-indigo-400/40'
      }`}
      aria-label={`${task.tableLabel}: ${task.title}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpenTable}
          className="min-w-0 text-left group p-1 -m-1 rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-black text-white">{task.tableLabel}</span>
            <span className="text-xs text-slate-400">{sectorLabel(task.sector)}</span>
            {isNew && (
              <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white uppercase tracking-wider animate-pulse">
                Nuevo
              </span>
            )}
          </div>
          <h4 className="mt-2 font-black text-sm sm:text-base text-white group-hover:text-indigo-200">{task.title}</h4>
        </button>
        <div className="shrink-0 text-right">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${badge}`}>{TASK_KIND_LABELS[task.kind]}</span>
          <span className="mt-1 flex items-center justify-end gap-1 text-xs font-mono text-slate-400"><Clock3 className="w-3.5 h-3.5" />{formatAge(task.ageSeconds)}</span>
        </div>
      </div>
      <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5">
        <p className="min-w-0 text-xs sm:text-sm text-slate-300 break-words leading-relaxed">{task.summary}</p>
        <span className="shrink-0 text-xs font-bold text-slate-400">{taskStatusLabel(task)}</span>
      </div>
      {(isBill || isAccountCollection) && (
        <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-purple-100">
          <span className="text-purple-200">Cliente pidió pagar con </span>
          <strong>{requestedPaymentLabel(task.payload.paymentMethod || account?.requestedPaymentMethod)}</strong>
        </div>
      )}
      {(isBill || isAccountCollection) && Number(task.payload.requestedTipMinor ?? account?.requestedTipMinor ?? 0) > 0 && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-emerald-100">
          <span>Propina elegida por el cliente: </span>
          <strong>{formatMinor(Number(task.payload.requestedTipMinor ?? account?.requestedTipMinor ?? 0))}</strong>
          {account && <span className="text-emerald-200"> · total a cobrar {formatMinor(account.account.saldoMinor + Number(task.payload.requestedTipMinor ?? account.requestedTipMinor ?? 0))}</span>}
        </div>
      )}
      {task.kind.startsWith('ORDER_') && task.payload.items && (
        <div className="rounded-xl border border-indigo-400/20 bg-indigo-950/20 p-3.5 space-y-2.5" aria-label="Detalle de la comanda">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wide text-indigo-200">Detalle de la tanda</span>
            <strong className="text-xs sm:text-sm text-white">{formatMinor(task.payload.totalMinor || 0)}</strong>
          </div>
          <ul className="max-h-56 space-y-2 overflow-y-auto" aria-label="Platos de la comanda">
            {task.payload.items.map((item) => (
              <li key={item.itemId} className="border-t border-indigo-400/10 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2 text-xs sm:text-sm">
                  <span className="min-w-0 break-words font-bold text-white">{item.quantity}× {item.name}</span>
                  <span className="shrink-0 text-slate-300 font-mono">{formatMinor(item.lineTotalMinor)}</span>
                </div>
                <p className="mt-0.5 text-xs text-indigo-200">{item.participant.label}</p>
                {item.notes && <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-amber-400/50 pl-2 text-xs text-amber-100">Nota: {item.notes}</p>}
              </li>
            ))}
          </ul>
          {task.payload.allergenNotes && task.payload.allergenNotes.length > 0 && (
            <p role="note" aria-label="Restricción alimentaria como contexto" className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>Contexto: {task.payload.allergenNotes.join(' · ')} — ya contemplado por la carta, no requiere confirmación adicional.</span>
            </p>
          )}
          {task.payload.reviewReason && (
            <p role="alert" aria-label={`Revisión por excepción: ${task.payload.reviewReason.code}`} className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-100">
              <strong>Qué ocurre y por qué hace falta una persona: </strong>
              {task.payload.reviewReason.label}{task.payload.reviewReason.detail ? ` · ${task.payload.reviewReason.detail}` : ''} <span className="opacity-70">[{task.payload.reviewReason.code}]</span>
            </p>
          )}
        </div>
      )}
      {isBill && account && (
        <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-950/20 px-3.5 py-2.5 text-xs sm:text-sm">
          <span className="text-purple-100">Saldo acumulado</span>
          <strong className="text-purple-200">{formatMinor(account.account.saldoMinor)}</strong>
        </div>
      )}
      {task.claim && (
        <div className={`flex items-center justify-between gap-2 text-xs ${isOwnClaim ? 'text-emerald-200' : 'text-slate-400'}`}>
          <span className="flex items-center gap-1.5">
            <UserRound className="w-3.5 h-3.5" />
            {isOwnClaim ? 'Vos te ocupás' : `En atención: ${task.claim.staffName || 'otro operador'}`}
          </span>
          {isOwnClaim && (
            <button type="button" onClick={onRelease} disabled={busy} className="font-black underline hover:text-white min-h-[36px] px-2 flex items-center">
              Reasignar
            </button>
          )}
        </div>
      )}
      <div className={`grid gap-2 ${isReview ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]'}`}>
        <button
          type="button"
          onClick={onAction}
          disabled={busy || isOtherClaim}
          className={`min-h-[48px] rounded-xl px-4 py-3 text-sm sm:text-base font-black transition-colors disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
            isBill ? 'bg-purple-600 text-white hover:bg-purple-500' : 'bg-indigo-600 text-white hover:bg-indigo-500'
          }`}
        >
          {busy ? 'Guardando…' : taskActionLabel(task)} <ChevronRight className="ml-1 inline h-4 w-4" />
        </button>
        {isReview && (
          <button
            type="button"
            onClick={onReject}
            disabled={busy || isOtherClaim}
            className="min-h-[48px] rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs sm:text-sm font-bold text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
          >
            Rechazar
          </button>
        )}
        <button
          type="button"
          onClick={onOpenTable}
          className="min-h-[48px] min-w-[56px] rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs sm:text-sm font-bold text-slate-200 hover:border-indigo-400/50 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
          aria-label={`Abrir contexto de ${task.tableLabel}`}
        >
          Mesa
        </button>
      </div>
    </article>
  );
};

const TableContextPanel: React.FC<{
  table: any;
  tasks: ServiceTaskDTO[];
  account: ServiceAccountDTO | null;
  currentUser: StaffUserDTO;
  actionBusy: string | null;
  paymentMethod: PaymentMethod | '';
  setPaymentMethod: (value: PaymentMethod | '') => void;
  tip: string;
  setTip: (value: string) => void;
  responsibleStaffUserId?: string;
  setResponsibleStaffUserId?: (value: string) => void;
  hasManualDraft?: boolean;
  onAction: (task: ServiceTaskDTO) => void;
  onReject: (task: ServiceTaskDTO) => void;
  onSettle: (account: ServiceAccountDTO, mode: 'keep' | 'close') => void;
  onMarkClean: (tableId: string, label: string) => void;
  onAddOrder: () => void;
  onCloseTable: () => void;
  onClose: () => void;
}> = ({ table, tasks, account, currentUser, actionBusy, paymentMethod, setPaymentMethod, tip, setTip, responsibleStaffUserId, setResponsibleStaffUserId, hasManualDraft, onAction, onReject, onSettle, onMarkClean, onAddOrder, onCloseTable, onClose }) => {
  const [collectOpen, setCollectOpen] = useState(false);
  const [showTipInput, setShowTipInput] = useState(false);
  const balance = account?.account.saldoMinor || 0;
  const enteredTipMinor = Math.max(0, Math.round(Number(tip || 0) * 100));
  const totalToCollect = balance + enteredTipMinor;
  const isToClean = table.currentState === TableFSMState.TO_CLEAN;
  const hasOpenOccupancy = [
    TableFSMState.OCCUPIED_NO_ORDER,
    TableFSMState.ORDER_IN_KITCHEN,
    TableFSMState.EATING,
    TableFSMState.BILL_REQUESTED,
    TableFSMState.PAID
  ].includes(table.currentState as TableFSMState);
  const canClose = hasOpenOccupancy && !isToClean && balance === 0 && tasks.length === 0;
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-cyan-950/15 p-4 space-y-4" aria-labelledby="table-context-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 min-h-[48px] rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-300 hover:text-white lg:hidden focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none transition-colors"
              aria-label="Volver a Atención"
            >
              ← Volver a Atención
            </button>
            <h3 id="table-context-title" className="text-lg font-black text-white">{table.label}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">{sectorLabel(table.sector)} · {STATE_TEXT[table.currentState] || table.currentState} · capacidad ×{table.capacity}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-300 hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none transition-colors"
          aria-label="Cerrar contexto de mesa"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs"><Metric label="Necesidades" value={String(tasks.length)} /><Metric label="Consumo" value={formatMinor(account?.account.consumoMinor || 0)} /><Metric label="Pagado" value={formatMinor(account?.account.paidMinor || 0)} /><Metric label="Saldo" value={formatMinor(balance)} /><Metric label="Total a cobrar" value={formatMinor(totalToCollect)} emphasis /></div>
      {account && <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5 space-y-2.5" aria-labelledby="table-account-detail-title">
        <div className="flex items-center justify-between gap-2"><h4 id="table-account-detail-title" className="text-xs font-black uppercase tracking-wide text-slate-300">Detalle de consumo</h4><span className="text-[10px] text-slate-500">Cuenta por ocupación</span></div>
        {account.account.tandas.length === 0 ? <p className="text-xs sm:text-sm text-slate-500">Todavía no hay tandas aceptadas para cobrar.</p> : <div className="max-h-52 space-y-2 overflow-y-auto">{account.account.tandas.map((round) => <div key={round.orderId} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2.5"><div className="flex items-center justify-between gap-2 text-xs"><span className="font-black text-white">Tanda · {accountRoundStatusLabel(round.status)}</span><strong className="text-emerald-200 font-mono">{formatMinor(round.totalMinor)}</strong></div><p className="mt-1 text-xs leading-relaxed text-slate-300">{round.items.map((item) => `${item.quantity}× ${item.name}`).join(' · ') || 'Sin detalle de platos'}</p></div>)}</div>}
        {account.account.pendingValidation.length > 0 && <p className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">Hay {account.account.pendingValidation.length} tanda(s) por validar; no integran el saldo cobrable.</p>}
        {account.account.draft && <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Hay un borrador sin enviar; no integra el saldo cobrable.</p>}
      </section>}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3.5 items-start">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-300">Pendientes de esta mesa</h4>
            <button
              type="button"
              onClick={onAddOrder}
              className={`inline-flex items-center gap-1.5 min-h-[48px] rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
                hasManualDraft
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20'
              }`}
            >
              <Plus className="w-4 h-4" />
              {hasManualDraft ? 'Agregar pedido (borrador guardado)' : 'Agregar pedido'}
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-xs sm:text-sm text-slate-400">No hay pendientes activos. El contexto de cuenta/historial sigue abajo.</p>
          ) : (
            tasks.map((task) => (
              <div key={task.taskKey} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-black text-indigo-200">{task.title}</span>
                    <p className="text-xs sm:text-sm text-slate-300 mt-0.5 leading-relaxed">{task.summary}</p>
                  </div>
                  <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300 shrink-0">
                    {TASK_KIND_LABELS[task.kind] || task.kind}
                  </span>
                </div>
                {task.kind === 'ORDER_VALIDATION' && task.payload.reviewReason && (
                  <p role="alert" aria-label={`Revisión por excepción: ${task.payload.reviewReason.code}`} className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-100">
                    <strong>Qué ocurre y por qué hace falta una persona: </strong>
                    {task.payload.reviewReason.label}{task.payload.reviewReason.detail ? ` · ${task.payload.reviewReason.detail}` : ''} <span className="opacity-70">[{task.payload.reviewReason.code}]</span>
                  </p>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onAction(task)}
                    disabled={actionBusy === task.taskKey || (task.kind === 'TABLE_CLEANUP' && actionBusy === `clean:${task.targetId}`)}
                    className="min-h-[48px] rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs sm:text-sm font-black text-white disabled:opacity-50 hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none flex items-center justify-center"
                  >
                    {actionBusy === task.taskKey || (task.kind === 'TABLE_CLEANUP' && actionBusy === `clean:${task.targetId}`) ? 'Guardando…' : taskActionLabel(task)}
                  </button>
                  {task.kind === 'ORDER_VALIDATION' && task.payload.reviewReason && (
                    <button
                      type="button"
                      onClick={() => onReject(task)}
                      disabled={Boolean(actionBusy)}
                      className="min-h-[48px] rounded-xl border border-rose-400/40 px-3.5 py-2.5 text-xs sm:text-sm font-black text-rose-100 hover:bg-rose-950/30 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none flex items-center justify-center"
                    >
                      Rechazar
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="min-w-0 rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-3.5 space-y-2.5 md:min-w-[280px]">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-black text-emerald-100">
            <span className="flex items-center gap-1.5"><CircleDollarSign className="w-4 h-4 text-emerald-300" /> Cuenta de la ocupación</span>
            {account && balance > 0 && !isToClean && (
              <button
                type="button"
                onClick={() => setCollectOpen((open) => !open)}
                className="text-xs font-bold text-emerald-300 hover:underline min-h-[36px] px-1 flex items-center"
              >
                {collectOpen ? 'Plegar opciones' : 'Ver opciones'}
              </button>
            )}
          </div>
          {isToClean ? (
            <div className="space-y-2.5">
              <p className="text-xs sm:text-sm text-amber-100"><strong>{table.label} · pagada · falta limpiar.</strong></p>
              <button
                type="button"
                onClick={() => onMarkClean(table.id, table.label)}
                disabled={actionBusy === `clean:${table.id}`}
                className="w-full min-h-[48px] rounded-xl bg-amber-500 px-4 py-3 text-sm sm:text-base font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none transition-colors"
              >
                {actionBusy === `clean:${table.id}` ? 'Guardando…' : 'Mesa lista'}
              </button>
              <p className="text-[11px] text-slate-400 leading-relaxed">Confirma la limpieza física y prepara la próxima sesión; el siguiente QR entra en una cuenta nueva, sin heredar la anterior.</p>
            </div>
          ) : account ? (
            <>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-400">{account.account.tandas.length} tandas · {account.account.pendingValidation.length} por validar</span>
                <strong className="text-emerald-200 font-mono text-sm">{formatMinor(totalToCollect)}</strong>
              </div>
              {account.requestedPaymentMethod && (
                <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-100">
                  <span className="text-purple-200">Cliente pidió pagar con </span><strong>{requestedPaymentLabel(account.requestedPaymentMethod)}</strong>
                </div>
              )}
              {Number(account.requestedTipMinor || 0) > 0 && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  Propina elegida por el cliente: <strong>{formatMinor(Number(account.requestedTipMinor))}</strong> · total a cobrar: <strong>{formatMinor(totalToCollect)}</strong>
                </div>
              )}

              {/* Evitar panel de cobro siempre abierto: botón inicial para abrir subflujo */}
              {!collectOpen ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setCollectOpen(true)}
                    disabled={balance <= 0}
                    className="w-full min-h-[48px] rounded-xl bg-emerald-700 px-4 py-3 text-sm sm:text-base font-black text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none transition-colors"
                  >
                    <Banknote className="w-5 h-5" />
                    {balance <= 0 ? 'Sin saldo pendiente' : `Cobrar cuenta (${formatMinor(totalToCollect)})`}
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5 border-t border-emerald-500/20 pt-2.5">
                  {/* Mozo responsable predeterminado / editable */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Mozo responsable:</span>
                      <span className="font-bold text-indigo-300">
                        {account.responsibleStaffName || currentUser.name}
                        {account.responsibleStaffName ? ' (atendió cuenta)' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <input
                        type="text"
                        value={responsibleStaffUserId || currentUser.id}
                        onChange={(e) => setResponsibleStaffUserId && setResponsibleStaffUserId(e.target.value)}
                        placeholder="ID del mozo"
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
                        title="Identificador del personal responsable del cobro"
                      />
                      {currentUser.id !== (responsibleStaffUserId || account.responsibleStaffUserId) && (
                        <button
                          type="button"
                          onClick={() => setResponsibleStaffUserId && setResponsibleStaffUserId(currentUser.id)}
                          className="shrink-0 rounded-lg bg-indigo-900/60 border border-indigo-700/50 px-2.5 py-1.5 text-xs font-bold text-indigo-200 hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
                        >
                          Asignarme
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod | '')}
                      className="w-full min-h-[48px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs sm:text-sm text-white font-semibold focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
                      aria-label="Medio de cobro"
                    >
                      <option value="">Elegir medio de cobro…</option>
                      <option value="WAITER_CASH">Efectivo</option>
                      <option value="WAITER_CARD_DEBIT">Tarjeta Débito</option>
                      <option value="WAITER_CARD_CREDIT">Tarjeta Crédito</option>
                      <option value="WAITER_MP_QR">QR / Mercado Pago</option>
                      <option value="WAITER_TRANSFER">Transferencia</option>
                      <option value="WAITER_CARD">Tarjeta (sin especificar)</option>
                    </select>
                    {showTipInput || Number(account.requestedTipMinor || 0) > 0 || tip ? (
                      <div className="flex items-center gap-2 pt-0.5">
                        <label className="text-xs text-slate-400 font-bold shrink-0">Propina $</label>
                        <input
                          value={tip}
                          onChange={(event) => setTip(event.target.value)}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="min-w-0 flex-1 min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white font-semibold focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none font-mono"
                          aria-label="Propina en pesos"
                        />
                        {Number(account.requestedTipMinor || 0) <= 0 && !tip && (
                          <button
                            type="button"
                            onClick={() => setShowTipInput(false)}
                            className="text-xs text-slate-400 hover:text-white px-2 py-1 shrink-0"
                          >
                            Plegar
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex justify-end pt-0.5">
                        <button
                          type="button"
                          onClick={() => setShowTipInput(true)}
                          className="text-xs font-semibold text-emerald-300 hover:underline min-h-[32px] px-1 flex items-center"
                        >
                          + Agregar propina voluntaria
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSettle(account, 'keep')}
                    disabled={Boolean(actionBusy) || balance <= 0 || !paymentMethod}
                    className="w-full min-h-[48px] rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-xs sm:text-sm font-black text-emerald-100 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none transition-colors"
                  >
                    <Banknote className="w-4 h-4" />
                    Registrar pago y mantener mesa
                  </button>
                  <button
                    type="button"
                    onClick={() => onSettle(account, 'close')}
                    disabled={Boolean(actionBusy) || balance <= 0 || !paymentMethod}
                    className="w-full min-h-[48px] rounded-xl bg-emerald-700 px-4 py-3 text-xs sm:text-sm font-black text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none transition-colors"
                  >
                    Cobrar y cerrar
                  </button>
                  <p className="text-[11px] text-slate-400 leading-relaxed">Registrar pago mantiene la mesa para otra ronda. Cobrar y cerrar liquida el total y deja la mesa Por limpiar. {currentUser.role !== 'MANAGER' ? 'Ambas exigen PIN puntual de Encargado; tu sesión se conserva.' : ''}</p>
                  <button
                    type="button"
                    onClick={() => setCollectOpen(false)}
                    className="w-full min-h-[44px] text-center text-xs sm:text-sm font-bold text-slate-400 hover:text-white py-2 flex items-center justify-center"
                  >
                    Plegar opciones de cobro
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs sm:text-sm text-slate-400">Todavía no hay una cuenta con tandas aceptadas.</p>
          )}
        </div>
      </div>
      <div className="border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">Liberar mesa no cobra: exige saldo cero y ninguna necesidad activa. Para cobrar el total usá "Cobrar y cerrar".</span>
          <button
            type="button"
            onClick={onCloseTable}
            disabled={!canClose || Boolean(actionBusy)}
            className="inline-flex items-center gap-1.5 min-h-[48px] rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs sm:text-sm font-black text-slate-300 hover:border-rose-400/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none transition-colors shrink-0"
          >
            <LockKeyhole className="w-4 h-4" /> Liberar mesa
          </button>
        </div>
      </div>
    </section>
  );
};

const Metric: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
    <div className="text-[10px] text-slate-400">{label}</div>
    <div className={`mt-1 font-black ${emphasis ? 'text-emerald-200' : 'text-white'}`}>{value}</div>
  </div>
);

const ManagerReauthModal: React.FC<{
  tableLabel: string;
  pin: string;
  submitting: boolean;
  onPinChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}> = ({ tableLabel, pin, submitting, onPinChange, onSubmit, onClose }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="service-manager-reauth-title">
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="w-full max-w-sm rounded-3xl border border-emerald-400/30 bg-slate-900 p-6 shadow-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="service-manager-reauth-title" className="font-black text-white text-base">Autorizar cobro · {tableLabel}</h3>
          <p className="mt-1 text-xs text-slate-400">Ingresá el PIN de un Encargado sólo para esta operación. El operador actual no se reemplaza.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="min-h-[48px] min-w-[48px] rounded-xl bg-slate-800 p-3 text-slate-300 hover:text-white disabled:opacity-50 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
          aria-label="Cerrar reautorización"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <label className="block text-xs sm:text-sm font-bold text-slate-300" htmlFor="service-manager-pin">PIN de Encargado</label>
      <input
        id="service-manager-pin"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        type="password"
        maxLength={32}
        value={pin}
        onChange={(event) => onPinChange(event.target.value.replace(/\D/g, ''))}
        className="w-full min-h-[56px] rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-center text-2xl font-black tracking-[0.45em] text-white focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
        aria-describedby="service-manager-pin-help"
      />
      <p id="service-manager-pin-help" className="text-xs text-slate-500">La API vuelve a validar rol y restaurante; el PIN no queda guardado en el terminal.</p>
      <div className="flex gap-2.5 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 min-h-[48px] rounded-xl bg-slate-800 px-4 py-3 text-xs sm:text-sm font-black text-slate-300 disabled:opacity-50 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pin.length < 4 || submitting}
          className="flex-1 min-h-[48px] rounded-xl bg-emerald-700 px-4 py-3 text-xs sm:text-sm font-black text-white hover:bg-emerald-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
        >
          {submitting ? 'Validando…' : 'Autorizar y cobrar'}
        </button>
      </div>
    </form>
  </div>
);

const ManualOrderModal: React.FC<{
  tableLabel: string;
  menu: any;
  items: Array<{ menuItemId: string; name: string; price: number; quantity: number }>;
  submitting: boolean;
  onAdd: (item: any) => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}> = ({ tableLabel, menu, items, submitting, onAdd, onRemove, onSubmit, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="manual-service-order-title">
    <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 id="manual-service-order-title" className="font-black text-white text-base sm:text-lg">Agregar pedido · {tableLabel}</h3>
          <p className="text-xs text-slate-400">Entra al mismo circuito de cocina y cuenta que un pedido QR.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[48px] min-w-[48px] rounded-xl bg-slate-800 p-3 text-slate-300 hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
          aria-label="Cerrar pedido presencial"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 space-y-3.5 overflow-y-auto py-3.5">
        {(menu?.categories || []).map((category: any) => (
          <div key={category.id || category.name} className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wide text-amber-300">{category.name}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(category.items || []).filter((item: any) => item.isAvailable !== false).map((item: any) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAdd(item)}
                  className="min-h-[48px] flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-left hover:border-amber-400/50 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none transition-colors"
                >
                  <span className="min-w-0 truncate text-xs sm:text-sm font-bold text-white">
                    {item.name}
                    <span className="ml-2 font-mono text-xs text-slate-400">{formatMinor(Math.round(item.price * 100))}</span>
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-amber-300" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {items.length > 0 && (
        <div className="max-h-36 space-y-1.5 overflow-y-auto border-y border-slate-800 py-2.5">
          {items.map((item) => (
            <div key={item.menuItemId} className="flex items-center justify-between gap-2 text-xs sm:text-sm py-1">
              <span className="min-w-0 truncate font-bold text-white">{item.quantity}× {item.name}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onRemove(item.menuItemId)}
                  className="min-h-[48px] min-w-[48px] rounded-xl border border-rose-400/30 px-3 py-2 text-xl font-bold leading-none text-rose-300 hover:bg-rose-950/40 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                  aria-label={`Restar ${item.name}`}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => onAdd(item)}
                  disabled={item.quantity >= 50 || submitting}
                  className="min-h-[48px] min-w-[48px] rounded-xl border border-emerald-400/30 px-3 py-2 text-xl font-bold leading-none text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                  aria-label={`Sumar ${item.name}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2.5 pt-3.5">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 min-h-[48px] rounded-xl bg-slate-800 px-4 py-3 text-xs sm:text-sm font-black text-slate-300 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={items.length === 0 || submitting}
          className="flex-1 min-h-[48px] rounded-xl bg-amber-500 px-4 py-3 text-xs sm:text-sm font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
        >
          {submitting ? 'Enviando…' : <><Send className="mr-1.5 inline h-4 w-4" /> Enviar a cocina</>}
        </button>
      </div>
    </div>
  </div>
);
