import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { isRestaurantInConfiguredInstance } from '../lib/environment';
import {
  PaymentMode,
  RestaurantModuleConfigDTO,
  UpdateModuleConfigDTO,
  ModuleConfigAuditDTO,
  CapabilityState,
  CapabilityKey,
  CapabilityEntry,
  RestaurantCapabilitiesDTO,
  DEFAULT_REVIEW_QUANTITY_THRESHOLD
} from '@mesaya/shared';

/** Error de dominio para evitar activar capacidades sin recorrido operativo completo. */
export class CapabilityConfigurationError extends Error {
  readonly statusCode = 409;
  readonly code = 'CAPABILITY_NOT_AVAILABLE';
  readonly capability: CapabilityKey;
  readonly field: string;

  constructor(field: string, capability: CapabilityKey, message: string) {
    super(message);
    this.name = 'CapabilityConfigurationError';
    this.field = field;
    this.capability = capability;
  }
}

/** Valida sólo activaciones nuevas; apagar o conservar un flag legado sigue permitido. */
export function validateCapabilityUpdate(
  current: RestaurantModuleConfigDTO,
  dto: UpdateModuleConfigDTO
): void {
  if (dto.reviewQuantityThreshold !== undefined && (
    !Number.isInteger(dto.reviewQuantityThreshold) ||
    dto.reviewQuantityThreshold < 2 ||
    dto.reviewQuantityThreshold > 50
  )) {
    const error: any = new Error('El umbral de revisión debe ser un entero entre 2 y 50 unidades por línea.');
    error.statusCode = 400;
    error.code = 'INVALID_REVIEW_QUANTITY_THRESHOLD';
    throw error;
  }

  if (dto.enableWaitlistPreOrder === true && dto.enableWaitlist === false) {
    throw new CapabilityConfigurationError(
      'enableWaitlistPreOrder',
      'waitlist_preorder',
      'El pre-pedido requiere que la fila virtual esté habilitada.'
    );
  }

  const blockedTransitions: Array<{
    field: keyof UpdateModuleConfigDTO;
    capability: CapabilityKey;
    label: string;
  }> = [
    { field: 'allowSplitBill', capability: 'split_bill', label: 'la división de cuenta' },
    // Las propinas presenciales ya tienen selector de sugerencia y registro en caja.
  ];

  for (const transition of blockedTransitions) {
    const requested = dto[transition.field];
    const previous = current[transition.field as keyof RestaurantModuleConfigDTO];
    if (requested === true && previous !== true) {
      throw new CapabilityConfigurationError(
        String(transition.field),
        transition.capability,
        `No se puede activar ${transition.label}: el producto base todavía no expone un recorrido operativo completo.`
      );
    }
  }

}

