export type WaiterPaymentMethod =
  | 'WAITER_CASH'
  | 'WAITER_CARD'
  | 'WAITER_CARD_DEBIT'
  | 'WAITER_CARD_CREDIT'
  | 'WAITER_MP_QR'
  | 'WAITER_TRANSFER';

export const WAITER_PAYMENT_METHOD_LABELS: Record<WaiterPaymentMethod, string> = {
  WAITER_CASH: 'Efectivo',
  WAITER_CARD: 'Tarjeta (sin especificar)',
  WAITER_CARD_DEBIT: 'Tarjeta Débito',
  WAITER_CARD_CREDIT: 'Tarjeta Crédito',
  WAITER_MP_QR: 'Mercado Pago (QR)',
  WAITER_TRANSFER: 'Transferencia'
};

export interface SalesReportFilterDTO {
  period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
  dateFrom?: string; // ISO string
  dateTo?: string;   // ISO string
  /**
   * E16: turno explícito. Cuando se informa, el rango [desde,hasta) del reporte
   * es la ventana del turno (openedAt, closedAt ?? ahora) y prevalece sobre
   * period/dateFrom/dateTo. Permite turnos que cruzan medianoche sin partirlos
   * por día calendario.
   */
  shiftId?: string;
  paymentMethod?: string;
  responsibleStaffUserId?: string;
  hasFiscalDocument?: boolean;
}

export interface PaymentMethodBreakdownDTO {
  method: string;
  label: string;
  paymentsCount: number;
  consumoMinor: number;
  tipMinor: number;
  refundMinor: number;
  totalMinor: number;
}

export interface SalesSummaryDTO {
  restaurantId: string;
  timezone: string;
  period: string;
  dateFrom: string;
  dateTo: string;
  currency: 'ARS';
  unit: 'ARS_MINOR';
  consumoConfirmadoMinor: number;
  consumoCobradoMinor: number;
  propinasCobradasMinor: number;
  /**
   * E16: devoluciones/ajustes del período en minor (suma de PaymentAdjustment
   * con createdAt dentro de [desde,hasta), valued por fecha propia del ajuste,
   * no por fecha del cobro original). cobrado neto = bruto del período − esto.
   */
  devolucionesMinor: number;
  totalRecibidoMinor: number;
  pendienteAlCorteMinor: number;
  /** E16: turno explícito cuando el reporte se pidió por shiftId. */
  shiftId?: string | null;
  shiftLabel?: string | null;
  shiftOpenedAt?: string | null;
  shiftClosedAt?: string | null;
  uniqueSessionsCount: number;
  paymentsCount: number;
  byMethod: PaymentMethodBreakdownDTO[];
  generatedAt: string;
}

export interface SalesOperationTandaItemDTO {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface SalesOperationTandaDTO {
  orderId: string;
  status: string;
  totalMinor: number;
  /** E16: fecha original de la tanda (createdAt preservado, nunca movido al pago). */
  createdAt: string;
  items: SalesOperationTandaItemDTO[];
}

export interface PaymentAdjustmentDTO {
  id: string;
  settlementId: string;
  restaurantId: string;
  amountMinor: number;
  tipMinor: number;
  totalAdjustedMinor: number;
  reason: string;
  adjustedBy: string;
  createdAt: string;
}

export interface SalesOperationSettlementDTO {
  settlementId: string;
  method: string;
  methodLabel: string;
  amountMinor: number;
  tipMinor: number;
  totalMinor: number;
  responsibleStaffUserId: string;
  responsibleStaffName?: string;
  adjustments?: PaymentAdjustmentDTO[];
  createdAt: string;
}

export interface SalesOperationDTO {
  tableSessionId: string;
  tableLabel: string;
  sector: string;
  sessionStartedAt: string;
  sessionClosedAt: string | null;
  /**
   * E16: importes del período [desde,hasta) — misma semántica que el resumen
   * (consumo por createdAt de tanda; cobrado/propina por fecha de cobro;
   * devolución por fecha propia del ajuste). El saldo/status son de la cuenta
   * completa (toda la vida de la sesión), no del período.
   */
  consumoTotalMinor: number;
  cobradoTotalMinor: number;
  propinaTotalMinor: number;
  /** E16: devoluciones del período sobre esta sesión (etiqueta canónica). */
  devolucionTotalMinor: number;
  saldoMinor: number;
  status: 'OPEN' | 'SETTLED' | 'CLOSED';
  tandas: SalesOperationTandaDTO[];
  settlements: SalesOperationSettlementDTO[];
  receipts: Array<{
    receiptId: string;
    receiptNumber: string;
    receiptType: string;
    createdAt: string;
  }>;
  fiscalDocuments: Array<{
    fiscalDocumentId: string;
    docType: string;
    docNumber: string;
    totalMinor: number;
  }>;
}

export interface ReceiptSnapshotDTO {
  id: string;
  restaurantId: string;
  tableSessionId: string;
  settlementId: string | null;
  receiptType: 'PRE_BILL_DETAIL' | 'PAYMENT_RECEIPT';
  receiptNumber: string;
  contentHash?: string | null;
  pdfVersion?: number;
  snapshotData: {
    restaurantName: string;
    restaurantAddress?: string;
    restaurantTimezone: string;
    legalNotice: string;
    receiptNumber: string;
    receiptType: 'PRE_BILL_DETAIL' | 'PAYMENT_RECEIPT';
    settlementId?: string | null;
    printedAt: string;
    tableLabel: string;
    sector: string;
    responsibleStaffUserId?: string | null;
    responsibleStaffName?: string;
    requestedTipMinor?: number;
    contentHash?: string;
    consumoMinor: number;
    tipMinor: number;
    totalMinor: number;
    paymentTotalMinor?: number;
    saldoMinor: number;
    payments: Array<{
      settlementId?: string;
      method: string;
      methodLabel: string;
      amountMinor: number;
      tipMinor: number;
      totalMinor: number;
      createdAt: string;
    }>;
    items: Array<{
      name: string;
      quantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }>;
  };
  pdfPath: string | null;
  status: 'PENDING' | 'GENERATED' | 'FAILED';
  createdAt: string;
}

export interface FiscalDocumentDTO {
  id: string;
  restaurantId: string;
  docType: 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TICKET_FISCAL' | 'OTRO';
  pointOfSale: number;
  docNumber: string;
  docDate: string;
  emitter: string;
  totalMinor: number;
  notes?: string | null;
  fileRef?: string | null;
  source: 'MANUAL';
  coveredSessions: Array<{
    tableSessionId: string;
    coveredMinor: number;
  }>;
  createdAt: string;
}
