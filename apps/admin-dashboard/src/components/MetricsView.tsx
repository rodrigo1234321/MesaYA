import React, { useEffect, useState } from 'react';
import { MetricsDTO, CALL_TYPE_LABELS, PAYMENT_METHOD_LABELS, CallType, PaymentMethod } from '@mesaya/shared';
import { AdminApi } from '../lib/api';
import { Clock, TrendingUp, Star, Users, CreditCard, Bell } from 'lucide-react';

interface MetricsViewProps {
  restaurantId: string;
}

export const MetricsView: React.FC<MetricsViewProps> = ({ restaurantId }) => {
  const [metrics, setMetrics] = useState<MetricsDTO | null>(null);

  useEffect(() => {
    AdminApi.getMetrics(restaurantId)
      .then(setMetrics)
      .catch(console.error);
  }, [restaurantId]);

  if (!metrics) {
    return <div className="p-8 text-center text-xs text-slate-400">Cargando métricas de rendimiento...</div>;
  }

  const avgMinutes = Math.floor(metrics.avgResponseTimeSeconds / 60);
  const avgSeconds = metrics.avgResponseTimeSeconds % 60;
  const timeFormatted = `${avgMinutes}m ${avgSeconds}s`;

  return (
    <div className="space-y-4">
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
    </div>
  );
};
