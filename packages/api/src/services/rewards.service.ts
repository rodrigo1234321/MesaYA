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
 * del formato escrito por el cliente o el mozo. Nunca devuelve el teléfono
 * parcialmente normalizado: entradas cortas o ambiguas se rechazan.
 */
export function normalizeRewardsPhone(raw: string): string {
  if (typeof raw !== 'string') rewardsError('El teléfono es obligatorio.', 400, 'INVALID_REWARDS_PHONE');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (digits.startsWith('15')) digits = digits.substring(2);
  if (!digits.startsWith('54')) digits = `549${digits}`;
  else if (!digits.startsWith('549')) digits = `549${digits.substring(2)}`;
  if (!/^549\d{8,12}$/.test(digits)) {
    rewardsError('El teléfono debe tener un formato válido para Rewards.', 400, 'INVALID_REWARDS_PHONE');
  }
  return `+${digits}`;
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

function customerDTO(customer: any): RewardsCustomerDTO {
  return {
    id: customer.id,
    restaurantId: customer.restaurantId,
    phone: customer.phone,
    points: customer.points,
    consentAt: customer.consentAt?.toISOString?.() || customer.consentAt || null,
    verifiedAt: customer.verifiedAt?.toISOString?.() || customer.verifiedAt || null,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString()
  };
}

function ledgerDTO(entry: any): RewardsLedgerDTO {
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
    createdAt: entry.createdAt.toISOString()
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

  static async getOrCreateCustomer(restaurantId: string, rawPhone: string, consent = false) {
    const phone = normalizeRewardsPhone(rawPhone);
    const now = consent ? new Date() : undefined;
    const customer = await prisma.customerLoyalty.upsert({
      where: { restaurantId_phone: { restaurantId, phone } },
      create: { restaurantId, phone, ...(now ? { consentAt: now } : {}) },
      update: now ? { consentAt: now } : {}
    });
    return customerDTO(customer);
  }

  static async getBalance(restaurantId: string, rawPhone: string, includeLedger = true) {
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

  private static async ensureCustomer(tx: any, restaurantId: string, phone: string, consent = true) {
    return tx.customerLoyalty.upsert({
      where: { restaurantId_phone: { restaurantId, phone } },
      create: { restaurantId, phone, ...(consent ? { consentAt: new Date() } : {}) },
      update: consent ? { consentAt: new Date() } : {}
    });
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
      return { customer, entry: existing, idempotentReplay: true };
    }

    const customer = await this.ensureCustomer(tx, params.restaurantId, params.phone, params.consent !== false);
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
          idempotencyKey: params.idempotencyKey
        }
      });
      const freshCustomer = await tx.customerLoyalty.findUnique({ where: { id: current.id } });
      return { customer: freshCustomer, entry, idempotentReplay: false };
    }
    rewardsError('No se pudo actualizar el saldo Rewards por concurrencia. Reintentá.', 409, 'REWARDS_CONCURRENCY_RETRY');
  }

  static async accrue(params: {
    restaurantId: string;
    phone: string;
    points: number;
    reason: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
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
      idempotencyKey
    }));
    return {
      customer: customerDTO(result.customer),
      entry: ledgerDTO(result.entry),
      idempotentReplay: result.idempotentReplay
    };
  }

  static async accrueForPayment(params: {
    restaurantId: string;
    phone: string;
    amount: number;
    paymentId: string;
  }) {
    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: params.restaurantId },
      select: { enableRewards: true, pointsPerHundredPesos: true }
    });
    if (!config?.enableRewards) return null;
    const amount = Number(params.amount);
    const points = Math.floor((amount / 100) * Math.max(1, config.pointsPerHundredPesos || 1));
    if (points <= 0) return null;
    return this.accrue({
      restaurantId: params.restaurantId,
      phone: params.phone,
      points,
      reason: `Consumo cobrado presencialmente (${REWARDS_RULE_VERSION})`,
      referenceType: 'PAYMENT',
      referenceId: params.paymentId,
      idempotencyKey: `reward-payment-${params.paymentId}`
    });
  }

  static async reverse(params: {
    restaurantId: string;
    originalLedgerId: string;
    reason: string;
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
    const result = await prisma.$transaction((tx) => this.applyDelta(tx, {
      restaurantId: params.restaurantId,
      phone: original.customerLoyalty.phone,
      pointsDelta: -original.pointsDelta,
      entryType: 'REVERSAL',
      reason,
      referenceType: 'LEDGER_ENTRY',
      referenceId: original.id,
      idempotencyKey,
      consent: false
    }));
    return { customer: customerDTO(result.customer), entry: ledgerDTO(result.entry), idempotentReplay: result.idempotentReplay };
  }

  static async listRewardItems(restaurantId: string, includeUnavailable = false) {
    return prisma.rewardItem.findMany({
      where: { restaurantId, ...(includeUnavailable ? {} : { isAvailable: true }) },
      orderBy: { createdAt: 'asc' }
    });
  }

  static async createRewardItem(params: { restaurantId: string; name: string; description?: string; pointsCost: number }) {
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
      if (!customer || customer.restaurantId !== params.restaurantId) {
        rewardsError('La clave de idempotencia ya fue utilizada para otro restaurante.', 409, 'IDEMPOTENCY_KEY_REUSED');
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
    const result = await prisma.$transaction(async (tx) => {
      const delta = await this.applyDelta(tx, {
        restaurantId: params.restaurantId,
        phone,
        pointsDelta: -item.pointsCost,
        entryType: 'REDEMPTION',
        reason: `Canje: ${item.name}`,
        referenceType: 'REWARD_REDEMPTION',
        idempotencyKey: `reward-ledger-${idempotencyKey}`,
        consent: false
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

  static async cancelRedemption(params: { restaurantId: string; redemptionId: string; approvedBy: string; reason: string }) {
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
        consent: false
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
