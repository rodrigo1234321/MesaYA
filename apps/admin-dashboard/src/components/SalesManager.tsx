import React, { useState, useEffect, useCallback } from 'react';
import {
  SalesSummaryDTO,
  SalesOperationDTO,
  FiscalDocumentDTO,
  ReceiptSnapshotDTO
} from '@mesaya/shared';
import { AdminApi } from '../lib/api';
import {
  DollarSign,
  TrendingUp,
  Receipt,
  FileText,
  Download,
  Calendar,
  Filter,
  RefreshCw,
  AlertCircle,
  Eye,
  CheckCircle2,
  Clock,
  Plus
} from 'lucide-react';

interface SalesManagerProps {
  restaurantId: string;
}

export const SalesManager: React.FC<SalesManagerProps> = ({ restaurantId }) => {
  const [subTab, setSubTab] = useState<'summary' | 'operations' | 'tickets' | 'fiscal'>('summary');
  const [period, setPeriod] = useState<'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM'>('TODAY');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState('');
  const [fiscalFilter, setFiscalFilter] = useState('');
  // E16: turno explícito. Vacío = día calendario según período; con valor, la
  // ventana del turno prevalece (incluye turnos que cruzan medianoche).
  const [shiftFilter, setShiftFilter] = useState('');
  const [currentShift, setCurrentShift] = useState<{ id: string; openedAt: string } | null>(null);

  const [summary, setSummary] = useState<SalesSummaryDTO | null>(null);
  const [operations, setOperations] = useState<SalesOperationDTO[]>([]);
  const [staff, setStaff] = useState<Array<{ id: string; name: string; role?: string }>>([]);
  const [fiscalDocs, setFiscalDocs] = useState<FiscalDocumentDTO[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptSnapshotDTO | null>(null);
  const [showFiscalModal, setShowFiscalModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario nuevo comprobante fiscal
  const [fiscalType, setFiscalType] = useState<'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TICKET_FISCAL' | 'OTRO'>('FACTURA_B');
  const [fiscalPos, setFiscalPos] = useState('1');
  const [fiscalNumber, setFiscalNumber] = useState('');
  const [fiscalDate, setFiscalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fiscalEmitter, setFiscalEmitter] = useState('');
  const [fiscalTotal, setFiscalTotal] = useState('');
  const [fiscalSessionId, setFiscalSessionId] = useState('');
  const [fiscalNotes, setFiscalNotes] = useState('');
  const [fiscalSubmitting, setFiscalSubmitting] = useState(false);

  // Formulario devolución / ajuste de cobro
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [selectedSettlementForAdjustment, setSelectedSettlementForAdjustment] = useState<{
    settlementId: string;
    tableSessionId: string;
    methodLabel: string;
    amountMinor: number;
    tipMinor: number;
  } | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentTip, setAdjustmentTip] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentSubmitting, setAdjustmentSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    try {
      const qOptions: any = { period };
      if (period === 'CUSTOM') {
        if (dateFrom) qOptions.dateFrom = new Date(dateFrom).toISOString();
        if (dateTo) qOptions.dateTo = new Date(dateTo).toISOString();
      }
      if (methodFilter) qOptions.paymentMethod = methodFilter;
      if (responsibleFilter) qOptions.responsibleStaffUserId = responsibleFilter;
      if (fiscalFilter) qOptions.hasFiscalDocument = fiscalFilter === 'true';
      if (shiftFilter) qOptions.shiftId = shiftFilter;

      const [summaryRes, opsRes, docsRes, staffRes, shiftRes] = await Promise.all([
        AdminApi.getSalesSummary(restaurantId, qOptions),
        AdminApi.getSalesOperations(restaurantId, qOptions),
        AdminApi.getFiscalDocuments(restaurantId),
        AdminApi.getStaff(restaurantId),
        AdminApi.getCurrentShift(restaurantId).catch(() => null)
      ]);

      setSummary(summaryRes);
      setOperations(opsRes.operations);
      setFiscalDocs(docsRes.documents);
      setStaff(Array.isArray(staffRes) ? staffRes : []);
      if (shiftRes && (shiftRes as any).id) {
        setCurrentShift({ id: (shiftRes as any).id, openedAt: (shiftRes as any).openedAt });
      } else {
        setCurrentShift(null);
      }
    } catch (err: any) {
      // E16: ante un error no se muestran ceros: se conserva el último dato
      // válido (o nada) y se expone el error con reintento.
      setError(err?.message || 'Error al cargar ventas y cobros');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, period, dateFrom, dateTo, methodFilter, responsibleFilter, fiscalFilter, shiftFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExportCsv = async () => {
    try {
      const blob = await AdminApi.exportSalesCsv(restaurantId, {
        period,
        dateFrom,
        dateTo,
        shiftId: shiftFilter || undefined,
        paymentMethod: methodFilter || undefined,
        responsibleStaffUserId: responsibleFilter || undefined,
        hasFiscalDocument: fiscalFilter ? fiscalFilter === 'true' : undefined
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ventas-${restaurantId}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      alert(err?.message || 'Error al exportar CSV');
    }
  };

  const handleDownloadSummaryPdf = async () => {
    try {
      const blob = await AdminApi.downloadSalesSummaryPdf(restaurantId, {
        period,
        dateFrom,
        dateTo,
        shiftId: shiftFilter || undefined,
        paymentMethod: methodFilter || undefined,
        responsibleStaffUserId: responsibleFilter || undefined,
        hasFiscalDocument: fiscalFilter ? fiscalFilter === 'true' : undefined
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resumen-ventas-${restaurantId}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      alert(err?.message || 'Error al descargar PDF del resumen');
    }
  };

  const handleOpenAdjustmentModal = (s: any, op: any) => {
    setSelectedSettlementForAdjustment({
      settlementId: s.settlementId,
      tableSessionId: op.tableSessionId,
      methodLabel: s.methodLabel,
      amountMinor: s.amountMinor,
      tipMinor: s.tipMinor
    });
    setAdjustmentAmount((s.amountMinor / 100).toFixed(2));
    setAdjustmentTip('0.00');
    setAdjustmentReason('');
    setShowAdjustmentModal(true);
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSettlementForAdjustment) return;
    const amtMinor = Math.round(parseFloat(adjustmentAmount || '0') * 100);
    const tipMinor = Math.round(parseFloat(adjustmentTip || '0') * 100);
    const reason = adjustmentReason.trim();

    if (isNaN(amtMinor) || isNaN(tipMinor) || (amtMinor <= 0 && tipMinor <= 0)) {
      alert('Ingresá un importe mayor a cero para devolver.');
      return;
    }
    if (!reason) {
      alert('Ingresá un motivo para la devolución.');
      return;
    }

    setAdjustmentSubmitting(true);
    try {
      await AdminApi.createPaymentAdjustment(restaurantId, selectedSettlementForAdjustment.settlementId, {
        amountMinor: amtMinor,
        tipMinor: tipMinor,
        reason
      });
      setShowAdjustmentModal(false);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Error al registrar devolución');
    } finally {
      setAdjustmentSubmitting(false);
    }
  };

  const handleViewReceipt = async (receiptId: string) => {
    try {
      const rcpt = await AdminApi.getReceipt(restaurantId, receiptId);
      setSelectedReceipt(rcpt);
      setSubTab('tickets');
    } catch (err: any) {
      alert(err?.message || 'Error al cargar ticket');
    }
  };

  const handleDownloadReceiptPdf = async () => {
    if (!selectedReceipt) return;
    try {
      const blob = await AdminApi.downloadReceiptPdf(restaurantId, selectedReceipt.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedReceipt.receiptNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 30_000);
    } catch (err: any) {
      alert(err?.message || 'Error al descargar comprobante');
    }
  };

  const handleCreateFiscalDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fiscalNumber || !fiscalEmitter || !fiscalTotal) {
      alert('Completá los campos obligatorios');
      return;
    }
    setFiscalSubmitting(true);
    try {
      const totalMinor = Math.round(parseFloat(fiscalTotal) * 100);
      const coveredSessions = fiscalSessionId.trim()
        ? [{ tableSessionId: fiscalSessionId.trim(), coveredMinor: totalMinor }]
        : [];

      await AdminApi.createFiscalAssociation(restaurantId, {
        docType: fiscalType,
        pointOfSale: parseInt(fiscalPos, 10) || 1,
        docNumber: fiscalNumber.trim(),
        docDate: new Date(fiscalDate).toISOString(),
        emitter: fiscalEmitter.trim(),
        totalMinor,
        notes: fiscalNotes.trim() || undefined,
        coveredSessions
      });

      setShowFiscalModal(false);
      setFiscalNumber('');
      setFiscalTotal('');
      setFiscalNotes('');
      setFiscalSessionId('');
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Error al asociar comprobante');
    } finally {
      setFiscalSubmitting(false);
    }
  };

  const formatPesos = (minor: number) => `$${(minor / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white">Ventas y cobros</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Registro automático de cobros, desglose por medios, propinas y comprobantes informativos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadSummaryPdf}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-indigo-950/60 border border-indigo-500/30 hover:border-indigo-400 text-indigo-200 hover:text-white text-xs font-bold transition-all"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Resumen PDF (A4)</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Exportar CSV</span>
          </button>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Period & Filter bar */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sub-tabs */}
          <div role="tablist" aria-label="Vistas de ventas y cobros" className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'summary'}
              onClick={() => setSubTab('summary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'summary' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Resumen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'operations'}
              onClick={() => setSubTab('operations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'operations' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Operaciones ({operations.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'tickets'}
              onClick={() => setSubTab('tickets')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'tickets' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Tickets
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'fiscal'}
              onClick={() => setSubTab('fiscal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'fiscal' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Comprobantes ({fiscalDocs.length})
            </button>
          </div>

          {/* Period selector */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-indigo-400" aria-hidden="true" />
            <label htmlFor="sales-period" className="sr-only">Período</label>
            <select
              id="sales-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="TODAY">Hoy</option>
              <option value="YESTERDAY">Ayer</option>
              <option value="THIS_MONTH">Este mes</option>
              <option value="LAST_MONTH">Mes anterior</option>
              <option value="CUSTOM">Rango personalizado…</option>
            </select>
          </div>
        </div>

        <div role="group" aria-label="Filtros de ventas" className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Filtrar:</span>
          <label htmlFor="sales-shift-filter" className="sr-only">Filtrar por turno</label>
          <select
            id="sales-shift-filter"
            aria-label="Filtrar por turno"
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Día calendario (período)</option>
            {currentShift && (
              <option value={currentShift.id}>
                Turno actual (desde {new Date(currentShift.openedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})
              </option>
            )}
          </select>
          <label htmlFor="sales-method-filter" className="sr-only">Filtrar por medio de pago</label>
          <select
            id="sales-method-filter"
            aria-label="Filtrar por medio de pago"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos los medios</option>
            <option value="WAITER_CASH">Efectivo</option>
            <option value="WAITER_CARD_DEBIT">Tarjeta débito</option>
            <option value="WAITER_CARD_CREDIT">Tarjeta crédito</option>
            <option value="WAITER_MP_QR">QR / Mercado Pago</option>
            <option value="WAITER_TRANSFER">Transferencia</option>
            <option value="WAITER_CARD">Tarjeta histórica sin subtipo</option>
          </select>
          <label htmlFor="sales-responsible-filter" className="sr-only">Filtrar por responsable</label>
          <select
            id="sales-responsible-filter"
            aria-label="Filtrar por responsable"
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos los responsables</option>
            {staff.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
          <label htmlFor="sales-fiscal-filter" className="sr-only">Filtrar por comprobante asociado</label>
          <select
            id="sales-fiscal-filter"
            aria-label="Filtrar por comprobante asociado"
            value={fiscalFilter}
            onChange={(e) => setFiscalFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos los comprobantes</option>
            <option value="false">Sin comprobante asociado</option>
            <option value="true">Con comprobante asociado</option>
          </select>
        </div>

        {period === 'CUSTOM' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/60">
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span>Desde:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white"
              />
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span>Hasta:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SUB-TAB: RESUMEN */}
      {subTab === 'summary' && !summary && (
        <div role="status" className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 text-center text-slate-500 text-xs">
          {loading
            ? 'Cargando resumen de ventas y cobros…'
            : error
              ? `No se pudo cargar el resumen: ${error}`
              : 'Sin datos para el período seleccionado.'}
        </div>
      )}
      {subTab === 'summary' && summary && (
        <div className="space-y-6">
          {/* E16: turno y criterio de conciliación con etiquetas canónicas */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-3 text-xs text-slate-300 space-y-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span><strong className="text-white">Turno:</strong> {summary.shiftLabel || 'Día calendario (período seleccionado)'}</span>
              <span><strong className="text-rose-300">Devolución del período:</strong> <span className="font-mono">{formatPesos(summary.devolucionesMinor || 0)}</span></span>
              <span className="text-slate-500">Rango [desde,hasta): {new Date(summary.dateFrom).toLocaleString('es-AR')} → {new Date(summary.dateTo).toLocaleString('es-AR')} ({summary.timezone})</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Consumo por fecha original de la tanda (nunca se mueve al día de pago) · Cobrado neto y propina por fecha de pago menos devoluciones ·
              Cada devolución computa en su propia fecha: una devolución posterior no reescribe este resumen · Saldo = cuenta completa pendiente.
            </p>
          </div>
          {/* Tarjetas de cabecera */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Consumo confirmado</span>
              <div className="text-xl font-black text-white mt-1">{formatPesos(summary.consumoConfirmadoMinor)}</div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Tandas aceptadas</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Consumo cobrado</span>
              <div className="text-xl font-black text-emerald-400 mt-1">{formatPesos(summary.consumoCobradoMinor)}</div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Neto de consumo</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Propinas cobradas</span>
              <div className="text-xl font-black text-amber-400 mt-1">{formatPesos(summary.propinasCobradasMinor)}</div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Confirmadas</span>
            </div>

            <div className="bg-slate-900/60 border border-emerald-500/30 bg-emerald-950/10 p-4 rounded-2xl">
              <span className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider">Total recibido</span>
              <div className="text-2xl font-black text-emerald-300 mt-1">{formatPesos(summary.totalRecibidoMinor)}</div>
              <span className="text-[10px] text-emerald-400/70 mt-0.5 block">{summary.paymentsCount} pagos ({summary.uniqueSessionsCount} cuentas)</span>
              {(summary.devolucionesMinor || 0) > 0 && (
                <span className="text-[10px] text-rose-300/90 mt-0.5 block">Devolución del período: −{formatPesos(summary.devolucionesMinor || 0)} (neto ya descontado)</span>
              )}
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
              <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider">Pendiente al corte</span>
              <div className="text-xl font-black text-rose-400 mt-1">{formatPesos(summary.pendienteAlCorteMinor)}</div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Ocupaciones activas</span>
            </div>
          </div>

          {/* Tabla Desglose por Medio de Pago */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Desglose por medio de cobro</span>
              </h3>
              <span className="text-xs text-slate-400">Zona: {summary.timezone}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th scope="col" className="py-3 px-4">Medio de pago</th>
                    <th scope="col" className="py-3 px-4 text-right">Cant. Pagos</th>
                    <th scope="col" className="py-3 px-4 text-right">Consumo</th>
                    <th scope="col" className="py-3 px-4 text-right">Propina</th>
                    <th scope="col" className="py-3 px-4 text-right">Devoluciones</th>
                    <th scope="col" className="py-3 px-4 text-right">Total Recibido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {summary.byMethod.map((m) => (
                    <tr key={m.method} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-bold text-white">{m.label}</td>
                      <td className="py-3 px-4 text-right font-mono">{m.paymentsCount}</td>
                      <td className="py-3 px-4 text-right font-mono">{formatPesos(m.consumoMinor)}</td>
                      <td className="py-3 px-4 text-right font-mono text-amber-400">{formatPesos(m.tipMinor)}</td>
                      <td className="py-3 px-4 text-right font-mono text-rose-400">
                        {m.refundMinor > 0 ? `-${formatPesos(m.refundMinor)}` : '$0,00'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">{formatPesos(m.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB: OPERACIONES */}
      {subTab === 'operations' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Receipt className="w-4 h-4 text-indigo-400" />
                <span>Historial de cuentas y ocupaciones</span>
              </h3>
            </div>
            {operations.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                {loading
                  ? 'Cargando operaciones del período…'
                  : error
                    ? `No se pudieron cargar las operaciones: ${error}`
                    : 'No hay operaciones registradas en el período seleccionado.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {operations.map((op) => (
                  <div key={op.tableSessionId} className="p-4 hover:bg-slate-800/20 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 font-bold text-xs">
                          {op.tableLabel}
                        </span>
                        <span className="text-xs text-slate-400">({op.sector})</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          op.status === 'CLOSED' ? 'bg-slate-800 text-slate-300' :
                          op.status === 'SETTLED' ? 'bg-emerald-500/20 text-emerald-300' :
                          'bg-amber-500/20 text-amber-300'
                        }`}>
                          {op.status === 'CLOSED' ? 'Cerrada' : op.status === 'SETTLED' ? 'Cobrada' : 'Saldo pendiente'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-4 text-xs">
                        <span className="text-slate-400">Consumo: <strong className="text-white">{formatPesos(op.consumoTotalMinor)}</strong></span>
                        <span className="text-slate-400">Cobrado neto: <strong className="text-emerald-400">{formatPesos(op.cobradoTotalMinor)}</strong></span>
                        {op.propinaTotalMinor > 0 && (
                          <span className="text-slate-400">Propina: <strong className="text-amber-400">{formatPesos(op.propinaTotalMinor)}</strong></span>
                        )}
                        {op.devolucionTotalMinor > 0 && (
                          <span className="text-slate-400">Devolución: <strong className="text-rose-300">−{formatPesos(op.devolucionTotalMinor)}</strong></span>
                        )}
                        {op.saldoMinor > 0 && (
                          <span className="text-slate-400">Saldo: <strong className="text-rose-400">{formatPesos(op.saldoMinor)}</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Pagos de la cuenta */}
                    {op.settlements.length > 0 && (
                      <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800 text-xs space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pagos confirmados:</span>
                        <div className="flex flex-wrap gap-2">
                          {op.settlements.map((s) => (
                            <div key={s.settlementId} className="inline-flex items-center space-x-1.5 text-slate-300 bg-slate-900 px-2.5 py-1 rounded-md border border-slate-800">
                              <span className="font-bold text-white">{s.methodLabel}</span>
                              <span className="text-emerald-400 font-mono">{formatPesos(s.totalMinor)}</span>
                              {s.tipMinor > 0 && <span className="text-[10px] text-amber-400">(propina {formatPesos(s.tipMinor)})</span>}
                              <span className="text-[10px] text-slate-400 font-medium">· Mozo: {s.responsibleStaffName || 'Salón'}</span>
                              {s.adjustments && s.adjustments.length > 0 && (
                                <span className="text-[10px] text-rose-400 bg-rose-950/40 px-1 py-0.5 rounded border border-rose-800/40">
                                  {s.adjustments.length} dev. (-{formatPesos(s.adjustments.reduce((sum: number, a: any) => sum + a.totalAdjustedMinor, 0))})
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenAdjustmentModal(s, op)}
                                className="ml-1.5 text-[10px] text-rose-400 hover:text-rose-300 hover:underline bg-slate-950 px-1.5 py-0.5 rounded border border-rose-900/50"
                                title="Registrar devolución o ajuste parcial"
                              >
                                Ajustar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Vínculo a tickets emitidos */}
                    {op.receipts.length > 0 && (
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-slate-500">Tickets:</span>
                        {op.receipts.map((r) => (
                          <button
                            key={r.receiptId}
                            type="button"
                            onClick={() => handleViewReceipt(r.receiptId)}
                            className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/40"
                          >
                            <FileText className="w-3 h-3" />
                            <span>{r.receiptNumber}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB: TICKETS */}
      {subTab === 'tickets' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-2">Comprobantes informativos de 80 mm</h3>
            <p className="text-xs text-slate-400">
              Visualizá e imprimí tickets térmicos congelados. Cada comprobante lleva la leyenda canónica no fiscal y conserva precios históricos.
            </p>
          </div>

          {selectedReceipt ? (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 max-w-md mx-auto space-y-4 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-bold text-white">{selectedReceipt.receiptNumber}</span>
                <button
                  type="button"
                  onClick={handleDownloadReceiptPdf}
                  className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[11px] font-bold flex items-center space-x-1"
                >
                  <Download className="w-3 h-3" />
                  <span>Descargar PDF</span>
                </button>
              </div>
              <div className="text-center space-y-1">
                <div className="font-bold text-sm text-white">{selectedReceipt.snapshotData.restaurantName}</div>
                <div className="text-[10px] text-amber-400">{selectedReceipt.snapshotData.legalNotice}</div>
                <div className="text-[10px] text-slate-400">Mesa: {selectedReceipt.snapshotData.tableLabel} ({selectedReceipt.snapshotData.sector})</div>
              </div>
              <div className="border-t border-b border-slate-800 py-2 space-y-1">
                {selectedReceipt.snapshotData.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between text-slate-300">
                    <span>{it.quantity}x {it.name}</span>
                    <span>{formatPesos(it.lineTotalMinor)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-slate-300">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatPesos(selectedReceipt.snapshotData.consumoMinor)}</span>
                </div>
                {selectedReceipt.snapshotData.tipMinor > 0 && (
                  <div className="flex justify-between text-amber-400">
                    <span>Propina:</span>
                    <span>{formatPesos(selectedReceipt.snapshotData.tipMinor)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-white text-sm pt-1 border-t border-slate-800">
                  <span>TOTAL:</span>
                  <span>{formatPesos(selectedReceipt.snapshotData.totalMinor)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 text-center text-slate-500 text-xs">
              Seleccioná un ticket desde la pestaña "Operaciones" para previsualizarlo o descargarlo.
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB: COMPROBANTES FISCALES */}
      {subTab === 'fiscal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Comprobantes fiscales externos (Carga manual)</h3>
              <p className="text-xs text-slate-400">
                Asociá facturas o tickets emitidos externamente para control de cobertura sin simular validación de ARCA.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFiscalModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Asociar comprobante</span>
            </button>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            {fiscalDocs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No hay comprobantes fiscales asociados aún.
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th scope="col" className="py-3 px-4">Tipo & Número</th>
                    <th scope="col" className="py-3 px-4">Fecha</th>
                    <th scope="col" className="py-3 px-4">Emisor</th>
                    <th scope="col" className="py-3 px-4 text-right">Total</th>
                    <th scope="col" className="py-3 px-4 text-right">Cuentas cubiertas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {fiscalDocs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-bold text-white">
                        {doc.docType} {doc.pointOfSale.toString().padStart(4, '0')}-{doc.docNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{new Date(doc.docDate).toLocaleDateString('es-AR')}</td>
                      <td className="py-3 px-4 text-slate-300">{doc.emitter}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">{formatPesos(doc.totalMinor)}</td>
                      <td className="py-3 px-4 text-right text-slate-400 font-mono">{doc.coveredSessions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal Carga Comprobante Fiscal */}
      {showFiscalModal && (
        <div role="dialog" aria-modal="true" aria-label="Asociar comprobante fiscal externo" className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateFiscalDoc} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Asociar comprobante fiscal externo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Tipo</label>
                <select
                  value={fiscalType}
                  onChange={(e) => setFiscalType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                >
                  <option value="FACTURA_B">Factura B</option>
                  <option value="FACTURA_A">Factura A</option>
                  <option value="FACTURA_C">Factura C</option>
                  <option value="TICKET_FISCAL">Ticket Fiscal</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Punto de Venta</label>
                <input
                  type="number"
                  min="1"
                  value={fiscalPos}
                  onChange={(e) => setFiscalPos(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Número</label>
                <input
                  type="text"
                  placeholder="00012345"
                  value={fiscalNumber}
                  onChange={(e) => setFiscalNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Fecha</label>
                <input
                  type="date"
                  value={fiscalDate}
                  onChange={(e) => setFiscalDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Emisor</label>
                <input
                  type="text"
                  placeholder="Razón Social / Fantasía"
                  value={fiscalEmitter}
                  onChange={(e) => setFiscalEmitter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Total ($)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="15000.00"
                  value={fiscalTotal}
                  onChange={(e) => setFiscalTotal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase">ID de Sesión a cubrir (Opcional)</label>
              <input
                type="text"
                placeholder="ID de sesión de mesa"
                value={fiscalSessionId}
                onChange={(e) => setFiscalSessionId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-3">
              <button
                type="button"
                onClick={() => setShowFiscalModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={fiscalSubmitting}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {fiscalSubmitting ? 'Guardando…' : 'Asociar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Devolución / Ajuste de Cobro */}
      {showAdjustmentModal && selectedSettlementForAdjustment && (
        <div role="dialog" aria-modal="true" aria-label="Devolución o ajuste de cobro" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateAdjustment}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Devolución / Ajuste de cobro</h3>
                <p className="text-[11px] text-slate-400">
                  {selectedSettlementForAdjustment.methodLabel} · Disponible: {formatPesos(selectedSettlementForAdjustment.amountMinor)} consumo, {formatPesos(selectedSettlementForAdjustment.tipMinor)} propina
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                aria-label="Cerrar diálogo de devolución"
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs">
              El cobro original se conserva intacto en el libro contable. Este ajuste se registra de forma aditiva e impacta en el total neto del período.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Devolver Consumo ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={(selectedSettlementForAdjustment.amountMinor / 100).toFixed(2)}
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Devolver Propina ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={(selectedSettlementForAdjustment.tipMinor / 100).toFixed(2)}
                  value={adjustmentTip}
                  onChange={(e) => setAdjustmentTip(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase">Motivo de la devolución / ajuste *</label>
              <textarea
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder="Ej: Plato devuelto por cocción / Cobro duplicado por error de POS / Reclamo comensal"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white mt-1 h-20"
                required
              />
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={adjustmentSubmitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {adjustmentSubmitting ? 'Registrando…' : 'Confirmar devolución'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
