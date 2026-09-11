import { createHash } from 'crypto';
import { prisma } from '../lib/prisma';
import {
  ReceiptSnapshotDTO,
  WAITER_PAYMENT_METHOD_LABELS,
  OrderStatus,
  SalesSummaryDTO,
  CallType
} from '@mesaya/shared';

export interface GenerateReceiptInput {
  restaurantId: string;
  tableSessionId: string;
  settlementId?: string | null;
  receiptType: 'PRE_BILL_DETAIL' | 'PAYMENT_RECEIPT';
  idempotencyKey?: string;
}

export class ReceiptService {
  /**
   * Caché en memoria para los buffers de PDF ya renderizados (indexados por hash o receiptId).
   */
  private static pdfCache = new Map<string, Buffer>();

  /**
   * Limpia el caché en memoria de PDFs para pruebas de reproducibilidad e integridad.
   */
  static clearPdfCache(): void {
    this.pdfCache.clear();
  }

  /**
   * Genera un número secuencial amigable para el ticket: TK-YYYYMMDD-XXXX
   */
  static async getNextReceiptNumber(restaurantId: string): Promise<string> {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await prisma.receiptSnapshot.count({
      where: {
        restaurantId,
        receiptNumber: { startsWith: `TK-${todayStr}` }
      }
    });
    return `TK-${todayStr}-${(count + 1).toString().padStart(4, '0')}`;
  }

