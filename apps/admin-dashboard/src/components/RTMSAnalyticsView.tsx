import React, { useEffect, useState } from 'react';
import { AdminApi } from '../lib/api';
import {
  RTMSAnalyticsSummaryDTO,
  PhaseMetricsDTO,
  HeatmapHourCellDTO,
  TablePerformanceDTO
} from '@mesaya/shared';
import {
  TrendingUp,
  Clock,
  Users,
  DollarSign,
  Flame,
  Calendar,
  Layers,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Loader2,
  HelpCircle
} from 'lucide-react';

interface RTMSAnalyticsViewProps {
  restaurantSlug: string;
}

export const RTMSAnalyticsView: React.FC<RTMSAnalyticsViewProps> = ({ restaurantSlug }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RTMSAnalyticsSummaryDTO | null>(null);
  const [phases, setPhases] = useState<PhaseMetricsDTO | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapHourCellDTO[]>([]);
  const [tablePerf, setTablePerf] = useState<TablePerformanceDTO[]>([]);
  const [selectedRange, setSelectedRange] = useState<'today' | '7d' | '30d'>('7d');
  const [hoveredCell, setHoveredCell] = useState<HeatmapHourCellDTO | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const now = new Date();
      let from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (selectedRange === 'today') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (selectedRange === '30d') {
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const [sumRes, phaseRes, heatRes, perfRes] = await Promise.all([
        AdminApi.getRTMSAnalyticsSummary(restaurantSlug, from.toISOString(), now.toISOString()),
        AdminApi.getRTMSPhaseMetrics(restaurantSlug, from.toISOString(), now.toISOString()),
        AdminApi.getRTMSHeatmap(restaurantSlug, from.toISOString(), now.toISOString()),
        AdminApi.getRTMSTablePerformance(restaurantSlug, from.toISOString(), now.toISOString())
      ]);

      setSummary(sumRes);
      setPhases(phaseRes);
      setHeatmap(heatRes);
      setTablePerf(perfRes);
    } catch (err: any) {
      console.error('Error cargando analytics RTMS:', err);
      setLoadError(err?.message || 'No se pudieron cargar las métricas RTMS del local.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [restaurantSlug, selectedRange]);

  if (loading && !summary) {
    return (
      <div role="status" className="flex flex-col items-center justify-center p-16 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-3" />
        <p className="text-sm font-medium">Calculando métricas de RevPASH y rotación...</p>
      </div>
    );
  }

  const daysLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Color mapper for heatmap cells
  const getCellColor = (pct: number) => {
    if (pct === 0) return 'bg-slate-900 border border-slate-800/60';
    if (pct < 25) return 'bg-emerald-950/60 border border-emerald-900/60 text-emerald-400';
    if (pct < 50) return 'bg-emerald-700/70 border border-emerald-600 text-white';
    if (pct < 75) return 'bg-amber-600/80 border border-amber-500 text-white font-bold';
    return 'bg-rose-600 border border-rose-500 text-white font-extrabold';
  };

  return (
    <div className="space-y-6">
      {/* Header with Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            <span>RTMS Analytics & RevPASH</span>
          </h2>
          <p className="text-xs text-slate-400">
            Métricas de rotación, dwell time por fases y rendimiento por asiento
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800" role="group" aria-label="Rango de fechas de RTMS">
            <button
              type="button"
              aria-pressed={selectedRange === 'today'}
              onClick={() => setSelectedRange('today')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedRange === 'today'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Hoy
            </button>
            <button
              type="button"
              aria-pressed={selectedRange === '7d'}
              onClick={() => setSelectedRange('7d')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedRange === '7d'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              7 Días
            </button>
            <button
              type="button"
              aria-pressed={selectedRange === '30d'}
              onClick={() => setSelectedRange('30d')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedRange === '30d'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              30 Días
            </button>
          </div>

          <button
            type="button"
            onClick={fetchData}
            title="Refrescar métricas"
            aria-label="Refrescar métricas RTMS"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-xs flex items-center justify-between gap-2">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={fetchData}
            className="text-[11px] underline font-semibold hover:text-rose-200"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Top Key Metrics Cards (RevPASH, Turn Time, Occupancy, Revenue) */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: RevPASH */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">RevPASH</span>
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-amber-400">
                ${summary.revPASH.toLocaleString('es-AR')}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Ingreso por asiento disponible / hora
              </span>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
              <span>{summary.totalSeats} asientos totales</span>
              <span>{summary.period.operatingHours}h operativas</span>
            </div>
          </div>

          {/* Card 2: Turn Time Promedio */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Rotación Promedio</span>
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-400">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-sky-400">
                {summary.averageTurnTimeMinutes} min
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Tiempo de ciclo completo por mesa
              </span>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Comensal: ~{summary.averageDurationMinutes} min</span>
              <span>Rotación: ~{summary.averageTurnTimeMinutes - summary.averageDurationMinutes} min</span>
            </div>
          </div>

          {/* Card 3: Tasa de Ocupación */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Tasa de Ocupación</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-emerald-400">
                {summary.occupancyRatePercentage}%
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Utilización real de capacidad
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${summary.occupancyRatePercentage}%` }}
              />
            </div>
          </div>

          {/* Card 4: Facturación Total */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Facturación Período</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                <Flame className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-white">
                ${summary.totalRevenue.toLocaleString('es-AR')}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                {summary.totalSessions} mesas atendidas ({summary.turnsPerTableAverage}x por mesa)
              </span>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
              <span>{summary.totalSessions} sesiones</span>
              <span>Ticket prom: ~${Math.round(summary.totalRevenue / Math.max(1, summary.totalSessions)).toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Embudo de Fases Gastronómicas (Dwell Times Funnel) */}
      {phases && (
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <span>Embudo de Fases de la Experiencia Gastronómica</span>
              </h3>
              <p className="text-xs text-slate-400">
                Tiempos promedio de permanencia en cada etapa del servicio
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {/* Step 1 */}
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-center">
              <span className="text-xs font-medium text-emerald-400">1. Llegada & Comanda</span>
              <p className="text-xl font-bold text-white mt-1">{phases.timeToOrderAvgMinutes} min</p>
              <span className="text-[10px] text-slate-400 block mt-0.5">Desde que se sienta</span>
            </div>

            {/* Step 2 */}
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-center">
              <span className="text-xs font-medium text-amber-400">2. Cocina & Despacho</span>
              <p className="text-xl font-bold text-white mt-1">{phases.kitchenPrepAvgMinutes} min</p>
              <span className="text-[10px] text-slate-400 block mt-0.5">Preparación de comanda</span>
            </div>

            {/* Step 3 */}
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-center">
              <span className="text-xs font-medium text-orange-400">3. Comida & Disfrute</span>
              <p className="text-xl font-bold text-white mt-1">{phases.eatingDwellAvgMinutes} min</p>
              <span className="text-[10px] text-slate-400 block mt-0.5">Plato servido a cuenta</span>
            </div>

            {/* Step 4 */}
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-center">
              <span className="text-xs font-medium text-purple-400">4. Sobremesa Post-Pago</span>
              <p className="text-xl font-bold text-white mt-1">{phases.paymentToVacateAvgMinutes} min</p>
              <span className="text-[10px] text-slate-400 block mt-0.5">Cuenta a desocupación</span>
            </div>

            {/* Step 5 */}
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-center">
              <span className="text-xs font-medium text-slate-300">5. Limpieza & Rotación</span>
              <p className="text-xl font-bold text-white mt-1">{phases.cleaningTurnaroundAvgMinutes} min</p>
              <span className="text-[10px] text-slate-400 block mt-0.5">Mesa lista para otro grupo</span>
            </div>
          </div>
        </div>
      )}

      {/* Mapa de Calor Horario (7x24 Matrix) */}
      {heatmap.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-400" />
                <span>Mapa de Calor de Ocupación por Día y Hora</span>
              </h3>
              <p className="text-xs text-slate-400">
                Densidad de clientes sentados según franja horaria
              </p>
            </div>

            {/* Heatmap Legend */}
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span>0%</span>
              <div className="flex gap-1">
                <span className="w-3.5 h-3.5 rounded bg-slate-800 border border-slate-700" />
                <span className="w-3.5 h-3.5 rounded bg-emerald-900" />
                <span className="w-3.5 h-3.5 rounded bg-emerald-600" />
                <span className="w-3.5 h-3.5 rounded bg-amber-500" />
                <span className="w-3.5 h-3.5 rounded bg-rose-600" />
              </div>
              <span>100%</span>
            </div>
          </div>

          {/* Grid Container: visual complementaria; los datos están en la tabla accesible siguiente */}
          <div className="overflow-x-auto" aria-hidden="true">
            <div className="min-w-[700px]">
              {/* Hour header */}
              <div className="grid grid-cols-[50px_repeat(24,1fr)] gap-1 mb-1 text-[10px] text-slate-500 font-mono text-center">
                <div />
                {hours.map((h) => (
                  <div key={h}>{h}h</div>
                ))}
              </div>

              {/* Days rows */}
              {daysLabels.map((dayName, dIdx) => (
                <div
                  key={dayName}
                  className="grid grid-cols-[50px_repeat(24,1fr)] gap-1 mb-1 items-center"
                >
                  <span className="text-xs font-bold text-slate-400 text-right pr-2">
                    {dayName}
                  </span>
                  {hours.map((h) => {
                    const cell = heatmap.find((c) => c.dayOfWeek === dIdx && c.hour === h) || {
                      dayOfWeek: dIdx,
                      dayLabel: dayName,
                      hour: h,
                      occupancyPercentage: 0,
                      sessionsCount: 0,
                      revenue: 0
                    };

                    return (
                      <div
                        key={`${dIdx}-${h}`}
                        onMouseEnter={() => setHoveredCell(cell)}
                        onMouseLeave={() => setHoveredCell(null)}
                        className={`h-6 rounded flex items-center justify-center cursor-pointer transition-all hover:scale-110 hover:z-10 ${getCellColor(
                          cell.occupancyPercentage
                        )}`}
                      >
                        {cell.occupancyPercentage > 30 && (
                          <span className="text-[9px] font-mono leading-none">
                            {cell.occupancyPercentage}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Hovered cell info badge */}
          {hoveredCell && (
            <div role="status" className="mt-3 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs flex items-center justify-between text-slate-300">
              <span className="font-bold text-white">
                {hoveredCell.dayLabel} a las {hoveredCell.hour}:00 hs
              </span>
              <span>Ocupación: <strong className="text-amber-400">{hoveredCell.occupancyPercentage}%</strong></span>
              <span>Mesas activas: <strong>{hoveredCell.sessionsCount}</strong></span>
              <span>Facturado estimado: <strong className="text-emerald-400">${hoveredCell.revenue.toLocaleString('es-AR')}</strong></span>
            </div>
          )}

          {/* Alternativa textual del mapa de calor: no usar sólo color/hover */}
          <details className="mt-3 rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">
              Ver ocupación por día y hora como texto
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-xs text-slate-300">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th scope="col" className="py-2 pr-3">Día</th>
                    <th scope="col" className="py-2 pr-3">Hora</th>
                    <th scope="col" className="py-2 pr-3">Ocupación</th>
                    <th scope="col" className="py-2 pr-3">Mesas activas</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmap
                    .filter((c) => c.occupancyPercentage > 0)
                    .slice(0, 60)
                    .map((c) => (
                      <tr key={`${c.dayOfWeek}-${c.hour}`} className="border-b border-slate-800/60">
                        <td className="py-1.5 pr-3">{c.dayLabel}</td>
                        <td className="py-1.5 pr-3 font-mono">{c.hour}:00</td>
                        <td className="py-1.5 pr-3 font-mono">{c.occupancyPercentage}%</td>
                        <td className="py-1.5 pr-3 font-mono">{c.sessionsCount}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {heatmap.filter((c) => c.occupancyPercentage > 0).length === 0 && (
                <p className="py-2 text-[11px] text-slate-500">Sin ocupación registrada en el rango seleccionado.</p>
              )}
            </div>
          </details>
        </div>
      )}

      {/* Tabla de Rendimiento por Mesa */}
      {tablePerf.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-white">Rendimiento Comparativo Mesa por Mesa</h3>
            <p className="text-xs text-slate-400">
              Rotación, utilización y RevPASH individual de cada ubicación del salón
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th scope="col" className="py-2.5 px-3">Mesa</th>
                  <th scope="col" className="py-2.5 px-3">Zona</th>
                  <th scope="col" className="py-2.5 px-3">Capacidad</th>
                  <th scope="col" className="py-2.5 px-3">Turnos Atendidos</th>
                  <th scope="col" className="py-2.5 px-3">Rotación Promedio</th>
                  <th scope="col" className="py-2.5 px-3">RevPASH</th>
                  <th scope="col" className="py-2.5 px-3">Utilización</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Facturación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {tablePerf.map((t) => (
                  <tr key={t.tableId} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-white">{t.label}</td>
                    <td className="py-2.5 px-3 text-slate-300">{t.zoneName || 'Principal'}</td>
                    <td className="py-2.5 px-3 text-slate-300">{t.capacity} pax</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 font-mono text-slate-200">
                        {t.totalTurns}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      {t.averageTurnTimeMinutes > 0 ? `${t.averageTurnTimeMinutes} min` : '-'}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-amber-400">
                      ${t.revPASH.toLocaleString('es-AR')}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${t.utilizationPercentage}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-400 text-[11px]">
                          {t.utilizationPercentage}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                      ${t.totalRevenue.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
