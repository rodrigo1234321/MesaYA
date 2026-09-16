import { useEffect, useState, useRef, useCallback } from 'react';
import {
  ServiceWorkspaceDTO,
  CallEventData,
  CallStatus,
  CallType,
  CallOrigin,
  PaymentMethod,
  PollingCoordinator,
  Sector
} from '@mesaya/shared';
import { playChimeAlert } from '../lib/audio';
import { StaffApi } from '../lib/api';

export type SyncConnectionState = 'connecting' | 'connected' | 'stale' | 'disconnected' | 'auth_error';

export interface UseServiceSyncResult {
  connected: boolean;
  syncState: SyncConnectionState;
  lastSuccessTimestamp: number | null;
  lastError: string | null;
  secondsSinceLastSuccess: number | null;
  snapshot: ServiceWorkspaceDTO | null;
  calls: CallEventData[];
  unattendedCallsCount: number;
  urgentTasksCount: number;
  refresh: () => Promise<void>;
}

/**
 * Hook centralizado de sincronización única para el puesto de salón (E08).
 *
 * Principios:
 * 1. Un solo PollingCoordinator activo en toda la aplicación (propiedad del shell).
 * 2. Cero duplicación de peticiones periódicas entre App y ServiceWorkspace.
 * 3. Detección deduplicada de nuevos llamados y tareas urgentes con alerta sonora única.
 * 4. Reconciliación inmediata al recuperar foco o conectividad (online / visibilitychange).
 * 5. Indicador de conectividad real con timestamp del último éxito (S11) sin depender del activeTab.
 */
