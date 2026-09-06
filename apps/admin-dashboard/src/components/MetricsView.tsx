import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MetricsDTO, CALL_TYPE_LABELS, PAYMENT_METHOD_LABELS, CallType, PaymentMethod } from '@mesaya/shared';
import { AdminApi } from '../lib/api';
import { Clock, TrendingUp, Star, Users, CreditCard, Bell, RefreshCw, AlertCircle } from 'lucide-react';

interface MetricsViewProps {
  restaurantId: string;
}

export const MetricsView: React.FC<MetricsViewProps> = ({ restaurantId }) => {
  const [metrics, setMetrics] = useState<MetricsDTO | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isFetchingRef = useRef(false);

  const loadMetrics = useCallback(async (manual: boolean = false) => {
    if (!restaurantId || isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (manual) setIsRefreshing(true);
    setError(null);

    try {
      const data = await AdminApi.getMetrics(restaurantId);
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Error fetching metrics:', err);
      setError(err?.message || 'Error al actualizar métricas');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isFetchingRef.current = false;
    }
  }, [restaurantId]);

  useEffect(() => {
    loadMetrics(false);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadMetrics(false);
      }
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMetrics(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadMetrics]);

  if (isLoading && !metrics) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
        <span className="text-xs font-medium text-slate-400">Cargando métricas del turno...</span>
      </div>
    );
  }

  const avgMinutes = metrics ? Math.floor(metrics.avgResponseTimeSeconds / 60) : 0;
  const avgSeconds = metrics ? metrics.avgResponseTimeSeconds % 60 : 0;
  const timeFormatted = `${avgMinutes}m ${avgSeconds}s`;

  return (
    <div className="space-y-4">
      {/* Header bar with refresh & last updated */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Actualización automática (10s)</span>
          {lastUpdated && (
            <span className="text-slate-500 text-[11px]">
              • Último: {lastUpdated.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <button
          onClick={() => loadMetrics(true)}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
          title="Actualizar ahora"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Actualizando...' : 'Actualizar'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadMetrics(true)}
            className="text-[11px] underline font-semibold hover:text-rose-200"
          >
            Reintentar
          </button>
        </div>
      )}

      {metrics && (
        <>
      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Tiempo de Respuesta</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-xl font-extrabold text-white">
            {metrics.avgResponseTimeSeconds > 0 ? timeFormatted : '0s (Inmediato)'}
          </p>
          <p className="text-[10px] text-emerald-400 font-semibold">Promedio de atención</p>
        </div>

        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Llamados Hoy</span>
            <Bell className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-xl font-extrabold text-white">{metrics.totalCallsToday}</p>
          <p className="text-[10px] text-slate-400 font-medium">
            {metrics.pendingCallsCount} activos en espera
          </p>
        </div>

        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Satisfacción (NPS)</span>
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          </div>
          <p className="text-xl font-extrabold text-white">{metrics.npsAverage} / 5.0</p>
          <p className="text-[10px] text-amber-400 font-semibold">Calificación comensales</p>
        </div>

        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Ahorro Estimado</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-extrabold text-emerald-400">
            ~{Math.round(metrics.totalCallsToday * 0.6)} viajes
          </p>
          <p className="text-[10px] text-slate-400 font-medium">Viajes muertos evitados</p>
        </div>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Calls by Type */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            Distribución por Tipo de Requerimiento
          </h4>
          <div className="space-y-2 text-xs">
            {Object.entries(metrics.callsByType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="font-semibold text-slate-300">
                  {CALL_TYPE_LABELS[type as CallType] || type}
                </span>
                <span className="font-bold text-white px-2 py-0.5 rounded-full bg-slate-800 text-xs">
                  {String(count)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Methods */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-400" />
            Medios de Pago más Solicitados
          </h4>
          <div className="space-y-2 text-xs">
            {Object.entries(metrics.callsByPaymentMethod)
              .filter(([method]) => method !== 'NOT_APPLICABLE')
              .map(([method, count]) => (
                <div key={method} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="font-semibold text-slate-300">
                    {PAYMENT_METHOD_LABELS[method as PaymentMethod] || method}
                  </span>
                  <span className="font-bold text-white px-2 py-0.5 rounded-full bg-slate-800 text-xs">
                    {String(count)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
