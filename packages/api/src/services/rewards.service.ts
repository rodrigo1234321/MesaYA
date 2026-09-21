import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';

const REWARDS_RULE_VERSION = 'rewards-v1';
const MAX_LEDGER_ROWS = 100;

export type RewardLedgerEntryType = 'ACCRUAL' | 'REDEMPTION' | 'REVERSAL' | 'ADJUSTMENT' | 'EXPIRATION';

export interface RewardsCustomerDTO {
  id: string;
  restaurantId: string;
  phone: string;
  points: number;
  consentAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RewardsLedgerDTO {
  id: string;
  customerLoyaltyId: string;
  pointsDelta: number;
  balanceAfter: number;
  entryType: string;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  ruleVersion: string;
  idempotencyKey: string;
  approvedBy: string | null;
  createdAt: string;
}

function rewardsError(message: string, statusCode: number, code: string): never {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}

/**
 * Normaliza teléfonos argentinos para que la identidad de Rewards no dependa
 * del formato escrito por el cliente o el mozo. Entrada sanitizada a E.164 (+549...).
 * Formatos equivalentes ('223 555 1234', '+54 9 223 555 1234', '0223 15 555 1234')
 * mapean al mismo identificador canónico. Entradas inválidas se rechazan.
 */
export function normalizeRewardsPhone(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    rewardsError('El teléfono es obligatorio.', 400, 'INVALID_REWARDS_PHONE');
  }
  let digits = raw.replace(/\D/g, '');
  if (!digits) {
    rewardsError('El teléfono es obligatorio.', 400, 'INVALID_REWARDS_PHONE');
  }

  // 1. Quitar prefijo internacional si viene presente (+549 o +54)
  if (digits.startsWith('549')) {
    digits = digits.substring(3);
  } else if (digits.startsWith('54')) {
    digits = digits.substring(2);
  }

  // 2. Quitar 0 de prefijo interurbano (ej: 0223 -> 223, 011 -> 11)
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  // 3. Celular con 15 local sin código de área (ej: 15 555 1234, longitud 10)
  if (digits.startsWith('15') && digits.length === 10) {
    rewardsError('El teléfono debe incluir el código de área.', 400, 'INVALID_REWARDS_PHONE');
  }

  // 4. Quitar 15 tras código de área habitual en Argentina (longitud 12)
  if (digits.length === 12) {
    if (digits.startsWith('1115')) {
      digits = '11' + digits.substring(4);
    } else if (/^\d{3}15\d{7}$/.test(digits)) {
      digits = digits.substring(0, 3) + digits.substring(5);
    } else if (/^\d{4}15\d{6}$/.test(digits)) {
      digits = digits.substring(0, 4) + digits.substring(6);
    }
  }

  // 5. Quitar 9 si se colocó delante del área de 10 dígitos (ej: 9 223 555 1234 = 11 dígitos)
  if (digits.length === 11 && digits.startsWith('9')) {
    digits = digits.substring(1);
  }

  // 6. La identidad de Rewards exige un número nacional argentino completo:
  // exactamente 10 dígitos después de normalizar prefijos. No se toleran
  // longitudes parciales porque crearían dos cuentas para la misma persona.
  if (!/^\d{10}$/.test(digits)) {
    rewardsError('El teléfono debe tener un formato válido para Rewards.', 400, 'INVALID_REWARDS_PHONE');
  }

  return `+549${digits}`;
}

function assertIdempotencyKey(raw: string | undefined, prefix: string): string {
  const key = typeof raw === 'string' && raw.trim() ? raw.trim() : `${prefix}-${randomUUID()}`;
  if (key.length > 160) rewardsError('La clave de idempotencia es demasiado larga.', 400, 'INVALID_IDEMPOTENCY_KEY');
  return key;
}

function boundedText(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max) {
    rewardsError(`${field} no es válido.`, 400, 'INVALID_REWARDS_TEXT');
  }
  return raw.trim();
}

export function customerDTO(customer: any): RewardsCustomerDTO {
  return {
    id: customer.id,
    restaurantId: customer.restaurantId,
    phone: customer.phone,
    points: customer.points,
    consentAt: customer.consentAt?.toISOString?.() || customer.consentAt || null,
    verifiedAt: customer.verifiedAt?.toISOString?.() || customer.verifiedAt || null,
    createdAt: customer.createdAt instanceof Date ? customer.createdAt.toISOString() : String(customer.createdAt),
    updatedAt: customer.updatedAt instanceof Date ? customer.updatedAt.toISOString() : String(customer.updatedAt)
  };
}

