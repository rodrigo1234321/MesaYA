import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import {
  PaymentMode,
  RestaurantModuleConfigDTO,
  UpdateModuleConfigDTO,
  ModuleConfigAuditDTO,
  CapabilityState,
  CapabilityKey,
  CapabilityEntry,
  RestaurantCapabilitiesDTO
} from '@mesaya/shared';

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
            allowOrdering: true,
            syncSocialCart: true,
            requireWaiterValidation: true,
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

    if (!restaurant) return null;

    // Si aún no tiene configuración creada, se inicializa automáticamente
    if (!restaurant.moduleConfig) {
      const created = await prisma.restaurantModuleConfig.create({
        data: {
          restaurantId: restaurant.id,
          paymentMode: PaymentMode.WAITER_ONLY,
          allowSplitBill: false,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
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
        select: {
          id: true,
          restaurantId: true,
          paymentMode: true,
          allowSplitBill: true,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
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
        allowOrdering: true,
        syncSocialCart: true,
        requireWaiterValidation: true,
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
      config = await prisma.restaurantModuleConfig.create({
        data: {
          restaurantId,
          paymentMode: PaymentMode.WAITER_ONLY,
          allowSplitBill: false,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
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
        select: {
          id: true,
          restaurantId: true,
          paymentMode: true,
          allowSplitBill: true,
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
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
   * Emite evento via eventBus a comensales y staff (SSE deshabilitado en piloto; eventBus es no-op).
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

    // Identificar cambios para auditoría
    const auditEntries: { changedField: string; oldValue: string | null; newValue: string | null }[] = [];

    const keysToTrack: (keyof UpdateModuleConfigDTO)[] = [
      'paymentMode',
      'allowSplitBill',
      'allowOrdering',
      'syncSocialCart',
      'requireWaiterValidation',
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
      if (dto.allowOrdering !== undefined) updateData.allowOrdering = dto.allowOrdering;
      if (dto.syncSocialCart !== undefined) updateData.syncSocialCart = dto.syncSocialCart;
      if (dto.requireWaiterValidation !== undefined) updateData.requireWaiterValidation = dto.requireWaiterValidation;
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
          allowOrdering: true,
          syncSocialCart: true,
          requireWaiterValidation: true,
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
        state: CapabilityState.AVAILABLE,
        configuredEnabled: config.requireWaiterValidation,
        effectiveEnabled: config.requireWaiterValidation,
        reasonCode: config.requireWaiterValidation ? 'WAITER_VALIDATION_ACTIVE' : 'WAITER_VALIDATION_OPTIONAL',
        message: config.requireWaiterValidation
          ? 'El mozo debe validar cada comanda antes de enviarla a cocina.'
          : 'La validación del mozo está desactivada; las comandas van directo a cocina.'
      },
      manual_payment: {
        key: 'manual_payment',
        state: CapabilityState.PILOT_ONLY,
        configuredEnabled: config.paymentMode !== PaymentMode.DIGITAL_MP,
        effectiveEnabled: false,
        reasonCode: 'MANUAL_PAYMENT_API_ONLY',
        message: 'El cobro presencial existe en la API para encargados, pero falta la pantalla operativa de caja.'
      },
      digital_payment: {
        key: 'digital_payment',
        state: CapabilityState.COMING_SOON,
        configuredEnabled: config.paymentMode !== PaymentMode.WAITER_ONLY,
        effectiveEnabled: false,
        reasonCode: 'DIGITAL_PAYMENTS_UNAVAILABLE',
        message: 'Los pagos digitales por Mercado Pago aún no están operativos. Los endpoints devuelven 503.'
      },
      split_bill: {
        key: 'split_bill',
        state: CapabilityState.COMING_SOON,
        configuredEnabled: config.allowSplitBill,
        effectiveEnabled: false,
        reasonCode: 'SPLIT_BILL_UNAVAILABLE',
        message: 'La división de cuenta entre comensales aún no está disponible.'
      },
      waitlist: {
        key: 'waitlist',
        state: CapabilityState.PILOT_ONLY,
        configuredEnabled: config.enableWaitlist,
        effectiveEnabled: config.enableWaitlist,
        reasonCode: config.enableWaitlist ? 'WAITLIST_ACTIVE' : 'WAITLIST_DISABLED',
        message: config.enableWaitlist
          ? 'La API y la gestión del staff están activas; falta una pantalla pública de ingreso.'
          : 'La fila virtual no está habilitada.'
      },
      waitlist_preorder: {
        key: 'waitlist_preorder',
        state: CapabilityState.COMING_SOON,
        configuredEnabled: config.enableWaitlist && config.enableWaitlistPreOrder,
        effectiveEnabled: false,
        reasonCode: 'WAITLIST_PREORDER_UNAVAILABLE',
        message: 'El pre-pedido en fila virtual aún no está disponible.'
      },
      rewards: {
        key: 'rewards',
        state: CapabilityState.COMING_SOON,
        configuredEnabled: config.enableRewards,
        effectiveEnabled: false,
        reasonCode: 'REWARDS_NO_LEDGER',
        message: 'El programa de fidelización Rewards tiene un calculador, pero falta el ledger y redención.'
      },
      upsell: {
        key: 'upsell',
        state: CapabilityState.PILOT_ONLY,
        configuredEnabled: config.enableUpsell,
        effectiveEnabled: false,
        reasonCode: config.enableUpsell ? 'UPSELL_PILOT_ONLY' : 'UPSELL_DISABLED',
        message: config.enableUpsell
          ? 'Recomendaciones de upsell disponibles vía API, pero ningún cliente las consume aún.'
          : 'El módulo de upsell está deshabilitado.'
      },
      smart_tips: {
        key: 'smart_tips',
        state: CapabilityState.PILOT_ONLY,
        configuredEnabled: config.enableSmartTips,
        effectiveEnabled: false,
        reasonCode: config.enableSmartTips ? 'SMART_TIPS_PILOT_ONLY' : 'SMART_TIPS_DISABLED',
        message: config.enableSmartTips
          ? 'Propinas sugeridas disponibles con UI parcial; no todas las vistas están implementadas.'
          : 'El módulo de propinas inteligentes está deshabilitado.'
      },
      reviews: {
        key: 'reviews',
        state: (() => {
          if (config.enableReviews && !config.googlePlaceId) return CapabilityState.MISCONFIGURED;
          if (config.enableReviews && config.googlePlaceId) return CapabilityState.PILOT_ONLY;
          return CapabilityState.COMING_SOON;
        })(),
        configuredEnabled: config.enableReviews,
        effectiveEnabled: Boolean(config.enableReviews && config.googlePlaceId),
        reasonCode: (() => {
          if (config.enableReviews && !config.googlePlaceId) return 'REVIEWS_NO_PLACE_ID';
          if (config.enableReviews && config.googlePlaceId) return 'REVIEWS_PILOT_ONLY';
          return 'REVIEWS_DISABLED';
        })(),
        message: (() => {
          if (config.enableReviews && !config.googlePlaceId) return 'Reseñas habilitadas sin Google Place ID configurado; no funcionarán.';
          if (config.enableReviews && config.googlePlaceId) return 'Reseñas habilitadas con Place ID; interfaz parcial en piloto.';
          return 'El módulo de reseñas no está habilitado.';
        })()
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
    if (!restaurant) return null;

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

