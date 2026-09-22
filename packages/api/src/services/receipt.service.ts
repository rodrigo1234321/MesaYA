import { createHash, randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import {
  ReceiptSnapshotDTO,
  WAITER_PAYMENT_METHOD_LABELS,
  OrderStatus,
  SalesSummaryDTO,
  CallType,
  calculateOrderItemTotalMinor
} from '@mesaya/shared';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Intentos de reserva/emisión ante contención (ambiguos, nunca infinitos). */
const RECEIPT_ALLOCATE_ATTEMPTS = 12;
const RECEIPT_CREATE_ATTEMPTS = 10;

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
   * Período del ticket (YYYYMMDD): partición del contador y prefijo del número.
   */
  static receiptPeriod(date = new Date()): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  static formatReceiptNumber(period: string, sequence: number): string {
    return `TK-${period}-${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Estimación NO atómica del próximo número, sólo para visualización previa.
   * La unicidad real la garantiza allocateReceiptSequence (un UPDATE atómico
   * por local/período). Nunca usar este valor para reservar bajo concurrencia:
   * dos lecturas simultáneas devuelven el mismo candidato (defecto count+1).
   */
  static async getNextReceiptNumber(restaurantId: string): Promise<string> {
    const period = this.receiptPeriod();
    const seed = await this.readNumberSeed(restaurantId, period);
    return this.formatReceiptNumber(period, seed + 1);
  }

  /** Máximo entre el contador persistido y los tickets históricos del período. */
  private static async readNumberSeed(restaurantId: string, period: string): Promise<number> {
    let counterSeed = 0;
    try {
      const rows = await prisma.$queryRaw<Array<{ lastNumber: number | bigint }>>`
        SELECT "lastNumber" FROM "ReceiptCounter"
        WHERE "restaurantId" = ${restaurantId} AND "period" = ${period}
      `;
      if (rows.length > 0) counterSeed = Number(rows[0].lastNumber);
    } catch (err) {
      throw this.asCounterUnavailableError(err);
    }
    const legacySeed = await this.readLegacyNumberSeed(restaurantId, period);
    return Math.max(counterSeed, legacySeed);
  }

  /**
   * Sufijo máximo entre tickets ya persistidos: la numeración histórica
   * convive sin reiniciarse. Aproximado por diseño (orden lexicográfico sobre
   * sufijo zero-padded); cualquier colisión residual se resuelve avanzando el
   * contador en el reintento de create, nunca reutilizando números.
   */
  private static async readLegacyNumberSeed(restaurantId: string, period: string): Promise<number> {
    const prefix = `TK-${period}-`;
    const latest = await prisma.receiptSnapshot.findMany({
      where: { restaurantId, receiptNumber: { startsWith: prefix } },
      select: { receiptNumber: true },
      orderBy: { receiptNumber: 'desc' },
      take: 1
    });
    const match = latest[0]?.receiptNumber.match(/-(\d+)$/);
    return match ? parseInt(match[1], 10) || 0 : 0;
  }

  /**
   * Reserva atómicamente la siguiente secuencia del local/período (E15).
   * Un único UPDATE sobre la fila (restaurantId, period) serializa a los
   * competidores en PostgreSQL y SQLite: cada llamada obtiene un valor
   * distinto aunque haya decenas de solicitudes concurrentes. Los huecos por
   * colisión/reintento son esperables: el ticket es informativo, no una
   * secuencia fiscal sin huecos.
   */
  private static async allocateReceiptSequence(restaurantId: string, period: string): Promise<number> {
    for (let attempt = 0; attempt < RECEIPT_ALLOCATE_ATTEMPTS; attempt += 1) {
      let rows: Array<{ lastNumber: number | bigint }>;
      try {
        rows = await prisma.$queryRaw<Array<{ lastNumber: number | bigint }>>`
          UPDATE "ReceiptCounter"
          SET "lastNumber" = "lastNumber" + 1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "restaurantId" = ${restaurantId} AND "period" = ${period}
          RETURNING "lastNumber"
        `;
      } catch (err) {
        if (this.isMissingTableOrColumn(err)) throw this.asCounterUnavailableError(err);
        if (this.isTransientWriteError(err)) {
          await sleep(10 + attempt * 10);
          continue;
        }
        throw err;
      }
      if (rows.length > 0) return Number(rows[0].lastNumber);
      await this.ensureCounterRow(restaurantId, period);
      // La fila puede seguir ausente por contención de escritura: retroceso
      // breve y reintento acotado, sin ocultar el fallo.
      await sleep(5 + attempt * 5);
    }
    throw this.receiptFailure(
      'RECEIPT_COUNTER_EXHAUSTED',
      'No se pudo reservar número de ticket tras varios intentos por contención'
    );
  }

  /** Crea la fila del contador inicializada sobre los tickets existentes. */
  private static async ensureCounterRow(restaurantId: string, period: string): Promise<void> {
    const seed = await this.readLegacyNumberSeed(restaurantId, period);
    try {
      await prisma.$executeRaw`
        INSERT INTO "ReceiptCounter" ("id", "restaurantId", "period", "lastNumber", "updatedAt")
        VALUES (${randomUUID()}, ${restaurantId}, ${period}, ${seed}, CURRENT_TIMESTAMP)
        ON CONFLICT ("restaurantId", "period") DO NOTHING
      `;
    } catch (err) {
      if (this.isMissingTableOrColumn(err)) throw this.asCounterUnavailableError(err);
      // Contención de escritura (un competidor crea la fila a la vez): no es
      // fallo, el bucle reintenta el UPDATE atómico.
      if (this.isTransientWriteError(err)) return;
      throw err;
    }
  }

  private static isMissingTableOrColumn(err: any): boolean {
    const message = `${err?.message || err || ''}`;
    return (
      err?.code === 'P2022' ||
      message.includes('Unknown argument') ||
      message.includes('no such table') ||
      message.includes('no such column') ||
      message.includes('42P01') ||
      message.includes('42703') ||
      message.includes('does not exist')
    );
  }

  private static isTransientWriteError(err: any): boolean {
    const message = `${err?.message || err || ''}`.toLowerCase();
    return (
      err?.code === 'P2034' ||
      message.includes('database is locked') ||
      message.includes('sqlite_busy') ||
      message.includes(' busy') ||
      message.includes('locked') ||
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('could not serialize') ||
      message.includes('deadlock') ||
      message.includes('40001') ||
      message.includes('55p03')
    );
  }

  /**
   * La ausencia del contador o del esquema E15 es un error explícito 503,
   * nunca un fallback silencioso que simule persistencia.
   */
  private static asCounterUnavailableError(err: any): Error {
    if (this.isMissingTableOrColumn(err)) {
      const explicit: any = new Error(
        'Contador de tickets no disponible: falta aplicar la migración E15 (ReceiptCounter) o regenerar el cliente Prisma. Sin contador no se emiten tickets.'
      );
      explicit.statusCode = 503;
      explicit.code = 'RECEIPT_COUNTER_UNAVAILABLE';
      explicit.cause = err;
      return explicit;
    }
    return err;
  }

  private static receiptFailure(code: string, message: string): Error {
    const err: any = new Error(message);
    err.statusCode = 503;
    err.code = code;
    return err;
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
        const unitPriceMinor = item.unitPriceMinor ?? Math.round(Number(item.unitPrice || 0) * 100);
        const lineTotalMinor = calculateOrderItemTotalMinor(item.quantity, unitPriceMinor);
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
    const period = this.receiptPeriod();

    const snapshotBase: any = {
      restaurantName: restaurant.name,
      restaurantAddress: 'Mar del Plata, Buenos Aires',
      restaurantTimezone: restaurant.timezone || 'America/Argentina/Buenos_Aires',
      legalNotice: 'Comprobante informativo — No válido como factura',
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

    // Número, hash y PDF quedan ligados en una ÚNICA escritura: si el proceso
    // muere antes del create no hay fila a medio persistir; si muere después,
    // la fila ya contiene número+hash+PDF y es reimprimible tras reinicio.
    // El cobro (settlement) ya está confirmado antes de este punto y nunca se
    // revierte porque falle el render: un fallo de PDF es 503 explícito.
    // Ante P2002 por misma idempotencyKey se devuelve la fila ganadora; ante
    // P2002 por número (ticket histórico fuera del contador) se reserva un
    // número nuevo sin reutilizar el colisionado.
    for (let attempt = 0; attempt < RECEIPT_CREATE_ATTEMPTS; attempt += 1) {
      const sequence = await this.allocateReceiptSequence(input.restaurantId, period);
      const receiptNumber = this.formatReceiptNumber(period, sequence);
      const snapshotData: any = { ...snapshotBase, receiptNumber };
      // 2. Hash SHA-256 canónico e inmutable del snapshot final (con número).
      const contentHash = createHash('sha256')
        .update(JSON.stringify(snapshotData))
        .digest('hex');
      snapshotData.contentHash = contentHash;

      let pdfBuffer: Buffer;
      try {
        pdfBuffer = this.generateThermalPdfBuffer(snapshotData);
      } catch {
        throw this.receiptFailure(
          'RECEIPT_RENDER_FAILED',
          'No se pudo renderizar el ticket informativo; el cobro confirmado queda intacto'
        );
      }

      try {
        const created = await prisma.receiptSnapshot.create({
          data: {
            restaurantId: input.restaurantId,
            tableSessionId: input.tableSessionId,
            settlementId: input.settlementId || null,
            receiptType: input.receiptType,
            receiptNumber,
            snapshotData: JSON.stringify(snapshotData),
            contentHash,
            pdfVersion: 1,
            pdfData: pdfBuffer,
            // Se conserva el data-URI en pdfPath para clientes generados antes
            // de la migración E15 que sólo leen ese campo; el DTO lo sigue
            // ocultando y el PDF canónico vive en pdfData.
            pdfPath: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
            status: 'GENERATED',
            idempotencyKey: key
          }
        });
        return this.formatReceipt(created);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const replay = await prisma.receiptSnapshot.findUnique({ where: { idempotencyKey: key } });
          if (replay) return this.formatReceipt(replay);
          continue;
        }
        if (this.isTransientWriteError(err)) {
          await sleep(10 + attempt * 10);
          continue;
        }
        if (this.isMissingTableOrColumn(err)) {
          throw this.receiptFailure(
            'RECEIPT_SCHEMA_UPGRADE_REQUIRED',
            'Esquema de tickets desactualizado (faltan columnas/campos de persistencia E15 o regenerar el cliente Prisma); no se emitió el ticket'
          );
        }
        throw err;
      }
    }

    throw this.receiptFailure(
      'RECEIPT_NUMBER_EXHAUSTED',
      'No se pudo emitir el ticket informativo tras varios intentos por contención'
    );
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
    } catch (err) {
      // Sólo se tolera esquema anterior (sin columna pdfData): se sigue con
      // pdfPath. Cualquier otro fallo de lectura se propaga, no se oculta.
      if (!this.isMissingTableOrColumn(err)) throw err;
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
    lines.push(`Turno:          ${summary.shiftLabel || 'Día calendario (período seleccionado)'}`);
    lines.push(subsep);
    lines.push(`MÉTRICAS CLAVE DEL PERÍODO`);
    lines.push(subsep);

    const fmtMoney = (cents: number) => `$ ${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    lines.push(`  Consumo confirmado en período:       ${fmtMoney(summary.consumoConfirmadoMinor).padStart(20, ' ')}`);
    lines.push(`  Consumo efectivamente cobrado:       ${fmtMoney(summary.consumoCobradoMinor).padStart(20, ' ')}`);
    lines.push(`  Propinas cobradas:                   ${fmtMoney(summary.propinasCobradasMinor).padStart(20, ' ')}`);
    lines.push(`  Devoluciones del período:             ${fmtMoney(summary.devolucionesMinor).padStart(20, ' ')}`);
    lines.push(`  TOTAL RECIBIDO (Consumo + Propinas): ${fmtMoney(summary.totalRecibidoMinor).padStart(20, ' ')}`);
    lines.push(`  Pendiente al corte (mesas abiertas): ${fmtMoney(summary.pendienteAlCorteMinor).padStart(20, ' ')}`);
    lines.push(``);
    lines.push(`  Ocupaciones únicas registradas:      ${summary.uniqueSessionsCount.toString().padStart(20, ' ')}`);
    lines.push(`  Pagos individuales registrados:      ${summary.paymentsCount.toString().padStart(20, ' ')}`);
    lines.push(subsep);
    lines.push(`DESGLOSE POR MEDIO DE COBRO`);
    lines.push(subsep);
    lines.push(`MEDIO                     PAGOS    CONSUMO    PROPINA DEVOLUCIÓN      TOTAL`);
    lines.push(subsep);

    for (const b of summary.byMethod) {
      const label = b.label.padEnd(28, ' ');
      const count = b.paymentsCount.toString().padStart(6, ' ');
      const cons = fmtMoney(b.consumoMinor).padStart(14, ' ');
      const tip = fmtMoney(b.tipMinor).padStart(13, ' ');
      const refund = fmtMoney(b.refundMinor).padStart(14, ' ');
      const tot = fmtMoney(b.totalMinor).padStart(14, ' ');
      lines.push(`${label} ${count} ${cons} ${tip} ${refund} ${tot}`);
    }

    lines.push(subsep);
    const totLabel = 'TOTALES DEL PERÍODO'.padEnd(28, ' ');
    const totCount = summary.paymentsCount.toString().padStart(6, ' ');
    const totCons = fmtMoney(summary.consumoCobradoMinor).padStart(14, ' ');
    const totTip = fmtMoney(summary.propinasCobradasMinor).padStart(13, ' ');
    const totRefund = fmtMoney(summary.devolucionesMinor).padStart(14, ' ');
    const totTotal = fmtMoney(summary.totalRecibidoMinor).padStart(14, ' ');
    lines.push(`${totLabel} ${totCount} ${totCons} ${totTip} ${totRefund} ${totTotal}`);
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