  /**
   * Crea o recupera una instantánea de ticket para una cuenta o pago (idempotente e inmutable).
   */
  static async getOrCreateReceipt(input: GenerateReceiptInput): Promise<ReceiptSnapshotDTO> {
    const key =
      input.idempotencyKey ||
      `rcpt-${input.receiptType}-${input.tableSessionId}-${input.settlementId || 'none'}`;

    const existing = await prisma.receiptSnapshot.findUnique({
      where: { idempotencyKey: key }
    });

    if (existing) {
      return this.formatReceipt(existing);
    }

    const session = await prisma.tableSession.findUnique({
      where: { id: input.tableSessionId },
      include: {
        table: {
          include: {
            restaurant: true
          }
        },
        orders: {
          where: {
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.IN_KITCHEN, OrderStatus.READY_TO_SERVE, OrderStatus.SERVED, OrderStatus.PAID] }
          },
          include: {
            items: {
              include: { menuItem: true }
            }
          }
        },
        settlements: {
          include: { adjustments: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session || session.table.restaurantId !== input.restaurantId) {
      const err: any = new Error('Sesión de mesa no encontrada');
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    const requestedSettlement = input.settlementId
      ? session.settlements.find((settlement) => settlement.id === input.settlementId)
      : null;
    if (input.settlementId && !requestedSettlement) {
      const err: any = new Error('Cobro no pertenece a la ocupación indicada');
      err.statusCode = 404;
      err.code = 'SETTLEMENT_NOT_FOUND';
      throw err;
    }

    const restaurant = session.table.restaurant;
    const items: Array<{ name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }> = [];
    let consumoMinor = 0;

    for (const order of session.orders) {
      for (const item of order.items) {
        const unitPriceMinor = Math.round(Number(item.unitPrice || 0) * 100);
        const lineTotalMinor = unitPriceMinor * item.quantity;
        consumoMinor += lineTotalMinor;
        items.push({
          name: item.menuItem?.name || 'Consumo',
          quantity: item.quantity,
          unitPriceMinor,
          lineTotalMinor
        });
      }
    }

    let paidMinor = 0;
    let tipMinor = 0;
    const allPayments = session.settlements.map((s) => {
      const refundAmt = s.adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
      const refundTip = s.adjustments.reduce((sum, a) => sum + a.tipMinor, 0);
      const netAmt = Math.max(0, s.amountMinor - refundAmt);
      const netTip = Math.max(0, s.tipMinor - refundTip);
      paidMinor += netAmt;
      tipMinor += netTip;
      return {
        settlementId: s.id,
        method: s.method,
        methodLabel: (WAITER_PAYMENT_METHOD_LABELS as any)[s.method] || s.method,
        amountMinor: netAmt,
        tipMinor: netTip,
        totalMinor: netAmt + netTip,
        createdAt: s.createdAt.toISOString()
      };
    });
    const payments = input.receiptType === 'PAYMENT_RECEIPT' && input.settlementId
      ? allPayments.filter((payment) => payment.settlementId === input.settlementId)
      : allPayments;
    const paymentTotalMinor = payments.reduce((sum, payment) => sum + payment.totalMinor, 0);

    // 1. Trazabilidad del mozo y solicitud de cuenta
    let requestedTipMinor = 0;
    let responsibleStaffUserId: string | null = null;
    let responsibleStaffName = 'Personal del salón';

    const latestBill = await prisma.callRequest.findFirst({
      where: { tableSessionId: session.id, type: CallType.BILL },
      orderBy: { createdAt: 'desc' }
    });

    if (latestBill) {
      requestedTipMinor = latestBill.tipMinor || 0;
      const billClaim = await prisma.serviceTaskClaim.findFirst({
        where: { taskType: 'CALL', targetId: latestBill.id },
        orderBy: { claimedAt: 'desc' }
      });
      if (billClaim?.staffUserId) {
        responsibleStaffUserId = billClaim.staffUserId;
      }
    }

    if (!responsibleStaffUserId && session.settlements.length > 0) {
      const lastSettlement = session.settlements[session.settlements.length - 1];
      responsibleStaffUserId = lastSettlement.responsibleStaffUserId || lastSettlement.createdBy || null;
    }

    if (responsibleStaffUserId) {
      const staffUser = await prisma.staffUser.findUnique({
        where: { id: responsibleStaffUserId },
        select: { name: true }
      });
      if (staffUser?.name) {
        responsibleStaffName = staffUser.name;
      }
    }

    // Para pre-cuenta: si no se pagó propina aún pero el cliente solicitó propina en el llamado BILL,
    // mostrar la propina solicitada en el detalle informativo
    if (input.receiptType === 'PRE_BILL_DETAIL' && tipMinor === 0 && requestedTipMinor > 0) {
      tipMinor = requestedTipMinor;
    }

    const saldoMinor = Math.max(0, consumoMinor - paidMinor);
    let receiptNumber = await this.getNextReceiptNumber(input.restaurantId);

    const snapshotData: any = {
      restaurantName: restaurant.name,
      restaurantAddress: 'Mar del Plata, Buenos Aires',
      restaurantTimezone: restaurant.timezone || 'America/Argentina/Buenos_Aires',
      legalNotice: 'Comprobante informativo — No válido como factura',
        receiptNumber,
        receiptType: input.receiptType,
        settlementId: input.settlementId || null,
      printedAt: new Date().toISOString(),
      tableLabel: session.table.label,
      sector: session.table.sector,
      responsibleStaffUserId,
      responsibleStaffName,
      requestedTipMinor: requestedTipMinor > 0 ? requestedTipMinor : undefined,
      consumoMinor,
        tipMinor,
        totalMinor: consumoMinor + tipMinor,
        paymentTotalMinor: input.receiptType === 'PAYMENT_RECEIPT' ? paymentTotalMinor : undefined,
        saldoMinor,
        payments: input.receiptType === 'PAYMENT_RECEIPT' ? payments : [],
      items
    };

    // 2. Hash SHA-256 canónico e inmutable del snapshot
    let contentHash = createHash('sha256')
      .update(JSON.stringify(snapshotData))
      .digest('hex');
    snapshotData.contentHash = contentHash;

    // El PDF se genera a partir del snapshot final y se guarda junto con él.
    // Si dos solicitudes calculan el mismo número correlativo, se reintenta con
    // el siguiente número; si compiten por la misma idempotencyKey se recupera
    // la fila ganadora sin crear un segundo ticket.
    let pdfBuffer = this.generateThermalPdfBuffer(snapshotData);
    let created: any = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        created = await prisma.receiptSnapshot.create({
          data: {
            restaurantId: input.restaurantId,
            tableSessionId: input.tableSessionId,
            settlementId: input.settlementId || null,
            receiptType: input.receiptType,
            receiptNumber,
            snapshotData: JSON.stringify(snapshotData),
            // Compatibilidad con clientes Prisma generados antes de la migración:
            // el PDF queda persistido en el campo existente y luego se proyecta
            // a pdfData cuando el esquema nuevo está disponible.
            pdfPath: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
            status: 'GENERATED',
            idempotencyKey: key
          }
        });
        try {
          await prisma.$executeRaw`
            UPDATE "ReceiptSnapshot"
            SET "contentHash" = ${contentHash}, "pdfVersion" = ${1}, "pdfData" = ${pdfBuffer}
            WHERE "id" = ${created.id}
          `;
        } catch (persistenceError) {
          // El proceso local puede seguir usando un cliente generado antes de
          // estos campos; snapshotData/pdfPath ya conservan hash y PDF completos.
          console.warn('No se pudo proyectar la persistencia extendida del ticket:', persistenceError);
        }
        break;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;

        const replay = await prisma.receiptSnapshot.findUnique({ where: { idempotencyKey: key } });
        if (replay) return this.formatReceipt(replay);
        if (attempt === 3) throw err;

        receiptNumber = await this.getNextReceiptNumber(input.restaurantId);
        snapshotData.receiptNumber = receiptNumber;
        const nextHash = createHash('sha256')
          .update(JSON.stringify({ ...snapshotData, contentHash: undefined }))
          .digest('hex');
        delete snapshotData.contentHash;
        contentHash = nextHash;
        snapshotData.contentHash = nextHash;
        pdfBuffer = this.generateThermalPdfBuffer(snapshotData);
      }
    }

    if (!created) {
      const err: any = new Error('No se pudo persistir el ticket informativo');
      err.statusCode = 503;
      err.code = 'RECEIPT_PERSIST_FAILED';
      throw err;
    }

    return this.formatReceipt(created);
  }

  /**
   * Obtiene un ticket por su ID asegurando tenant isolation.
   */
  static async getReceiptById(restaurantId: string, receiptId: string): Promise<ReceiptSnapshotDTO> {
    const receipt = await prisma.receiptSnapshot.findFirst({
      where: { id: receiptId, restaurantId }
    });
    if (!receipt) {
      const err: any = new Error('Comprobante no encontrado');
      err.statusCode = 404;
      err.code = 'RECEIPT_NOT_FOUND';
      throw err;
    }
    return this.formatReceipt(receipt);
  }

  /** Devuelve el PDF persistido; el renderer/cache solo es fallback para filas antiguas. */
  static async getReceiptPdfBuffer(restaurantId: string, receiptId: string): Promise<Buffer> {
    try {
      const extended = await prisma.$queryRaw<Array<{ pdfData: Buffer | null }>>`
        SELECT "pdfData"
        FROM "ReceiptSnapshot"
        WHERE "id" = ${receiptId} AND "restaurantId" = ${restaurantId}
      `;
      if (extended[0]?.pdfData) return Buffer.from(extended[0].pdfData);
    } catch {
      // Clientes/procesos locales anteriores a la migración no tienen aún pdfData.
    }

    const receipt = await prisma.receiptSnapshot.findFirst({
      where: { id: receiptId, restaurantId },
      select: { snapshotData: true, pdfPath: true }
    });
    if (!receipt) {
      const err: any = new Error('Comprobante no encontrado');
      err.statusCode = 404;
      err.code = 'RECEIPT_NOT_FOUND';
      throw err;
    }
    if (receipt.pdfPath?.startsWith('data:application/pdf;base64,')) {
      return Buffer.from(receipt.pdfPath.slice('data:application/pdf;base64,'.length), 'base64');
    }
    const data = typeof receipt.snapshotData === 'string' ? JSON.parse(receipt.snapshotData) : receipt.snapshotData;
    return this.generateThermalPdfBuffer(data);
  }

  /**
   * Genera o recupera de caché un PDF canónico 80mm térmico para la instantánea.
   */
  static generateThermalPdfBuffer(snapshotData: ReceiptSnapshotDTO['snapshotData']): Buffer {
    const cacheKey = snapshotData.contentHash || snapshotData.receiptNumber;
    if (this.pdfCache.has(cacheKey)) {
      return this.pdfCache.get(cacheKey)!;
    }

    const lines: string[] = [];
    lines.push(`================================`);
    lines.push(`     ${snapshotData.restaurantName.toUpperCase()}`);
    lines.push(` ${snapshotData.legalNotice}`);
    lines.push(`================================`);
    lines.push(`Ticket: ${snapshotData.receiptNumber}`);
    lines.push(`Tipo:   ${snapshotData.receiptType === 'PRE_BILL_DETAIL' ? 'DETALLE PRE-CUENTA' : 'COMPROBANTE DE PAGO'}`);
    lines.push(`Fecha:  ${new Date(snapshotData.printedAt).toLocaleString('es-AR', { timeZone: snapshotData.restaurantTimezone })}`);
    lines.push(`Mesa:   ${snapshotData.tableLabel} (${snapshotData.sector})`);
    if (snapshotData.responsibleStaffName) {
      lines.push(`Mozo:   ${snapshotData.responsibleStaffName}`);
    }
    lines.push(`--------------------------------`);
    lines.push(`CANT  DESCRIPCION         TOTAL`);
    lines.push(`--------------------------------`);

    for (const it of snapshotData.items) {
      const desc = it.name.slice(0, 18).padEnd(18, ' ');
      const qty = it.quantity.toString().padStart(3, ' ');
      const tot = `$${(it.lineTotalMinor / 100).toFixed(2)}`.padStart(9, ' ');
      lines.push(`${qty} ${desc} ${tot}`);
    }

    lines.push(`--------------------------------`);
    lines.push(`Subtotal Consumo: $${(snapshotData.consumoMinor / 100).toFixed(2)}`);
    if (snapshotData.tipMinor > 0) {
      const tipLabel = snapshotData.receiptType === 'PRE_BILL_DETAIL' ? 'Propina elegida:' : 'Propina pagada: ';
      lines.push(`${tipLabel} $${(snapshotData.tipMinor / 100).toFixed(2)}`);
    }
    lines.push(`TOTAL ESTIMADO:   $${(snapshotData.totalMinor / 100).toFixed(2)}`);
    if (snapshotData.receiptType === 'PAYMENT_RECEIPT' && snapshotData.paymentTotalMinor !== undefined) {
      lines.push(`COBRO REGISTRADO:  $${(snapshotData.paymentTotalMinor / 100).toFixed(2)}`);
    }

    if (snapshotData.receiptType === 'PRE_BILL_DETAIL') {
      lines.push(`--------------------------------`);
      lines.push(`ESTADO: PENDIENTE DE PAGO`);
      if (snapshotData.saldoMinor > 0) {
        lines.push(`SALDO A COBRAR:   $${(snapshotData.saldoMinor / 100).toFixed(2)}`);
      }
    } else {
      if (snapshotData.saldoMinor > 0) {
        lines.push(`SALDO PENDIENTE:  $${(snapshotData.saldoMinor / 100).toFixed(2)}`);
      }
      if (snapshotData.payments && snapshotData.payments.length > 0) {
        lines.push(`--------------------------------`);
        lines.push(`PAGOS REGISTRADOS:`);
        for (const p of snapshotData.payments) {
          lines.push(`- ${p.methodLabel}: $${(p.totalMinor / 100).toFixed(2)}`);
        }
      }
    }

    lines.push(`================================`);
    lines.push(`  ${snapshotData.legalNotice}`);
    lines.push(`================================`);

    const pdfBuffer = this.buildSimplePdf(lines, 226, 40 + lines.length * 14);
    this.pdfCache.set(cacheKey, pdfBuffer);
    return pdfBuffer;
  }

  /**
   * Genera un reporte PDF en formato A4 (595 x 842 pt) para el resumen de ventas del período,
   * respetando la zona horaria del local y la leyenda no fiscal.
   */
  static generateSalesSummaryA4PdfBuffer(
    summary: SalesSummaryDTO,
    restaurantName: string,
    timezone: string
  ): Buffer {
    const lines: string[] = [];
    const sep = '='.repeat(78);
    const subsep = '-'.repeat(78);

    lines.push(sep);
    lines.push(`                              ${restaurantName.toUpperCase()}`.slice(0, 78));
    lines.push(`                      RESUMEN DE VENTAS Y COBROS (A4)`);
    lines.push(`               Comprobante informativo — No válido como factura`);
    lines.push(sep);

    const fromStr = new Date(summary.dateFrom).toLocaleString('es-AR', { timeZone: timezone });
    const toStr = new Date(summary.dateTo).toLocaleString('es-AR', { timeZone: timezone });
    const genStr = new Date(summary.generatedAt).toLocaleString('es-AR', { timeZone: timezone });

    lines.push(`Período:        ${fromStr} a ${toStr} (${timezone})`);
    lines.push(`Generado el:    ${genStr}`);
    lines.push(`Modalidad:      ${summary.period}`);
    lines.push(subsep);
    lines.push(`MÉTRICAS CLAVE DEL PERÍODO`);
    lines.push(subsep);

    const fmtMoney = (cents: number) => `$ ${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    lines.push(`  Consumo confirmado en período:       ${fmtMoney(summary.consumoConfirmadoMinor).padStart(20, ' ')}`);
    lines.push(`  Consumo efectivamente cobrado:       ${fmtMoney(summary.consumoCobradoMinor).padStart(20, ' ')}`);
    lines.push(`  Propinas cobradas:                   ${fmtMoney(summary.propinasCobradasMinor).padStart(20, ' ')}`);
    lines.push(`  TOTAL RECIBIDO (Consumo + Propinas): ${fmtMoney(summary.totalRecibidoMinor).padStart(20, ' ')}`);
    lines.push(`  Pendiente al corte (mesas abiertas): ${fmtMoney(summary.pendienteAlCorteMinor).padStart(20, ' ')}`);
    lines.push(``);
    lines.push(`  Ocupaciones únicas registradas:      ${summary.uniqueSessionsCount.toString().padStart(20, ' ')}`);
    lines.push(`  Pagos individuales registrados:      ${summary.paymentsCount.toString().padStart(20, ' ')}`);
    lines.push(subsep);
    lines.push(`DESGLOSE POR MEDIO DE COBRO`);
    lines.push(subsep);
    lines.push(`MEDIO                          PAGOS       CONSUMO       PROPINA         TOTAL`);
    lines.push(subsep);

    for (const b of summary.byMethod) {
      const label = b.label.padEnd(28, ' ');
      const count = b.paymentsCount.toString().padStart(6, ' ');
      const cons = fmtMoney(b.consumoMinor).padStart(14, ' ');
      const tip = fmtMoney(b.tipMinor).padStart(13, ' ');
      const tot = fmtMoney(b.totalMinor).padStart(14, ' ');
      lines.push(`${label} ${count} ${cons} ${tip} ${tot}`);
    }

    lines.push(subsep);
    const totLabel = 'TOTALES DEL PERÍODO'.padEnd(28, ' ');
    const totCount = summary.paymentsCount.toString().padStart(6, ' ');
    const totCons = fmtMoney(summary.consumoCobradoMinor).padStart(14, ' ');
    const totTip = fmtMoney(summary.propinasCobradasMinor).padStart(13, ' ');
    const totTotal = fmtMoney(summary.totalRecibidoMinor).padStart(14, ' ');
    lines.push(`${totLabel} ${totCount} ${totCons} ${totTip} ${totTotal}`);
    lines.push(sep);
    lines.push(`Aviso legal: Este documento es un reporte de gestión operativa interna emitido`);
    lines.push(`por el sistema RTMS. No posee validez legal ni fiscal como factura o ticket AFIP.`);
    lines.push(sep);

    return this.buildSimplePdf(lines, 595, 842);
  }

  /**
   * Constructor minimalista de PDF 1.4 estándar para páginas térmicas o A4.
   */
  private static buildSimplePdf(textLines: string[], widthPt: number, heightPt: number): Buffer {
    const escaped = textLines.map((l) =>
      l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    );

    let stream = `BT\n/F1 9 Tf\n13 TL\n25 ${heightPt - 35} Td\n`;
    for (const l of escaped) {
      stream += `(${l}) '\n`;
    }
    stream += `ET\n`;

    const streamLen = Buffer.byteLength(stream, 'latin1');

    const objects: string[] = [];
    objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    objects.push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
    objects.push(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`
    );
    objects.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`);
    objects.push(
      `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`
    );

    let pdf = `%PDF-1.4\n`;
    const xref: number[] = [0];

    for (const obj of objects) {
      xref.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += obj;
    }

    const startXref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${xref[i].toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
  }

  private static formatReceipt(r: any): ReceiptSnapshotDTO {
    const data = typeof r.snapshotData === 'string' ? JSON.parse(r.snapshotData) : r.snapshotData;
    const sanitizedPdfPath =
      typeof r.pdfPath === 'string' && !r.pdfPath.startsWith('data:') && !r.pdfPath.includes('base64')
        ? r.pdfPath
        : null;

    return {
      id: r.id,
      restaurantId: r.restaurantId,
      tableSessionId: r.tableSessionId,
      settlementId: r.settlementId,
      receiptType: r.receiptType,
      receiptNumber: r.receiptNumber,
      contentHash: r.contentHash || data?.contentHash || null,
      pdfVersion: r.pdfVersion || 1,
      snapshotData: data,
      pdfPath: sanitizedPdfPath,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
    };
  }
}
