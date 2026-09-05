import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import {
  PaymentMode,
  RestaurantModuleConfigDTO,
  UpdateModuleConfigDTO,
  ModuleConfigAuditDTO
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

      return {
        ...created,
        paymentMode: created.paymentMode as PaymentMode,
        suggestedTipPercentages: JSON.parse(created.suggestedTipPercentages)
      };
    }

    return {
      ...restaurant.moduleConfig,
      paymentMode: restaurant.moduleConfig.paymentMode as PaymentMode,
      suggestedTipPercentages: JSON.parse(restaurant.moduleConfig.suggestedTipPercentages)
    };
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

    return {
      ...config,
      paymentMode: config.paymentMode as PaymentMode,
      suggestedTipPercentages: JSON.parse(config.suggestedTipPercentages)
    };
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
            changedField: key,
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

    // Emitir evento SSE en tiempo real
    eventBus.broadcast(restaurantId, 'config.updated', parsedDTO);

    return parsedDTO;
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

