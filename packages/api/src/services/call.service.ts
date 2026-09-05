import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { CreateCallDTO, CallStatus, CallOrigin, CallEventData, Sector, CallType, PaymentMethod } from '@mesaya/shared';
import { AbuseControlService, AbusePolicies } from './abuse-control.service';

// Helper: Haversine distance in meters
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export class CallService {
  /**
   * Crea un llamado operativo para una sesión de mesa activa.
   *
   * Requisitos de seguridad:
   * - La sesión debe existir, no estar cerrada y no haber expirado.
   * - El turno del restaurante debe estar abierto.
   * - Límite de 1 llamado activo por sesión.
   * - Geofence contextual: señal heurística no bloqueante si no hay permisos GPS en el cliente;
   *   el geofence NUNCA autoriza sesiones vencidas o cerradas.
   */
  static async createCall(dto: CreateCallDTO) {
    const session = await prisma.tableSession.findUnique({
      where: { token: dto.sessionToken },
      include: {
        table: {
          include: {
            restaurant: true
          }
        },
        shift: true,
        calls: {
          where: {
            status: { in: ['PENDING', 'IN_PROGRESS'] }
          }
        }
      }
    });

    if (!session) {
      const error: any = new Error('Sesión de mesa no encontrada');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    if (session.closedAt) {
      const error: any = new Error('Esta sesión de mesa ya finalizó. Escaneá el QR físico en la mesa para iniciar una nueva atención.');
      error.statusCode = 410;
      error.code = 'SESSION_CLOSED';
      throw error;
    }

    if (new Date() > new Date(session.expiresAt)) {
      const error: any = new Error('La sesión de esta mesa ha expirado. Por favor volvé a escanear el QR de la mesa.');
      error.statusCode = 410;
      error.code = 'SESSION_EXPIRED';
      throw error;
    }

    if (session.shift && session.shift.closedAt) {
      const error: any = new Error('El turno del restaurante ha finalizado. No se pueden realizar llamados.');
      error.statusCode = 410;
      error.code = 'SHIFT_CLOSED';
      throw error;
    }

    // Geofencing verification (Telemetría contextual no bloqueante sin GPS)
    // El geofence es una señal heurística de mitigación de spam remoto, NO un mecanismo
    // de autorización criptográfica. Si el usuario no tiene permisos GPS o el navegador
    // no reporta coordenadas (dto.latitude === undefined), el llamado se procesa con la sesión de mesa activa.
    // Asimismo, tener GPS coincidente NO autoriza llamados sobre sesiones vencidas o cerradas.
    const restaurant = session.table.restaurant;
    if (
      restaurant.latitude !== null &&
      restaurant.longitude !== null &&
      dto.latitude !== undefined &&
      dto.longitude !== undefined
    ) {
      const distance = calculateDistanceMeters(
        restaurant.latitude,
        restaurant.longitude,
        dto.latitude,
        dto.longitude
      );

      const maxRadius = restaurant.radiusMeters || 200;
      // Rechazar únicamente si el GPS reporta una distancia remota excesiva (> 2 km)
      if (distance > Math.max(maxRadius * 5, 2000)) {
        const error: any = new Error(
          `Te encuentras fuera del radio del local (${Math.round(distance)}m detectados). Debes estar físicamente en el salón de ${restaurant.name} para llamar al mozo.`
        );
        error.statusCode = 403;
        error.code = 'GEOFENCE_EXCEEDED';
        throw error;
      }
    }

    const rateDecision = await AbuseControlService.consume(`call:session:${session.id}`, AbusePolicies.CALL_BY_SESSION);
    if (!rateDecision.allowed) {
      const error: any = new Error('Demasiados llamados en poco tiempo. Por favor aguardá unos segundos.');
      error.statusCode = 429;
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.retryAfterSeconds = rateDecision.retryAfterSeconds;
      throw error;
    }

    // Fast path informativo; la garantía real está en activeKey + índice único.
    if (session.calls.length > 0) {
      const error: any = new Error('Ya tienes un llamado activo en curso. Tu mozo ya fue notificado y está en camino.');
      error.statusCode = 429;
      error.code = 'ACTIVE_CALL_LIMIT';
      error.retryAfterSeconds = 1;
      throw error;
    }

    // Validate payment method if type is BILL
    const paymentMethod = dto.paymentMethod || PaymentMethod.NOT_APPLICABLE;
    if (dto.type === CallType.BILL && paymentMethod === PaymentMethod.NOT_APPLICABLE) {
      const error: any = new Error('Para pedir la cuenta debes seleccionar un medio de pago');
      error.statusCode = 400;
      error.code = 'PAYMENT_METHOD_REQUIRED';
      throw error;
    }

    // La creación compite contra otras instancias mediante el índice único de
    // activeKey. No se usa count-then-create dentro de una transacción.
    let call;
    try {
      call = await prisma.callRequest.create({
        data: {
          tableSessionId: session.id,
          activeKey: session.id,
          type: dto.type,
          paymentMethod: paymentMethod,
          note: dto.note ? dto.note.trim() : null,
          origin: dto.origin || CallOrigin.WEB_DIRECT,
          status: CallStatus.PENDING
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const error: any = new Error('Ya tienes un llamado activo en curso. Tu mozo ya fue notificado y está en camino.');
        error.statusCode = 429;
        error.code = 'ACTIVE_CALL_LIMIT';
        error.retryAfterSeconds = 1;
        throw error;
      }
      throw err;
    }

    const eventPayload: CallEventData = {
      id: call.id,
      restaurantId: session.table.restaurant.id,
      tableId: session.table.id,
      tableLabel: session.table.label,
      sector: session.table.sector as Sector,
      type: call.type as CallType,
      paymentMethod: call.paymentMethod as PaymentMethod,
      note: call.note,
      origin: call.origin as CallOrigin,
      status: CallStatus.PENDING,
      createdAt: call.createdAt.toISOString()
    };

    // Broadcast SSE / Event Bus
    eventBus.broadcastCall(eventPayload, 'call.created');

    // RTMS: If diner requested bill, auto-transition table state to BILL_REQUESTED
    if (call.type === CallType.BILL) {
      try {
        const { fsmService } = await import('./fsm.service');
        const { TableFSMState, SignalSource } = await import('@mesaya/shared');
        await fsmService.attemptTransition({
          tableId: session.table.id,
          toState: TableFSMState.BILL_REQUESTED,
          source: SignalSource.CUSTOMER_APP,
          trigger: `Comensal solicitó la cuenta (${paymentMethod})`
        });
      } catch (err) {
        console.warn('FSM auto-transition to BILL_REQUESTED skipped or failed:', err);
      }
    }

    return eventPayload;
  }

  static async updateCallStatus(
    callId: string,
    status: CallStatus,
    staffRestaurantId?: string,
    staffUserId?: string
  ) {
    const existing = await prisma.callRequest.findUnique({
      where: { id: callId },
      include: {
        tableSession: {
          include: {
            table: {
              include: {
                restaurant: true
              }
            }
          }
        }
      }
    });

    if (!existing) {
      const error: any = new Error('Llamado no encontrado');
      error.statusCode = 404;
      error.code = 'CALL_NOT_FOUND';
      throw error;
    }

    if (staffRestaurantId && existing.tableSession.table.restaurant.id !== staffRestaurantId) {
      const error: any = new Error('No tienes permisos para modificar este llamado');
      error.statusCode = 403;
      error.code = 'FORBIDDEN_CROSS_TENANT';
      throw error;
    }

    // State machine protection: Do not resurrect cancelled or already resolved calls
    if (existing.status === CallStatus.CANCELLED && status !== CallStatus.CANCELLED) {
      const error: any = new Error('Este llamado fue cancelado por el comensal.');
      error.statusCode = 409;
      error.code = 'CALL_ALREADY_CANCELLED';
      throw error;
    }
    if (existing.status === CallStatus.RESOLVED && status !== CallStatus.RESOLVED) {
      const error: any = new Error('Este llamado ya fue resuelto previamente.');
      error.statusCode = 409;
      error.code = 'CALL_ALREADY_RESOLVED';
      throw error;
    }

    const now = new Date();
    const updated = await prisma.callRequest.update({
      where: { id: callId },
      data: {
        status,
        activeKey: status === CallStatus.RESOLVED || status === CallStatus.CANCELLED ? null : existing.activeKey,
        acknowledgedAt: status === CallStatus.IN_PROGRESS ? now : existing.acknowledgedAt,
        resolvedAt: status === CallStatus.RESOLVED ? now : existing.resolvedAt
      }
    });

    const eventPayload: CallEventData = {
      id: updated.id,
      restaurantId: existing.tableSession.table.restaurant.id,
      tableId: existing.tableSession.table.id,
      tableLabel: existing.tableSession.table.label,
      sector: existing.tableSession.table.sector as Sector,
      type: updated.type as CallType,
      paymentMethod: updated.paymentMethod as PaymentMethod,
      note: updated.note,
      origin: updated.origin as CallOrigin,
      status: updated.status as CallStatus,
      createdAt: updated.createdAt.toISOString(),
      acknowledgedAt: updated.acknowledgedAt?.toISOString() || null,
      resolvedAt: updated.resolvedAt?.toISOString() || null
    };

    eventBus.broadcastCall(eventPayload, 'call.updated');

    return eventPayload;
  }

  static async cancelCallByClient(callId: string, sessionToken: string) {
    const existing = await prisma.callRequest.findUnique({
      where: { id: callId },
      include: {
        tableSession: {
          include: {
            table: {
              include: {
                restaurant: true
              }
            },
            shift: true
          }
        }
      }
    });

    if (!existing || existing.tableSession.token !== sessionToken) {
      const error: any = new Error('Llamado no encontrado para esta sesión');
      error.statusCode = 404;
      error.code = 'CALL_NOT_FOUND';
      throw error;
    }

    // Validar que la sesión no esté vencida ni cerrada
    if (existing.tableSession.closedAt) {
      const error: any = new Error('Esta sesión de mesa ya finalizó. No se puede cancelar un llamado con una sesión cerrada.');
      error.statusCode = 410;
      error.code = 'SESSION_CLOSED';
      throw error;
    }

    if (new Date() > new Date(existing.tableSession.expiresAt)) {
      const error: any = new Error('La sesión de esta mesa ha expirado.');
      error.statusCode = 410;
      error.code = 'SESSION_EXPIRED';
      throw error;
    }

    if (existing.tableSession.shift && existing.tableSession.shift.closedAt) {
      const error: any = new Error('El turno del restaurante ha finalizado.');
      error.statusCode = 410;
      error.code = 'SHIFT_CLOSED';
      throw error;
    }

    if (existing.status === CallStatus.CANCELLED) {
      return { success: true, message: 'El llamado ya había sido cancelado' };
    }

    if (existing.status === CallStatus.RESOLVED) {
      return { success: true, message: 'El llamado ya había sido resuelto' };
    }

    const updated = await prisma.callRequest.update({
      where: { id: callId },
      data: {
        status: CallStatus.CANCELLED,
        activeKey: null,
        resolvedAt: new Date()
      }
    });

    const eventPayload: CallEventData = {
      id: updated.id,
      restaurantId: existing.tableSession.table.restaurant.id,
      tableId: existing.tableSession.table.id,
      tableLabel: existing.tableSession.table.label,
      sector: existing.tableSession.table.sector as Sector,
      type: updated.type as CallType,
      paymentMethod: updated.paymentMethod as PaymentMethod,
      note: updated.note,
      origin: updated.origin as CallOrigin,
      status: CallStatus.CANCELLED,
      createdAt: updated.createdAt.toISOString(),
      resolvedAt: updated.resolvedAt?.toISOString() || null
    };

    eventBus.broadcastCall(eventPayload, 'call.cancelled');

    return { success: true, message: 'Llamado cancelado con éxito' };
  }

  static async getActiveCalls(restaurantId: string) {
    const calls = await prisma.callRequest.findMany({
      where: {
        tableSession: {
          table: {
            restaurantId
          }
        },
        status: { in: ['PENDING', 'IN_PROGRESS'] }
      },
      include: {
        tableSession: {
          include: {
            table: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return calls.map(c => ({
      id: c.id,
      restaurantId,
      tableId: c.tableSession.table.id,
      tableLabel: c.tableSession.table.label,
      sector: c.tableSession.table.sector as Sector,
      type: c.type as CallType,
      paymentMethod: c.paymentMethod as PaymentMethod,
      note: c.note,
      origin: c.origin as CallOrigin,
      status: c.status as CallStatus,
      createdAt: c.createdAt.toISOString(),
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      resolvedAt: c.resolvedAt?.toISOString() || null
    }));
  }
}
