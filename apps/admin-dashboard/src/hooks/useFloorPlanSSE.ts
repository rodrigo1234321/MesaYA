import { useEffect, useRef } from 'react';
import { PollingCoordinator, type FloorPlanResponseDTO } from '@mesaya/shared';
import { useFloorPlanStore } from '../stores/useFloorPlanStore';
import { AdminApi } from '../lib/api';

/**
 * Hook de sincronización en vivo para el plano de mesas del Dashboard Gerencial.
 * Etapa 18: Wrapper delgado sobre PollingCoordinator que delega todo el scheduling,
 * secuenciación, abort y backoff al coordinador puro compartido.
 */
export function useFloorPlanSSE(restaurantSlug: string, refreshKey = 0) {
  const { handleSnapshot, setIsConnected } = useFloorPlanStore();
  const handleSnapshotRef = useRef(handleSnapshot);
  const setIsConnectedRef = useRef(setIsConnected);

  // Sincronizar referencias en cada render
  handleSnapshotRef.current = handleSnapshot;
  setIsConnectedRef.current = setIsConnected;

  // Crear el coordinador una sola vez (estable durante la vida del hook)
  const coordinatorRef = useRef<PollingCoordinator<FloorPlanResponseDTO> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new PollingCoordinator<FloorPlanResponseDTO>({
      fetchFn: (slug, signal) => AdminApi.getFloorPlan(slug, signal),
      onData: () => {},       // se sobrescribe abajo en cada render
      onConnectionChange: () => {},
      intervalMs: 3000,
      maxBackoffMs: 15000,
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      isAuthError: (err: unknown) => {
        const e = err as { statusCode?: number; code?: string } | null;
        return e?.statusCode === 401 || e?.code === 'ADMIN_UNAUTHORIZED';
      }
    });
  }

  // Actualizar callbacks del coordinador en cada render
  const coordinator = coordinatorRef.current;

  coordinator.onData = (data: FloorPlanResponseDTO) => {
    if (data && Array.isArray(data.tables)) {
      handleSnapshotRef.current(data.tables);
    }
  };

  coordinator.onConnectionChange = (conn: boolean) => {
    setIsConnectedRef.current(conn);
  };

  // Ciclo de vida del slug de restaurante, reconexión de red y recuperación de foco
  useEffect(() => {
    if (!restaurantSlug) {
      coordinator.stop();
      setIsConnectedRef.current(false);
      return;
    }

    // Inicia polling inmediato para el nuevo restaurante
    // (start() internamente cancela ciclos previos)
    coordinator.start(restaurantSlug);

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
      setIsConnectedRef.current(false);
    };
  }, [restaurantSlug, coordinator, refreshKey]);
}

/**
 * Nombre canónico alineado con el comportamiento real del hook (PollingCoordinator).
 */
export const useFloorPlanPolling = useFloorPlanSSE;
