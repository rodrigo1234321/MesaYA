import { useServiceSync } from './useServiceSync';
import { CallEventData } from '@mesaya/shared';
import { API_BASE } from '../lib/api';

/**
 * @deprecated El backend responde 410 GONE en /stream; la arquitectura usa HTTP Polling con PollingCoordinator.
 * Se conserva para compatibilidad de contratos pero no debe usarse en nuevos componentes.
 */
export function buildStaffStreamUrl(restaurantId: string): string {
  const queryParams = new URLSearchParams();
  queryParams.set('restaurantId', restaurantId);
  return `${API_BASE}/stream?${queryParams.toString()}`;
}

/**
 * useSSE — Adaptador legacy que reutiliza el hook centralizado useServiceSync (E08).
 * Garantiza un solo dueño del polling HTTP y cero ciclos concurrentes duplicados.
 */
export function useSSE(
  restaurantId: string | null,
  onNewCall?: (call: CallEventData) => void,
  enabled: boolean = true
) {
  const sync = useServiceSync(restaurantId, enabled, onNewCall);

  return {
    connected: sync.connected,
    calls: sync.calls,
    setCalls: () => {},
    refresh: sync.refresh,
    syncState: sync.syncState,
    lastSuccessTimestamp: sync.lastSuccessTimestamp,
    secondsSinceLastSuccess: sync.secondsSinceLastSuccess,
    snapshot: sync.snapshot,
    unattendedCallsCount: sync.unattendedCallsCount,
    urgentTasksCount: sync.urgentTasksCount
  };
}

/**
 * Nombre canónico alineado con el comportamiento real del hook (PollingCoordinator).
 */
export const useCallsPolling = useSSE;

export * from './useServiceSync';
