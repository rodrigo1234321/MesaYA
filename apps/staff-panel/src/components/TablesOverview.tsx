import React, { useCallback, useEffect, useState } from 'react';
import {
  FloorPlanResponseDTO,
  FloorTableDTO,
  getNextState,
  NEXT_STATE_BUTTON_LABELS,
  SECTOR_LABELS,
  STATE_COLORS,
  STATE_LABELS,
  Sector,
  TableFSMState
} from '@mesaya/shared';
import { RefreshCw, TableProperties } from 'lucide-react';
import { StaffApi } from '../lib/api';

interface TablesOverviewProps {
  restaurantId: string;
}

const stateLabel = (state: TableFSMState | string) =>
  STATE_LABELS[state as TableFSMState] || 'Estado desconocido';

const stateColor = (table: FloorTableDTO) => table.stateColor || '#64748b';

const sectorLabel = (sector: string) => SECTOR_LABELS[sector as Sector] || sector;

/**
 * Snapshot compacto del salón para el terminal compartido.
 * Permanece visible aunque el mozo esté en Cocina, Caja o Fila, de modo que
 * la decisión operativa siempre conserva el contexto de las mesas.
 */
export const TablesOverview: React.FC<TablesOverviewProps> = ({ restaurantId }) => {
  const [tables, setTables] = useState<FloorTableDTO[]>([]);
  const [stats, setStats] = useState<FloorPlanResponseDTO['stats'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancingTableId, setAdvancingTableId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadTables = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await StaffApi.getFloorPlan(restaurantId);
      if (signal?.aborted) return;
      setTables(data.tables || []);
      setStats(data.stats || null);
      setError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return;
      setError(err.message || 'No se pudo actualizar el estado de las mesas');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [restaurantId]);

  const advanceTable = async (table: FloorTableDTO) => {
    const currentState = table.currentState as TableFSMState;
    setAdvancingTableId(table.id);
    setActionError(null);
    try {
      await StaffApi.tapTableState(table.id, {
        action: 'next',
        expectedCurrentState: currentState
      });
      await loadTables();
    } catch (err: any) {
      setActionError(err?.message || `No se pudo avanzar ${table.label}`);
      // A concurrent mozo may have moved the table. Refresh so the next action
      // always uses the current optimistic-lock state from the server.
      await loadTables();
    } finally {
      setAdvancingTableId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      controller = new AbortController();
      await loadTables(controller.signal);
      controller = null;
      schedule(typeof document !== 'undefined' && document.hidden ? 10000 : 5000);
    };

    const refreshNow = () => {
      if (timer) clearTimeout(timer);
      tick();
    };

    tick();
    window.addEventListener('online', refreshNow);
    document.addEventListener('visibilitychange', refreshNow);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', refreshNow);
      document.removeEventListener('visibilitychange', refreshNow);
    };
  }, [loadTables]);

  const sortedTables = [...tables].sort((a, b) =>
    a.label.localeCompare(b.label, 'es', { numeric: true, sensitivity: 'base' })
  );

  return (
    <section
      aria-labelledby="staff-tables-overview-title"
      className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 sm:p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 flex items-center justify-center shrink-0">
            <TableProperties className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 id="staff-tables-overview-title" className="text-sm font-extrabold text-white">
              Mesas en vivo
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Estado del salón visible mientras atendés cualquier módulo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stats && (
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold" aria-label="Resumen de mesas">
              <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">{stats.availableCount} libres</span>
              <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/25">{stats.occupiedCount} ocupadas</span>
              {stats.billRequestedCount > 0 && (
                <span className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/25">{stats.billRequestedCount} cuentas</span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => loadTables()}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            aria-label="Actualizar estado de mesas"
            title="Actualizar estado de mesas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && tables.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
          No se pudo actualizar el salón. Los llamados siguen disponibles; reintentá cuando vuelva la conexión.
        </div>
      ) : loading && tables.length === 0 ? (
        <div className="py-5 text-center text-[11px] text-slate-400 animate-pulse">
          Cargando estado de mesas…
        </div>
      ) : sortedTables.length === 0 ? (
        <div className="py-5 text-center text-[11px] text-slate-500">
          Este local todavía no tiene mesas configuradas.
        </div>
      ) : (
        <>
          {actionError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-200 flex items-center justify-between gap-2"
            >
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="shrink-0 text-rose-300 hover:text-white font-bold"
                aria-label="Cerrar error de mesa"
              >
                Cerrar
              </button>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 max-h-52 overflow-y-auto pr-1">
            {sortedTables.map((table) => {
              const color = stateColor(table);
              const hasCall = Boolean(table.activeCall);
              const currentState = table.currentState as TableFSMState;
              const nextState = getNextState(currentState);
              const nextLabel = NEXT_STATE_BUTTON_LABELS[currentState] || 'Avanzar estado';
              const isAdvancing = advancingTableId === table.id;
              return (
                <article
                  key={table.id}
                  className="min-w-0 rounded-xl bg-slate-950/70 border p-2.5 space-y-1.5"
                  style={{ borderColor: `${color}80` }}
                  aria-label={`${table.label}: ${stateLabel(table.currentState)}${hasCall ? ', llamado pendiente' : ''}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-extrabold text-xs text-white truncate">{table.label}</span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="text-[10px] leading-tight text-slate-300 truncate" title={stateLabel(table.currentState)}>
                    {table.stateEmoji} {stateLabel(table.currentState)}
                  </div>
                  <div className="flex items-center justify-between gap-1 text-[9px] text-slate-500">
                    <span className="truncate" title={sectorLabel(table.sector)}>{sectorLabel(table.sector)}</span>
                    <span className="shrink-0">×{table.capacity}</span>
                  </div>
                  {hasCall && (
                    <span className="block text-[9px] font-black text-rose-300 truncate">🔔 Llamado</span>
                  )}
                  <button
                    type="button"
                    onClick={() => advanceTable(table)}
                    disabled={Boolean(advancingTableId)}
                    className="w-full mt-1 rounded-lg px-2 py-1.5 text-[10px] font-black text-slate-950 transition-colors disabled:opacity-50 disabled:cursor-wait"
                    style={{ backgroundColor: isAdvancing ? '#64748b' : (STATE_COLORS[nextState]?.hex || color) }}
                    title={`Avanzar de ${stateLabel(currentState)} a ${stateLabel(nextState)}`}
                    aria-label={`${table.label}: ${nextLabel}`}
                  >
                    {isAdvancing ? 'Actualizando…' : nextLabel}
                  </button>
                </article>
              );
            })}
          </div>
          {sortedTables.length > 12 && (
            <p className="text-[10px] text-slate-500 text-center">
              Deslizá dentro del listado para ver todas las mesas.
            </p>
          )}
        </>
      )}
    </section>
  );
};
