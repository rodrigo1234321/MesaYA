import { useEffect, useState, useRef } from 'react';
import { CallEventData, CallStatus, PollingCoordinator } from '@mesaya/shared';
import { playChimeAlert } from '../lib/audio';
import { StaffApi, API_BASE } from '../lib/api';

/**
 * Construye la URL para el endpoint legacy de stream.
 * Regla de seguridad (Etapa 17):
 * - Jamás anexa credenciales (token, bearer, authorization) a query string.
 * - Evita la filtración de JWTs a logs del navegador, proxies intermedios o reintentos de EventSource.
 */
export function buildStaffStreamUrl(restaurantId: string): string {
  const queryParams = new URLSearchParams();
  queryParams.set('restaurantId', restaurantId);
  return `${API_BASE}/stream?${queryParams.toString()}`;
}


export function useSSE(
  restaurantId: string | null,
  onNewCall?: (call: CallEventData) => void,
  enabled: boolean = true
) {
  const [connected, setConnected] = useState<boolean>(false);
  const [calls, setCalls] = useState<CallEventData[]>([]);
  const knownCallsRef = useRef<Map<string, string>>(new Map());
  const onNewCallRef = useRef(onNewCall);

  // Sincronizar callback en cada render
  onNewCallRef.current = onNewCall;

  // Crear el coordinador una sola vez (estable durante la vida del hook)
  const coordinatorRef = useRef<PollingCoordinator<CallEventData[]> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new PollingCoordinator<CallEventData[]>({
      fetchFn: (id, signal) => StaffApi.getActiveCalls(id, signal),
      onData: () => {},       // se sobrescribe abajo en cada render
      onConnectionChange: () => {},
      onAuthError: () => StaffApi.logout(),
      intervalMs: 3000,
      maxBackoffMs: 15000,
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      isAuthError: (err: unknown) => {
        const e = err as any;
        return e?.statusCode === 401 || e?.code === 'STAFF_UNAUTHORIZED';
      }
    });
  }

  // Actualizar callbacks del coordinador en cada render para evitar closures estáticas
  const coordinator = coordinatorRef.current;

  coordinator.onData = (data: CallEventData[]) => {
    if (Array.isArray(data)) {
      // Alerta sonora y notificación: suena una sola vez ante llamadas nuevas
      const hasBrandNew = data.some((call) => {
        return !knownCallsRef.current.has(call.id) && call.status === CallStatus.PENDING;
      });

      if (hasBrandNew) {
        playChimeAlert();
        if (onNewCallRef.current) {
          const firstNew = data.find((c) => !knownCallsRef.current.has(c.id));
          if (firstNew) onNewCallRef.current(firstNew);
        }
      }

      const nextKnown = new Map<string, string>();
      for (const c of data) {
        nextKnown.set(c.id, c.status);
      }
      knownCallsRef.current = nextKnown;
      setCalls(data);
    }
  };

  coordinator.onConnectionChange = (conn: boolean) => {
    setConnected(conn);
  };

  coordinator.onAuthError = () => {
    StaffApi.logout();
  };

  // Manejo del ciclo de vida del restaurante, reconexión y foco
  useEffect(() => {
    if (!restaurantId || !enabled) {
      coordinator.stop();
      knownCallsRef.current.clear();
      setCalls([]);
      setConnected(false);
      return;
    }

    // Al cambiar de restaurante: limpiar deduplicador del previo
    knownCallsRef.current.clear();
    setCalls([]);

    // Inicia polling inmediato para el nuevo restaurante
    // (start() internamente cancela ciclos previos)
    coordinator.start(restaurantId);

    const handleOnline = () => {
      coordinator.triggerNow();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
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
  }, [restaurantId, coordinator, enabled]);

  return { connected, calls, setCalls, refresh: () => coordinator.triggerNow() };
}