export class ConfigService {
  /**
   * Obtiene la configuración pública de módulos de un restaurante para el comensal.
   * SEGURIDAD: Whitelist select estricto. NUNCA expone credenciales ni datos sensibles.
   */
  static async getPublicConfig(restaurantSlug: string): Promise<RestaurantModuleConfigDTO | null> {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: restaurantSlug },
      select: {
        id: true,
        moduleConfig: {
          select: {
            id: true,
            restaurantId: true,
            paymentMode: true,
            allowSplitBill: true,
            allowWaitersToCollectCash: true,
            allowOrdering: true,
            syncSocialCart: true,
            requireWaiterValidation: true,
            reviewQuantityThreshold: true,
            enableUpsell: true,
            enableSmartTips: true,
            suggestedTipPercentages: true,
            enableReviews: true,
            googlePlaceId: true,
            enableWaitlist: true,
            enableWaitlistPreOrder: true,
            enableRewards: true,
            pointsPerHundredPesos: true
          }
        }
      }
    });

    if (!restaurant || !isRestaurantInConfiguredInstance(restaurant.id)) return null;

    // Si el restaurante aún no tiene configuración modular, inicializar con defaults
    if (!restaurant.moduleConfig) {
      // Upsert evita que dos primeros clientes creen la configuración dos veces
      // cuando una instancia nueva recibe tráfico concurrente.
      const created = await prisma.restaurantModuleConfig.upsert({
        where: { restaurantId: restaurant.id },
        create: {
          restaurantId: restaurant.id,
          paymentMode: PaymentMode.WAITER_ONLY,
          allowSplitBill: false,
          allowWaitersToCollectCash: false,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: false,
          reviewQuantityThreshold: DEFAULT_REVIEW_QUANTITY_THRESHOLD,
          enableUpsell: true,
          enableSmartTips: true,
          suggestedTipPercentages: JSON.stringify([10, 15, 20]),
          enableReviews: true,
          googlePlaceId: null,
          enableWaitlist: false,
          enableWaitlistPreOrder: false,
          enableRewards: false,
          pointsPerHundredPesos: 1
        },
        update: {},
        select: {
          id: true,
          restaurantId: true,
          paymentMode: true,
          allowSplitBill: true,
          allowWaitersToCollectCash: true,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
          reviewQuantityThreshold: true,
          enableUpsell: true,
          enableSmartTips: true,
          suggestedTipPercentages: true,
          enableReviews: true,
          googlePlaceId: true,
          enableWaitlist: true,
          enableWaitlistPreOrder: true,
          enableRewards: true,
          pointsPerHundredPesos: true
        }
      });

      const parsed: RestaurantModuleConfigDTO = {
        ...created,
        paymentMode: created.paymentMode as PaymentMode,
        suggestedTipPercentages: JSON.parse(created.suggestedTipPercentages)
      };
      return { ...parsed, capabilities: this.buildCapabilities(parsed).capabilities };
    }

    const parsed: RestaurantModuleConfigDTO = {
      ...restaurant.moduleConfig,
      paymentMode: restaurant.moduleConfig.paymentMode as PaymentMode,
      suggestedTipPercentages: JSON.parse(restaurant.moduleConfig.suggestedTipPercentages)
    };
    return { ...parsed, capabilities: this.buildCapabilities(parsed).capabilities };
  }

  /**
   * Obtiene la configuración para el panel administrativo por restaurantId o slug.
   */
  static async getAdminConfig(restaurantIdOrSlug: string): Promise<RestaurantModuleConfigDTO> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      throw new Error(`Restaurante "${restaurantIdOrSlug}" no encontrado`);
    }

    const restaurantId = restaurant.id;

    let config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId },
      select: {
        id: true,
        restaurantId: true,
        paymentMode: true,
        allowSplitBill: true,
        allowWaitersToCollectCash: true,
        allowOrdering: true,
        syncSocialCart: true,
        requireWaiterValidation: true,
        reviewQuantityThreshold: true,
        enableUpsell: true,
        enableSmartTips: true,
        suggestedTipPercentages: true,
        enableReviews: true,
        googlePlaceId: true,
        enableWaitlist: true,
        enableWaitlistPreOrder: true,
        enableRewards: true,
        pointsPerHundredPesos: true
      }
    });

    if (!config) {
      config = await prisma.restaurantModuleConfig.upsert({
        where: { restaurantId },
        create: {
          restaurantId,
          paymentMode: PaymentMode.WAITER_ONLY,
          allowSplitBill: false,
          allowWaitersToCollectCash: false,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: false,
          reviewQuantityThreshold: DEFAULT_REVIEW_QUANTITY_THRESHOLD,
          enableUpsell: true,
          enableSmartTips: true,
          suggestedTipPercentages: JSON.stringify([10, 15, 20]),
          enableReviews: true,
          googlePlaceId: null,
          enableWaitlist: false,
          enableWaitlistPreOrder: false,
          enableRewards: false,
          pointsPerHundredPesos: 1
        },
        update: {},
        select: {
          id: true,
          restaurantId: true,
          paymentMode: true,
          allowSplitBill: true,
          allowWaitersToCollectCash: true,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
          reviewQuantityThreshold: true,
          enableUpsell: true,
          enableSmartTips: true,
          suggestedTipPercentages: true,
          enableReviews: true,
          googlePlaceId: true,
          enableWaitlist: true,
          enableWaitlistPreOrder: true,
          enableRewards: true,
          pointsPerHundredPesos: true
        }
      });
    }

    const parsed: RestaurantModuleConfigDTO = {
      ...config,
      paymentMode: config.paymentMode as PaymentMode,
      suggestedTipPercentages: JSON.parse(config.suggestedTipPercentages)
    };
    return { ...parsed, capabilities: this.buildCapabilities(parsed).capabilities };
  }

  /**
   * Actualiza la configuración de módulos de forma transaccional junto con el log de auditoría.
   * Emite evento SSE a comensales y staff.
   */
  static async updateConfigTransacted(
    restaurantIdOrSlug: string,
    dto: UpdateModuleConfigDTO,
    changedBy: string = 'ADMIN'
  ): Promise<RestaurantModuleConfigDTO> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      throw new Error(`Restaurante "${restaurantIdOrSlug}" no encontrado`);
    }

    const restaurantId = restaurant.id;
    const current = await this.getAdminConfig(restaurantId);

    validateCapabilityUpdate(current, dto);

    // Identificar cambios para auditoría
    const auditEntries: { changedField: string; oldValue: string | null; newValue: string | null }[] = [];

    const keysToTrack: (keyof UpdateModuleConfigDTO)[] = [
      'paymentMode',
      'allowSplitBill',
      'allowWaitersToCollectCash',
      'allowOrdering',
      'syncSocialCart',
      'requireWaiterValidation',
      'reviewQuantityThreshold',
      'enableUpsell',
      'enableSmartTips',
      'suggestedTipPercentages',
      'enableReviews',
      'googlePlaceId',
      'enableWaitlist',
      'enableWaitlistPreOrder',
      'enableRewards',
      'pointsPerHundredPesos'
    ];

    for (const key of keysToTrack) {
      if (dto[key] !== undefined) {
        const oldValStr = JSON.stringify(current[key as keyof RestaurantModuleConfigDTO] ?? null);
        const newValStr = JSON.stringify(dto[key]);
        if (oldValStr !== newValStr) {
          auditEntries.push({
            changedField: String(key),
            oldValue: oldValStr,
            newValue: newValStr
          });
        }
      }
    }

    // Ejecutar actualización y auditoría dentro de una transacción atómica
    const updated = await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};

      if (dto.paymentMode !== undefined) updateData.paymentMode = dto.paymentMode;
      if (dto.allowSplitBill !== undefined) updateData.allowSplitBill = dto.allowSplitBill;
      if (dto.allowWaitersToCollectCash !== undefined) updateData.allowWaitersToCollectCash = dto.allowWaitersToCollectCash;
      if (dto.allowOrdering !== undefined) updateData.allowOrdering = dto.allowOrdering;
      if (dto.syncSocialCart !== undefined) updateData.syncSocialCart = dto.syncSocialCart;
      if (dto.requireWaiterValidation !== undefined) updateData.requireWaiterValidation = dto.requireWaiterValidation;
      if (dto.reviewQuantityThreshold !== undefined) updateData.reviewQuantityThreshold = dto.reviewQuantityThreshold;
      if (dto.enableUpsell !== undefined) updateData.enableUpsell = dto.enableUpsell;
      if (dto.enableSmartTips !== undefined) updateData.enableSmartTips = dto.enableSmartTips;
      if (dto.suggestedTipPercentages !== undefined) {
        updateData.suggestedTipPercentages = JSON.stringify(dto.suggestedTipPercentages);
      }
      if (dto.enableReviews !== undefined) updateData.enableReviews = dto.enableReviews;
      if (dto.googlePlaceId !== undefined) updateData.googlePlaceId = dto.googlePlaceId;
      if (dto.enableWaitlist !== undefined) updateData.enableWaitlist = dto.enableWaitlist;
      if (dto.enableWaitlistPreOrder !== undefined) updateData.enableWaitlistPreOrder = dto.enableWaitlistPreOrder;
      if (dto.enableRewards !== undefined) updateData.enableRewards = dto.enableRewards;
      if (dto.pointsPerHundredPesos !== undefined) updateData.pointsPerHundredPesos = dto.pointsPerHundredPesos;

      const res = await tx.restaurantModuleConfig.update({
        where: { restaurantId },
        data: updateData,
        select: {
          id: true,
          restaurantId: true,
          paymentMode: true,
          allowSplitBill: true,
          allowWaitersToCollectCash: true,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
          reviewQuantityThreshold: true,
          enableUpsell: true,
          enableSmartTips: true,
          suggestedTipPercentages: true,
          enableReviews: true,
          googlePlaceId: true,
          enableWaitlist: true,
          enableWaitlistPreOrder: true,
          enableRewards: true,
          pointsPerHundredPesos: true
        }
      });

      // Insertar auditoría
      if (auditEntries.length > 0) {
        await tx.restaurantModuleConfigAudit.createMany({
          data: auditEntries.map((entry) => ({
            restaurantId,
            changedBy,
            changedField: entry.changedField,
            oldValue: entry.oldValue,
            newValue: entry.newValue
          }))
        });
      }

      return res;
    });

    const parsedDTO: RestaurantModuleConfigDTO = {
      ...updated,
      paymentMode: updated.paymentMode as PaymentMode,
      suggestedTipPercentages: JSON.parse(updated.suggestedTipPercentages)
    };

    // Emitir evento via eventBus (SSE deshabilitado; eventBus es no-op)
    const response = {
      ...parsedDTO,
      capabilities: this.buildCapabilities(parsedDTO).capabilities
    };
    eventBus.broadcast(restaurantId, 'config.updated', response);

    return response;
  }

  /**
   * Construye el mapa de capacidades efectivas a partir de la configuración almacenada.
   * SEPARA la disponibilidad real de los flags persistidos para evitar que
   * consumidores interpreten "habilitado en DB" como "funcional en el producto".
   *
   * SEGURIDAD: No expone credenciales, secretos ni datos de pago.
   * Sólo refleja estado operativo codificado estáticamente.
   */
  static buildCapabilities(config: RestaurantModuleConfigDTO): RestaurantCapabilitiesDTO {
    const caps: Record<CapabilityKey, CapabilityEntry> = {
      ordering: {
        key: 'ordering',
        label: 'Pedidos desde la mesa',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.allowOrdering,
        effectiveEnabled: config.allowOrdering,
        reasonCode: config.allowOrdering ? 'ORDERING_ENABLED' : 'ORDERING_DISABLED_BY_CONFIG',
        message: config.allowOrdering
          ? 'El comensal puede generar comandas desde su celular.'
          : 'El módulo de pedidos está deshabilitado por el administrador.'
      },
      waiter_validation: {
        key: 'waiter_validation',
        label: 'Validación por mozo',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.requireWaiterValidation,
        effectiveEnabled: config.requireWaiterValidation,
        reasonCode: config.requireWaiterValidation ? 'WAITER_VALIDATION_ACTIVE' : 'WAITER_VALIDATION_OPTIONAL',
        message: config.requireWaiterValidation
          ? 'Modo manual activo: todas las comandas esperan al mozo antes de cocina.'
          : `Las comandas normales van directo a cocina; sólo se revisan excepciones (más de ${config.reviewQuantityThreshold ?? DEFAULT_REVIEW_QUANTITY_THRESHOLD} unidades o stock cambiado).`
      },
      manual_payment: {
        key: 'manual_payment',
        label: 'Cobro presencial en caja',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: true,
        effectiveEnabled: true,
        reasonCode: 'MANUAL_PAYMENT_ACTIVE',
        message: 'La caja presencial permite registrar efectivo, tarjeta, propina y liberar la mesa.'
      },
      digital_payment: {
        key: 'digital_payment',
        label: 'Opción Mercado Pago informativa',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.paymentMode !== PaymentMode.WAITER_ONLY,
        effectiveEnabled: config.paymentMode !== PaymentMode.WAITER_ONLY,
        reasonCode: config.paymentMode !== PaymentMode.WAITER_ONLY
          ? 'DIGITAL_PAYMENT_OPTION_ACTIVE'
          : 'DIGITAL_PAYMENT_OPTION_DISABLED',
        message: config.paymentMode !== PaymentMode.WAITER_ONLY
          ? 'Se muestra Mercado Pago como opción para el comensal; el cobro se confirma presencialmente por el personal.'
          : 'La opción Mercado Pago no se muestra al comensal. El cobro presencial sigue activo.'
      },
      waiter_cash_collection: {
        key: 'waiter_cash_collection',
        label: 'Cobro en efectivo por mozos',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: Boolean(config.allowWaitersToCollectCash),
        effectiveEnabled: Boolean(config.allowWaitersToCollectCash),
        reasonCode: config.allowWaitersToCollectCash ? 'WAITER_CASH_ENABLED' : 'WAITER_CASH_DISABLED',
        message: config.allowWaitersToCollectCash
          ? 'Los mozos pueden liquidar cuentas en efectivo sin pedir PIN de encargado.'
          : 'El cobro presencial requiere autorización de encargado para cada operación.'
      },
      split_bill: {
        key: 'split_bill',
        label: 'División de cuenta',
        state: CapabilityState.COMING_SOON,
        configuredEnabled: config.allowSplitBill,
        effectiveEnabled: false,
        reasonCode: 'SPLIT_BILL_UNAVAILABLE',
        message: 'La división de cuenta entre comensales aún no está disponible.'
      },
      waitlist: {
        key: 'waitlist',
        label: 'Fila virtual',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.enableWaitlist,
        effectiveEnabled: config.enableWaitlist,
        reasonCode: config.enableWaitlist ? 'WAITLIST_ACTIVE' : 'WAITLIST_DISABLED',
        message: config.enableWaitlist
          ? 'Ingreso público, estado del ticket y gestión del staff están activos.'
          : 'La fila virtual no está habilitada.'
      },
      waitlist_preorder: {
        key: 'waitlist_preorder',
        label: 'Pre-pedido en fila virtual',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.enableWaitlist && config.enableWaitlistPreOrder,
        effectiveEnabled: config.enableWaitlist && config.enableWaitlistPreOrder,
        reasonCode: config.enableWaitlist && config.enableWaitlistPreOrder
          ? 'WAITLIST_PREORDER_ACTIVE'
          : config.enableWaitlist
            ? 'WAITLIST_PREORDER_DISABLED'
            : 'WAITLIST_DISABLED',
        message: config.enableWaitlist && config.enableWaitlistPreOrder
          ? 'El pre-pedido se valida contra la carta y se convierte en comanda al sentar al grupo.'
          : 'El pre-pedido está deshabilitado para este restaurante.'
      },
      rewards: {
        key: 'rewards',
        label: 'Programa Rewards',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.enableRewards,
        effectiveEnabled: config.enableRewards,
        reasonCode: config.enableRewards ? 'REWARDS_LEDGER_ACTIVE' : 'REWARDS_DISABLED',
        message: config.enableRewards
          ? 'Ledger, acreditación al cobro manual y canje autorizado están activos.'
          : 'El programa de fidelización Rewards está deshabilitado.'
      },
      upsell: {
        key: 'upsell',
        label: 'Sugerencias de upsell',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.enableUpsell,
        effectiveEnabled: config.enableUpsell,
        reasonCode: config.enableUpsell ? 'UPSELL_CLIENT_CONSUMED' : 'UPSELL_DISABLED',
        message: config.enableUpsell
          ? 'Sugerencias disponibles en carrito/carta; impresión, aceptación y descarte quedan medidos por sesión.'
          : 'El módulo de upsell está deshabilitado.'
      },
      smart_tips: {
        key: 'smart_tips',
        label: 'Propinas inteligentes',
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.enableSmartTips,
        effectiveEnabled: config.enableSmartTips,
        reasonCode: config.enableSmartTips ? 'SMART_TIPS_MANUAL_CASH_ACTIVE' : 'SMART_TIPS_DISABLED',
        message: config.enableSmartTips
          ? 'Sugerencia de porcentaje/monto y registro manual de propina disponibles; el cobro sigue siendo presencial.'
          : 'El módulo de propinas inteligentes está deshabilitado.'
      },
      reviews: {
        key: 'reviews',
        label: 'Feedback y reseñas',
        state: config.enableReviews ? CapabilityState.AVAILABLE : CapabilityState.COMING_SOON,
        configuredEnabled: config.enableReviews,
        effectiveEnabled: config.enableReviews,
        reasonCode: config.enableReviews
          ? (config.googlePlaceId ? 'REVIEWS_INTERNAL_AND_GOOGLE_ACTIVE' : 'REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED')
          : 'REVIEWS_DISABLED',
        message: config.enableReviews
          ? (config.googlePlaceId
            ? 'Rating privado activo y enlace de Google disponible.'
            : 'Rating privado y comentario interno activos; Google requiere Place ID válido.')
          : 'El módulo de feedback no está habilitado.'
      }
    };

    return { restaurantId: config.restaurantId, capabilities: caps };
  }

  /**
   * Obtiene el mapa de capacidades efectivas para un restaurante.
   */
  static async getCapabilities(restaurantIdOrSlug: string): Promise<RestaurantCapabilitiesDTO | null> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] },
      select: { id: true }
    });
    if (!restaurant || !isRestaurantInConfiguredInstance(restaurant.id)) return null;

    const config = await this.getAdminConfig(restaurant.id);
    return this.buildCapabilities(config);
  }

  /**
   * Obtiene el historial de auditoría de cambios de configuración.
   */
  static async getAuditLogs(restaurantIdOrSlug: string, limit: number = 50): Promise<ModuleConfigAuditDTO[]> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) return [];
    const restaurantId = restaurant.id;

    const logs = await prisma.restaurantModuleConfigAudit.findMany({
      where: { restaurantId },
      orderBy: { changedAt: 'desc' },
      take: limit
    });

    return logs.map((log) => ({
      id: log.id,
      restaurantId: log.restaurantId,
      changedBy: log.changedBy,
      changedField: log.changedField,
      oldValue: log.oldValue,
      newValue: log.newValue,
      changedAt: log.changedAt.toISOString()
    }));
  }
}