export function ledgerDTO(entry: any): RewardsLedgerDTO {
  return {
    id: entry.id,
    customerLoyaltyId: entry.customerLoyaltyId,
    pointsDelta: entry.pointsDelta,
    balanceAfter: entry.balanceAfter,
    entryType: entry.entryType,
    reason: entry.reason,
    referenceType: entry.referenceType || null,
    referenceId: entry.referenceId || null,
    ruleVersion: entry.ruleVersion,
    idempotencyKey: entry.idempotencyKey,
    approvedBy: entry.approvedBy || null,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt)
  };
}

export class RewardsService {
  static readonly RULE_VERSION = REWARDS_RULE_VERSION;

  static async assertEnabled(restaurantId: string) {
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId },
      select: { enableRewards: true, pointsPerHundredPesos: true }
    });
    if (!config?.enableRewards) {
      rewardsError('Rewards no está habilitado para este restaurante.', 409, 'REWARDS_DISABLED');
    }
    return config;
  }

  /**
   * Consulta segura de saldo y movimientos por teléfono.
   * Sólo personal autenticado del mismo restaurante.
   * NUNCA crea una cuenta si el teléfono no existe.
   */
  static async getBalance(restaurantId: string, rawPhone: string, includeLedger = true) {
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId },
      select: { enableRewards: true }
    });
    if (!config?.enableRewards) {
      return { customer: null, ledger: [] as RewardsLedgerDTO[] };
    }
    const phone = normalizeRewardsPhone(rawPhone);
    const customer = await prisma.customerLoyalty.findUnique({
      where: { restaurantId_phone: { restaurantId, phone } },
      include: includeLedger ? {
        ledgerEntries: { orderBy: { createdAt: 'desc' }, take: MAX_LEDGER_ROWS }
      } : undefined
    });
    if (!customer) {
      return { customer: null, ledger: [] as RewardsLedgerDTO[] };
    }
    return {
      customer: customerDTO(customer),
      ledger: includeLedger ? (customer as any).ledgerEntries.map(ledgerDTO) : []
    };
  }

  /**
   * Consulta sólo los datos del cliente sin ledger. No crea registros.
   */
  static async getCustomer(restaurantId: string, rawPhone: string) {
    await this.assertEnabled(restaurantId);
    const phone = normalizeRewardsPhone(rawPhone);
    const customer = await prisma.customerLoyalty.findUnique({
      where: { restaurantId_phone: { restaurantId, phone } }
    });
    return customer ? customerDTO(customer) : null;
  }

  /**
   * Alta explícita o actualización de consentimiento de un cliente Rewards.
   * Requiere consent === true; rechaza llamadas sin consentimiento explícito.
   */
  static async registerCustomer(params: {
    restaurantId: string;
    phone: string;
    consent: boolean;
    approvedBy?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    if (params.consent !== true) {
      rewardsError('El consentimiento explícito es obligatorio para dar de alta en Rewards.', 400, 'REWARDS_CONSENT_REQUIRED');
    }
    const phone = normalizeRewardsPhone(params.phone);
    const now = new Date();
    const customer = await prisma.customerLoyalty.upsert({
      where: { restaurantId_phone: { restaurantId: params.restaurantId, phone } },
      create: { restaurantId: params.restaurantId, phone, consentAt: now },
      update: { consentAt: now }
    });
    return customerDTO(customer);
  }

  /** @deprecated Usar registerCustomer para alta explícita o getCustomer para consulta */
  static async getOrCreateCustomer(restaurantId: string, rawPhone: string, consent = false) {
    const phone = normalizeRewardsPhone(rawPhone);
    if (!consent) {
      const existing = await prisma.customerLoyalty.findUnique({
        where: { restaurantId_phone: { restaurantId, phone } }
      });
      if (!existing) {
        rewardsError('El cliente no existe y no se otorgó consentimiento para su alta.', 400, 'REWARDS_CONSENT_REQUIRED');
      }
      return customerDTO(existing);
    }
    return this.registerCustomer({ restaurantId, phone, consent: true });
  }

  private static async applyDelta(tx: any, params: {
    restaurantId: string;
    phone: string;
    pointsDelta: number;
    entryType: RewardLedgerEntryType;
    reason: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    consent?: boolean;
    approvedBy?: string;
    allowCreate?: boolean;
  }) {
    if (!Number.isInteger(params.pointsDelta) || params.pointsDelta === 0) {
      rewardsError('La variación de puntos debe ser un entero distinto de cero.', 400, 'INVALID_POINTS_DELTA');
    }
    const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) {
      if (existing.restaurantId !== params.restaurantId) {
        rewardsError('La clave de idempotencia ya fue utilizada para otro restaurante.', 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      const customer = await tx.customerLoyalty.findUnique({ where: { id: existing.customerLoyaltyId } });
      if (!customer || customer.phone !== params.phone) {
        rewardsError('La clave de idempotencia ya fue utilizada para otro cliente.', 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      return { customer, entry: existing, idempotentReplay: true };
    }

    let customer = await tx.customerLoyalty.findUnique({
      where: { restaurantId_phone: { restaurantId: params.restaurantId, phone: params.phone } }
    });

    if (!customer) {
      if (!params.allowCreate) {
        rewardsError('Cliente Rewards no encontrado.', 404, 'REWARDS_CUSTOMER_NOT_FOUND');
      }
      if (params.consent !== true) {
        rewardsError('El cliente debe aceptar el programa Rewards antes de sumar puntos.', 400, 'REWARDS_CONSENT_REQUIRED');
      }
      customer = await tx.customerLoyalty.create({
        data: {
          restaurantId: params.restaurantId,
          phone: params.phone,
          consentAt: new Date()
        }
      });
    } else {
      if (!customer.consentAt) {
        if (params.consent === true) {
          customer = await tx.customerLoyalty.update({
            where: { id: customer.id },
            data: { consentAt: new Date() }
          });
        } else {
          rewardsError('El cliente debe aceptar el programa Rewards antes de operar.', 400, 'REWARDS_CONSENT_REQUIRED');
        }
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await tx.customerLoyalty.findUnique({ where: { id: customer.id } });
      if (!current) rewardsError('Cliente Rewards no encontrado.', 404, 'REWARDS_CUSTOMER_NOT_FOUND');
      const nextPoints = current.points + params.pointsDelta;
      if (nextPoints < 0) rewardsError('El cliente no tiene puntos suficientes.', 409, 'INSUFFICIENT_REWARD_POINTS');
      const updated = await tx.customerLoyalty.updateMany({
        where: { id: current.id, version: current.version },
        data: { points: nextPoints, version: { increment: 1 } }
      });
      if (updated.count !== 1) continue;
      const entry = await tx.rewardLedgerEntry.create({
        data: {
          restaurantId: params.restaurantId,
          customerLoyaltyId: current.id,
          pointsDelta: params.pointsDelta,
          balanceAfter: nextPoints,
          entryType: params.entryType,
          reason: params.reason,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          ruleVersion: REWARDS_RULE_VERSION,
          idempotencyKey: params.idempotencyKey,
          approvedBy: params.approvedBy || null
        }
      });
      const freshCustomer = await tx.customerLoyalty.findUnique({ where: { id: current.id } });
      return { customer: freshCustomer, entry, idempotentReplay: false };
    }
    rewardsError('No se pudo actualizar el saldo Rewards por concurrencia. Reintentá.', 409, 'REWARDS_CONCURRENCY_RETRY');
  }

  /**
   * Acreditación / ajuste de puntos manual o administrativo.
   */
  static async accrue(params: {
    restaurantId: string;
    phone: string;
    points: number;
    reason: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
    consent?: boolean;
    approvedBy?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const phone = normalizeRewardsPhone(params.phone);
    const reason = boundedText(params.reason, 'reason', 240);
    const idempotencyKey = assertIdempotencyKey(params.idempotencyKey, 'reward-accrual');
    const result = await prisma.$transaction((tx) => this.applyDelta(tx, {
      restaurantId: params.restaurantId,
      phone,
      pointsDelta: params.points,
      entryType: 'ACCRUAL',
      reason,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      idempotencyKey,
      consent: params.consent,
      approvedBy: params.approvedBy,
      allowCreate: true
    }));
    return {
      customer: customerDTO(result.customer),
      entry: ledgerDTO(result.entry),
      idempotentReplay: result.idempotentReplay
    };
  }

  /**
   * Ruta transaccional reutilizable para settlement canónico (settleSessionAccount y settleAndClose).
   * Ejecuta dentro del mismo cliente Prisma tx que persiste AccountSettlement.
   * Monto exclusivamente de consumo (amountMinor, centavos sin propina).
   */
  static async accrueForSettlementTx(tx: any, params: {
    restaurantId: string;
    phone: string;
    amountMinor: number;
    settlementId: string;
    consent?: boolean;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    const config = await tx.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { enableRewards: true, pointsPerHundredPesos: true }
    });
    if (!config?.enableRewards) {
      rewardsError('Rewards no está habilitado para este restaurante.', 409, 'REWARDS_DISABLED');
    }
    const phone = normalizeRewardsPhone(params.phone);
    const points = Math.floor((params.amountMinor / 10000) * Math.max(1, config.pointsPerHundredPesos || 1));
    if (points <= 0) {
      if (params.consent === true) {
        const existing = await tx.customerLoyalty.findUnique({
          where: { restaurantId_phone: { restaurantId: params.restaurantId, phone } }
        });
        if (!existing) {
          await tx.customerLoyalty.create({
            data: { restaurantId: params.restaurantId, phone, consentAt: new Date() }
          });
        } else if (!existing.consentAt) {
          await tx.customerLoyalty.update({
            where: { id: existing.id },
            data: { consentAt: new Date() }
          });
        }
      }
      return null;
    }
    const idempotencyKey = params.idempotencyKey || `reward-settlement-${params.settlementId}`;
    const result = await this.applyDelta(tx, {
      restaurantId: params.restaurantId,
      phone,
      pointsDelta: points,
      entryType: 'ACCRUAL',
      reason: `Consumo liquidado por cuenta (${REWARDS_RULE_VERSION})`,
      referenceType: 'SETTLEMENT',
      referenceId: params.settlementId,
      idempotencyKey,
      consent: params.consent,
      approvedBy: params.approvedBy,
      allowCreate: true
    });
    // Contrato E09: settle y settle-and-close (fresco y replay) exponen
    // pointsEarned entero derivado del ledger existente, sin duplicar filas
    // (applyDelta devuelve la entrada existente en replay).
    return {
      customer: customerDTO(result.customer),
      entry: ledgerDTO(result.entry),
      pointsEarned: result.entry.pointsDelta,
      idempotentReplay: result.idempotentReplay
    };
  }

  /**
   * Acreditación de pago legado (registerManualPayment).
   * Usa amount en pesos (consumo efectivamente pagado, sin propina).
   */
  static async accrueForPayment(params: {
    restaurantId: string;
    phone: string;
    amount: number;
    paymentId: string;
    consent?: boolean;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { enableRewards: true, pointsPerHundredPesos: true }
    });
    if (!config?.enableRewards) return null;
    const phone = normalizeRewardsPhone(params.phone);
    const amount = Number(params.amount);
    const points = Math.floor((amount / 100) * Math.max(1, config.pointsPerHundredPesos || 1));
    if (points <= 0) return null;
    const idempotencyKey = params.idempotencyKey || `reward-payment-${params.paymentId}`;
    return this.accrue({
      restaurantId: params.restaurantId,
      phone,
      points,
      reason: `Consumo cobrado presencialmente (${REWARDS_RULE_VERSION})`,
      referenceType: 'PAYMENT',
      referenceId: params.paymentId,
      idempotencyKey,
      consent: params.consent,
      approvedBy: params.approvedBy
    });
  }

  /**
   * Reconciliación / recuperación de un PaymentTransaction ya confirmado.
   * Permite reintentar la acreditación si un cobro previo retornó rewardsWarning.
   */
  static async reconcilePaymentTransaction(params: {
    restaurantId: string;
    paymentId: string;
    phone: string;
    consent?: boolean;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const phone = normalizeRewardsPhone(params.phone);
    const paymentTx = await prisma.paymentTransaction.findUnique({
      where: { id: params.paymentId },
      include: {
        order: {
          include: {
            tableSession: {
              include: {
                table: true
              }
            }
          }
        }
      }
    });
    if (!paymentTx) {
      rewardsError('Transacción de pago no encontrada.', 404, 'PAYMENT_TRANSACTION_NOT_FOUND');
    }
    const txRestaurantId = paymentTx.order?.tableSession?.table?.restaurantId;
    if (txRestaurantId !== params.restaurantId) {
      rewardsError('El pago no pertenece a este restaurante.', 403, 'STAFF_TENANT_MISMATCH');
    }
    if (paymentTx.status !== 'APPROVED' && paymentTx.status !== 'MANUAL_SETTLED') {
      rewardsError('Sólo se pueden reconciliar pagos confirmados.', 409, 'INVALID_PAYMENT_STATUS');
    }
    const amountPesos = typeof paymentTx.amountMinor === 'number' && paymentTx.amountMinor > 0
      ? paymentTx.amountMinor / 100
      : paymentTx.amount;
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { pointsPerHundredPesos: true }
    });
    const points = Math.floor((amountPesos / 100) * Math.max(1, config?.pointsPerHundredPesos || 1));
    if (points <= 0) {
      rewardsError('El monto del pago no genera puntos Rewards.', 400, 'NO_REWARD_POINTS_FOR_AMOUNT');
    }
    const idempotencyKey = params.idempotencyKey || `reward-payment-${paymentTx.id}`;
    return this.accrue({
      restaurantId: params.restaurantId,
      phone,
      points,
      reason: `Reconciliación de cobro confirmado (${REWARDS_RULE_VERSION})`,
      referenceType: 'PAYMENT',
      referenceId: paymentTx.id,
      idempotencyKey,
      consent: params.consent,
      approvedBy: params.approvedBy
    });
  }

  /**
   * Reconciliación de un AccountSettlement ya confirmado.
   */
  static async reconcileSettlement(params: {
    restaurantId: string;
    settlementId: string;
    phone: string;
    consent?: boolean;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const phone = normalizeRewardsPhone(params.phone);
    const settlement = await prisma.accountSettlement.findUnique({
      where: { id: params.settlementId }
    });
    if (!settlement) {
      rewardsError('Liquidación de cuenta no encontrada.', 404, 'SETTLEMENT_NOT_FOUND');
    }
    if (settlement.restaurantId !== params.restaurantId) {
      rewardsError('La liquidación no pertenece a este restaurante.', 403, 'STAFF_TENANT_MISMATCH');
    }
    if (settlement.status !== 'SETTLED') {
      rewardsError('Sólo se pueden reconciliar liquidaciones confirmadas.', 409, 'INVALID_SETTLEMENT_STATUS');
    }
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { pointsPerHundredPesos: true }
    });
    const points = Math.floor((settlement.amountMinor / 10000) * Math.max(1, config?.pointsPerHundredPesos || 1));
    if (points <= 0) {
      rewardsError('El monto de la liquidación no genera puntos Rewards.', 400, 'NO_REWARD_POINTS_FOR_AMOUNT');
    }
    const idempotencyKey = params.idempotencyKey || `reward-settlement-${settlement.id}`;
    return this.accrue({
      restaurantId: params.restaurantId,
      phone,
      points,
      reason: `Reconciliación de liquidación confirmada (${REWARDS_RULE_VERSION})`,
      referenceType: 'SETTLEMENT',
      referenceId: settlement.id,
      idempotencyKey,
      consent: params.consent,
      approvedBy: params.approvedBy
    });
  }

  /**
   * Reversión de un movimiento de ledger (ACCRUAL).
   * Requiere motivo obligatorio.
   * NUNCA crea cuentas inexistentes. Es idempotente y evita doble reversión.
   */
  static async reverse(params: {
    restaurantId: string;
    originalLedgerId: string;
    reason: string;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const original = await prisma.rewardLedgerEntry.findFirst({
      where: { id: params.originalLedgerId, restaurantId: params.restaurantId },
      include: { customerLoyalty: true }
    });
    if (!original) rewardsError('Movimiento Rewards no encontrado.', 404, 'REWARDS_LEDGER_NOT_FOUND');
    if (original.pointsDelta <= 0) rewardsError('Sólo se pueden revertir acreditaciones positivas.', 409, 'REWARDS_REVERSAL_INVALID');
    const reason = boundedText(params.reason, 'reason', 240);
    const idempotencyKey = assertIdempotencyKey(params.idempotencyKey, `reward-reversal-${original.id}`);

    const existingReversal = await prisma.rewardLedgerEntry.findFirst({
      where: {
        restaurantId: params.restaurantId,
        referenceType: 'LEDGER_ENTRY',
        referenceId: original.id,
        entryType: 'REVERSAL'
      },
      include: { customerLoyalty: true }
    });
    if (existingReversal) {
      if (existingReversal.idempotencyKey === idempotencyKey) {
        return {
          customer: customerDTO(existingReversal.customerLoyalty),
          entry: ledgerDTO(existingReversal),
          idempotentReplay: true
        };
      }
      rewardsError('El movimiento ya fue revertido previamente.', 409, 'REWARDS_ALREADY_REVERSED');
    }

    const result = await prisma.$transaction((tx) => this.applyDelta(tx, {
      restaurantId: params.restaurantId,
      phone: original.customerLoyalty.phone,
      pointsDelta: -original.pointsDelta,
      entryType: 'REVERSAL',
      reason,
      referenceType: 'LEDGER_ENTRY',
      referenceId: original.id,
      idempotencyKey,
      consent: false,
      approvedBy: params.approvedBy,
      allowCreate: false
    }));
    return {
      customer: customerDTO(result.customer),
      entry: ledgerDTO(result.entry),
      idempotentReplay: result.idempotentReplay
    };
  }

  static async reversePayment(params: {
    restaurantId: string;
    paymentId: string;
    reason: string;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const entry = await prisma.rewardLedgerEntry.findFirst({
      where: {
        restaurantId: params.restaurantId,
        referenceType: 'PAYMENT',
        referenceId: params.paymentId,
        entryType: 'ACCRUAL'
      }
    });
    if (!entry) {
      rewardsError('Acreditación por cobro no encontrada para revertir.', 404, 'REWARDS_LEDGER_NOT_FOUND');
    }
    return this.reverse({
      restaurantId: params.restaurantId,
      originalLedgerId: entry.id,
      reason: params.reason,
      approvedBy: params.approvedBy,
      idempotencyKey: params.idempotencyKey
    });
  }

  static async reverseSettlement(params: {
    restaurantId: string;
    settlementId: string;
    reason: string;
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const entry = await prisma.rewardLedgerEntry.findFirst({
      where: {
        restaurantId: params.restaurantId,
        referenceType: 'SETTLEMENT',
        referenceId: params.settlementId,
        entryType: 'ACCRUAL'
      }
    });
    if (!entry) {
      rewardsError('Acreditación por liquidación no encontrada para revertir.', 404, 'REWARDS_LEDGER_NOT_FOUND');
    }
    return this.reverse({
      restaurantId: params.restaurantId,
      originalLedgerId: entry.id,
      reason: params.reason,
      approvedBy: params.approvedBy,
      idempotencyKey: params.idempotencyKey
    });
  }

  /**
   * Revierte de forma proporcional el consumo Rewards asociado a un ajuste de
   * AccountSettlement. Cada ajuste tiene su propia clave idempotente y el
   * objetivo acumulado se calcula sobre el consumo devuelto, por lo que dos
   * devoluciones parciales no revierten dos veces el mismo punto.
   *
   * Si Rewards está apagado o el settlement no tenía acreditación, no hay
   * nada que revertir. Si el cliente ya gastó los puntos, applyDelta conserva
   * el saldo no negativo y el llamador puede devolver una advertencia segura.
   */
  static async reverseSettlementAdjustment(params: {
    restaurantId: string;
    settlementId: string;
    adjustmentId: string;
    amountMinor: number;
    reason: string;
    approvedBy?: string;
  }) {
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { enableRewards: true }
    });
    if (!config?.enableRewards || params.amountMinor <= 0) return null;

    const original = await prisma.rewardLedgerEntry.findFirst({
      where: {
        restaurantId: params.restaurantId,
        referenceType: 'SETTLEMENT',
        referenceId: params.settlementId,
        entryType: 'ACCRUAL'
      },
      include: { customerLoyalty: true },
      orderBy: { createdAt: 'asc' }
    });
    if (!original || original.pointsDelta <= 0) return null;

    const idempotencyKey = `reward-settlement-adjustment-${params.adjustmentId}`;
    const existing = await prisma.rewardLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const customer = await prisma.customerLoyalty.findUnique({ where: { id: existing.customerLoyaltyId } });
      return customer ? {
        customer: customerDTO(customer),
        entry: ledgerDTO(existing),
        pointsReversed: Math.abs(existing.pointsDelta),
        idempotentReplay: true
      } : null;
    }

    const settlement = await prisma.accountSettlement.findUnique({
      where: { id: params.settlementId },
      select: { amountMinor: true }
    });
    if (!settlement || settlement.amountMinor <= 0) return null;

    const adjustments = await prisma.paymentAdjustment.findMany({
      where: { settlementId: params.settlementId },
      select: { id: true, amountMinor: true }
    });
    const adjustmentIds = adjustments.map((adjustment) => adjustment.id);
    const priorReversals = adjustmentIds.length === 0 ? [] : await prisma.rewardLedgerEntry.findMany({
      where: {
        restaurantId: params.restaurantId,
        referenceType: 'PAYMENT_ADJUSTMENT',
        referenceId: { in: adjustmentIds },
        entryType: 'REVERSAL'
      },
      select: { pointsDelta: true }
    });
    const alreadyReversed = priorReversals.reduce((sum, entry) => sum + Math.abs(entry.pointsDelta), 0);
    const refundedConsumption = adjustments.reduce((sum, adjustment) => sum + adjustment.amountMinor, 0);
    const targetReversal = Math.min(
      original.pointsDelta,
      Math.floor((original.pointsDelta * refundedConsumption) / settlement.amountMinor)
    );
    const pointsToReverse = targetReversal - alreadyReversed;
    if (pointsToReverse <= 0) return null;

    const reason = boundedText(params.reason, 'reason', 240);
    const result = await prisma.$transaction((tx) => this.applyDelta(tx, {
      restaurantId: params.restaurantId,
      phone: original.customerLoyalty.phone,
      pointsDelta: -pointsToReverse,
      entryType: 'REVERSAL',
      reason,
      referenceType: 'PAYMENT_ADJUSTMENT',
      referenceId: params.adjustmentId,
      idempotencyKey,
      consent: false,
      approvedBy: params.approvedBy,
      allowCreate: false
    }));
    return {
      customer: customerDTO(result.customer),
      entry: ledgerDTO(result.entry),
      pointsReversed: pointsToReverse,
      idempotentReplay: result.idempotentReplay
    };
  }

  static async listRewardItems(restaurantId: string, includeUnavailable = false) {
    return prisma.rewardItem.findMany({
      where: { restaurantId, ...(includeUnavailable ? {} : { isAvailable: true }) },
      orderBy: { createdAt: 'asc' }
    });
  }

  static async createRewardItem(params: {
    restaurantId: string;
    name: string;
    description?: string;
    pointsCost: number;
  }) {
    const name = boundedText(params.name, 'name', 120);
    if (name.length < 2) rewardsError('El nombre del premio no es válido.', 400, 'INVALID_REWARD_ITEM');
    if (!Number.isInteger(params.pointsCost) || params.pointsCost <= 0 || params.pointsCost > 1_000_000) {
      rewardsError('El costo en puntos no es válido.', 400, 'INVALID_REWARD_POINTS_COST');
    }
    return prisma.rewardItem.create({
      data: {
        restaurantId: params.restaurantId,
        name,
        description: params.description ? boundedText(params.description, 'description', 300) : null,
        pointsCost: params.pointsCost
      }
    });
  }

  static async redeem(params: {
    restaurantId: string;
    phone: string;
    rewardItemId: string;
    approvedBy: string;
    idempotencyKey?: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const phone = normalizeRewardsPhone(params.phone);
    const idempotencyKey = assertIdempotencyKey(params.idempotencyKey, 'reward-redemption');
    const existing = await prisma.rewardRedemption.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const customer = await prisma.customerLoyalty.findUnique({ where: { id: existing.customerLoyaltyId } });
      if (!customer || customer.restaurantId !== params.restaurantId || customer.phone !== phone) {
        rewardsError('La clave de idempotencia ya fue utilizada para otro restaurante o cliente.', 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      return { redemption: existing, customer: customerDTO(customer), idempotentReplay: true };
    }
    const rewardItemId = boundedText(params.rewardItemId, 'rewardItemId', 100);
    const item = await prisma.rewardItem.findFirst({ where: { id: rewardItemId, restaurantId: params.restaurantId, isAvailable: true } });
    if (!item) rewardsError('Premio Rewards no encontrado o no disponible.', 404, 'REWARD_ITEM_NOT_FOUND');
    const existingCustomer = await prisma.customerLoyalty.findUnique({
      where: { restaurantId_phone: { restaurantId: params.restaurantId, phone } }
    });
    if (!existingCustomer) rewardsError('El cliente todavía no tiene una cuenta Rewards.', 404, 'REWARDS_CUSTOMER_NOT_FOUND');
    if (!existingCustomer.consentAt) rewardsError('El cliente debe aceptar Rewards antes de canjear puntos.', 409, 'REWARDS_CONSENT_REQUIRED');
    if (existingCustomer.points < item.pointsCost) rewardsError('El cliente no tiene puntos suficientes.', 409, 'INSUFFICIENT_REWARD_POINTS');

    const result = await prisma.$transaction(async (tx) => {
      const delta = await this.applyDelta(tx, {
        restaurantId: params.restaurantId,
        phone,
        pointsDelta: -item.pointsCost,
        entryType: 'REDEMPTION',
        reason: `Canje: ${item.name}`,
        referenceType: 'REWARD_REDEMPTION',
        idempotencyKey: `reward-ledger-${idempotencyKey}`,
        consent: false,
        approvedBy: params.approvedBy,
        allowCreate: false
      });
      const redemption = await tx.rewardRedemption.create({
        data: {
          customerLoyaltyId: delta.customer.id,
          rewardItemId: item.id,
          pointsCost: item.pointsCost,
          status: 'REDEEMED',
          idempotencyKey,
          approvedBy: params.approvedBy,
          redeemedAt: new Date()
        }
      });
      return { redemption, customer: delta.customer, idempotentReplay: false };
    });
    return { ...result, customer: customerDTO(result.customer) };
  }

  static async cancelRedemption(params: {
    restaurantId: string;
    redemptionId: string;
    approvedBy: string;
    reason: string;
  }) {
    await this.assertEnabled(params.restaurantId);
    const reason = boundedText(params.reason, 'reason', 240);
    const redemption = await prisma.rewardRedemption.findFirst({
      where: { id: params.redemptionId, customerLoyalty: { restaurantId: params.restaurantId } },
      include: { customerLoyalty: true, rewardItem: true }
    });
    if (!redemption) rewardsError('Canje Rewards no encontrado.', 404, 'REDEMPTION_NOT_FOUND');
    if (redemption.status === 'CANCELLED') {
      const replayEntry = await prisma.rewardLedgerEntry.findUnique({ where: { idempotencyKey: `reward-redemption-cancel-${redemption.id}` } });
      const customer = await prisma.customerLoyalty.findUnique({ where: { id: redemption.customerLoyaltyId } });
      if (replayEntry && customer) return { redemption, customer: customerDTO(customer), entry: ledgerDTO(replayEntry), idempotentReplay: true };
      rewardsError('El canje ya fue cancelado.', 409, 'REDEMPTION_NOT_ACTIVE');
    }
    if (redemption.status !== 'REDEEMED') rewardsError('El canje no está activo.', 409, 'REDEMPTION_NOT_ACTIVE');
    const result = await prisma.$transaction(async (tx) => {
      const delta = await this.applyDelta(tx, {
        restaurantId: params.restaurantId,
        phone: redemption.customerLoyalty.phone,
        pointsDelta: redemption.pointsCost,
        entryType: 'REVERSAL',
        reason,
        referenceType: 'REWARD_REDEMPTION',
        referenceId: redemption.id,
        idempotencyKey: `reward-redemption-cancel-${redemption.id}`,
        consent: false,
        approvedBy: params.approvedBy,
        allowCreate: false
      });
      const updated = await tx.rewardRedemption.update({
        where: { id: redemption.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), approvedBy: params.approvedBy }
      });
      return { redemption: updated, customer: delta.customer, entry: delta.entry };
    });
    return { ...result, customer: customerDTO(result.customer), entry: ledgerDTO(result.entry), idempotentReplay: false };
  }
}