export function useServiceSync(
  restaurantId: string | null,
  enabled: boolean = true,
  onNewCall?: (call: CallEventData) => void
): UseServiceSyncResult {
  const [connected, setConnected] = useState<boolean>(false);
  const [syncState, setSyncState] = useState<SyncConnectionState>('connecting');
  const [lastSuccessTimestamp, setLastSuccessTimestamp] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [secondsSinceLastSuccess, setSecondsSinceLastSuccess] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ServiceWorkspaceDTO | null>(null);

  const knownTasksRef = useRef<Set<string>>(new Set());
  const onNewCallRef = useRef(onNewCall);
  onNewCallRef.current = onNewCall;

  // Instancia única del coordinador de polling HTTP de @mesaya/shared
  const coordinatorRef = useRef<PollingCoordinator<ServiceWorkspaceDTO> | null>(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = new PollingCoordinator<ServiceWorkspaceDTO>({
      fetchFn: (id: string, signal: AbortSignal) => StaffApi.getServiceWorkspace(id, signal),
      onData: () => {},
      onConnectionChange: () => {},
      onAuthError: () => {},
      intervalMs: 4000,
      maxBackoffMs: 15000,
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      isAuthError: (err: unknown) => {
        const e = err as any;
        return e?.statusCode === 401 || e?.code === 'STAFF_UNAUTHORIZED';
      }
    });
  }

  const coordinator = coordinatorRef.current;

  // Actualizar callbacks del coordinador en cada ciclo
  coordinator.onData = (data: ServiceWorkspaceDTO) => {
    if (data && typeof data === 'object') {
      const now = Date.now();
      setLastSuccessTimestamp(now);
      setLastError(null);
      setSyncState('connected');
      setConnected(true);

      const tasks = Array.isArray(data.tasks) ? data.tasks : [];

      // Detección deduplicada de nuevas tareas urgentes o llamados
      const hasNewUrgent = tasks.some((t) => {
        const isUrgent = t.kind === 'CALL' || t.kind === 'ORDER_DELIVERY' || t.kind === 'ACCOUNT_COLLECTION';
        const isPending = !t.claim;
        return isUrgent && isPending && !knownTasksRef.current.has(t.targetId);
      });

      if (hasNewUrgent) {
        playChimeAlert();
        if (onNewCallRef.current) {
          const firstCallTask = tasks.find((t) => t.kind === 'CALL' && !knownTasksRef.current.has(t.targetId));
          if (firstCallTask) {
            onNewCallRef.current({
              id: firstCallTask.targetId,
              restaurantId: data.restaurantId,
              tableId: firstCallTask.tableId,
              tableLabel: firstCallTask.tableLabel,
              sector: (firstCallTask.sector as Sector) || Sector.SALON_PRINCIPAL,
              type: firstCallTask.summary.toLowerCase().includes('cuenta') ? CallType.BILL : CallType.WAITER,
              paymentMethod: (firstCallTask.payload?.paymentMethod as PaymentMethod) || PaymentMethod.NOT_APPLICABLE,
              origin: CallOrigin.WEB_DIRECT,
              status: firstCallTask.claim ? CallStatus.IN_PROGRESS : CallStatus.PENDING,
              createdAt: firstCallTask.createdAt
            });
          }
        }
      }

      // Actualizar conjunto de tareas conocidas
      const nextKnown = new Set<string>();
      for (const t of tasks) {
        nextKnown.add(t.targetId);
      }
      knownTasksRef.current = nextKnown;

      setSnapshot(data);
    }
  };

  coordinator.onConnectionChange = (conn: boolean) => {
    setConnected(conn);
    if (!conn) {
      setSyncState('disconnected');
    }
  };

  coordinator.onAuthError = () => {
    setConnected(false);
    setSyncState('auth_error');
    setLastError('Sesión o credencial expirada');
    StaffApi.lockOperator();
  };

  // Reloj para cálculo de tiempo transcurrido desde el último éxito
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastSuccessTimestamp) {
        const diffSec = Math.floor((Date.now() - lastSuccessTimestamp) / 1000);
        setSecondsSinceLastSuccess(diffSec);

        // Si pasan más de 12 segundos sin respuesta exitosa en foreground, marcar demorado
        if (diffSec > 12 && syncState === 'connected') {
          setSyncState('stale');
        }
      } else {
        setSecondsSinceLastSuccess(null);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [lastSuccessTimestamp, syncState]);

  // Manejo del ciclo de vida, cambio de restaurante y reconexión
  useEffect(() => {
    if (!restaurantId || !enabled) {
      coordinator.stop();
      knownTasksRef.current.clear();
      setSnapshot(null);
      setConnected(false);
      setSyncState('connecting');
      setLastSuccessTimestamp(null);
      return;
    }

    knownTasksRef.current.clear();
    setSyncState('connecting');

    // Iniciar ciclo en el nuevo restaurante
    coordinator.start(restaurantId);

    // Eventos de reconexión y visibilidad (reconciliación instantánea S11)
    const handleOnline = () => {
      coordinator.triggerNow();
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        coordinator.triggerNow();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      coordinator.stop();
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      setConnected(false);
    };
  }, [restaurantId, enabled, coordinator]);

  const refresh = useCallback(async () => {
    coordinator.triggerNow();
  }, [coordinator]);

  // Derivación de llamados desde el snapshot
  const calls: CallEventData[] = (snapshot?.tasks || [])
    .filter((t) => t.kind === 'CALL')
    .map((t) => ({
      id: t.targetId,
      restaurantId: snapshot!.restaurantId,
      tableId: t.tableId,
      tableLabel: t.tableLabel,
      sector: (t.sector as Sector) || Sector.SALON_PRINCIPAL,
      type: t.summary.toLowerCase().includes('cuenta') ? CallType.BILL : CallType.WAITER,
      paymentMethod: (t.payload?.paymentMethod as PaymentMethod) || PaymentMethod.NOT_APPLICABLE,
      origin: CallOrigin.WEB_DIRECT,
      status: t.claim ? CallStatus.IN_PROGRESS : CallStatus.PENDING,
      createdAt: t.createdAt
    }));

  const unattendedCallsCount = calls.filter((c) => c.status === CallStatus.PENDING).length;

  const urgentTasksCount = (snapshot?.tasks || []).filter(
    (t) => !t.claim && (t.kind === 'CALL' || t.kind === 'ORDER_DELIVERY' || t.kind === 'ACCOUNT_COLLECTION')
  ).length;

  return {
    connected,
    syncState,
    lastSuccessTimestamp,
    lastError,
    secondsSinceLastSuccess,
    snapshot,
    calls,
    unattendedCallsCount,
    urgentTasksCount,
    refresh
  };
}
