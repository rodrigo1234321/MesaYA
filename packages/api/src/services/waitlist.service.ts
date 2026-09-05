import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { fsmService } from './fsm.service';
import {
  WaitlistStatus,
  WaitlistEntryDTO,
  JoinWaitlistDTO,
  TableFSMState,
  SignalSource
} from '@mesaya/shared';

/**
 * Sanitiza y normaliza un teléfono a estándar internacional E.164.
 * Ej: "223 555-1234", "022315551234", "+54 9 223 555 1234" -> "+5492235551234"
 */
export function normalizePhoneE164(raw: string): string {
  let cleaned = raw.replace(/\D/g, ''); // solo dígitos

  // Manejo de prefijos argentinos típicos
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.startsWith('15')) {
    cleaned = cleaned.substring(2);
  }
  if (!cleaned.startsWith('54')) {
    cleaned = `549${cleaned}`;
  } else if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
    cleaned = `549${cleaned.substring(2)}`;
  }

  return `+${cleaned}`;
}

/**
 * PRECONDICIONES DE CONCURRENCIA PARA ETAPA POSTGRESQL (Etapas 22-24):
 * En SQLite efímera, las escrituras son atómicas a nivel archivo por el lock exclusivo de SQLite.
 * Sin embargo, bajo un entorno concurrente multi-worker en producción (PostgreSQL + PgBouncer):
 * 1. Asignación de mesa y seating atómico: Se debe ejecutar dentro de un prisma.$transaction con
 *    bloqueo pesimista (SELECT ... FOR UPDATE) tanto en "WaitlistEntry" (para evitar doble seating
 *    secuencial o simultáneo) como en "Table" (para evitar que dos mozos o procesos asignen la misma
 *    mesa en el mismo instante).
 * 2. Condición de guarda atómica:
 *    UPDATE "WaitlistEntry" SET status = 'SEATED', "seatedAt" = NOW()
 *    WHERE id = $1 AND status IN ('WAITING', 'CALLED') RETURNING id;
 *    Si rows affected === 0, abortar inmediatamente con 409 ALREADY_SEATED sin modificar la mesa.
 * 3. Transición FSM de Mesa: En la misma transacción atómica, realizar el UPDATE en "Table"
 *    con comprobación optimista WHERE id = $tableId AND "currentState" = 'AVAILABLE'.
 */

export class WaitlistService {
  /**
   * Registra a un comensal en la fila virtual pública.
   * Reglas de seguridad:
   * - Valida payload, límites de longitud y tipos estrictos (400).
   * - Respeta feature flag enableWaitlist del restaurante (403).
   * - Desactiva pre-orden para el piloto presencial; no almacena JSON arbitrario como orden (403).
   * - Valida consentimiento explícito si es enviado (400).
   * - No devuelve listado de personas ni teléfonos en la respuesta pública del ticket.
   */
  static async joinWaitlist(dto: JoinWaitlistDTO): Promise<WaitlistEntryDTO> {
    if (!dto.restaurantSlug || typeof dto.restaurantSlug !== 'string' || !dto.restaurantSlug.trim()) {
      const error: any = new Error('restaurantSlug es requerido');
      error.statusCode = 400;
      error.code = 'SLUG_REQUIRED';
      throw error;
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [{ slug: dto.restaurantSlug.trim() }, { id: dto.restaurantSlug.trim() }]
      },
      include: { moduleConfig: true }
    });

    if (!restaurant) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      error.code = 'RESTAURANT_NOT_FOUND';
      throw error;
    }

    if (!restaurant.moduleConfig || restaurant.moduleConfig.enableWaitlist === false) {
      const error: any = new Error('La fila virtual no está activa en este restaurante');
      error.statusCode = 403;
      error.code = 'WAITLIST_DISABLED';
      throw error;
    }

    // Piloto presencial: pre-orden desactivada (no se acepta ni se almacena como feature)
    if (dto.preOrderData && Array.isArray(dto.preOrderData) && dto.preOrderData.length > 0) {
      const error: any = new Error('La función de pre-orden en fila virtual está desactivada para el piloto presencial');
      error.statusCode = 403;
      error.code = 'PREORDER_DISABLED';
      throw error;
    }

    // Validación de campos mínimos y consentimiento
    const guestName = typeof dto.guestName === 'string' ? dto.guestName.trim() : '';
    if (!guestName || guestName.length < 2 || guestName.length > 50) {
      const error: any = new Error('El nombre debe tener entre 2 y 50 caracteres');
      error.statusCode = 400;
      error.code = 'INVALID_GUEST_NAME';
      throw error;
    }

    const partySize = dto.partySize;
    if (typeof partySize !== 'number' || !Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
      const error: any = new Error('La cantidad de personas debe ser un número entero entre 1 y 20');
      error.statusCode = 400;
      error.code = 'INVALID_PARTY_SIZE';
      throw error;
    }

    const rawPhone = typeof dto.phone === 'string' ? dto.phone.trim() : '';
    const digits = rawPhone.replace(/\D/g, '');
    if (!rawPhone || digits.length < 8 || digits.length > 15) {
      const error: any = new Error('El número de teléfono es inválido (debe tener entre 8 y 15 dígitos)');
      error.statusCode = 400;
      error.code = 'INVALID_PHONE';
      throw error;
    }

    if (dto.consent === false) {
      const error: any = new Error('Se requiere consentimiento para registrarse en la fila de espera');
      error.statusCode = 400;
      error.code = 'CONSENT_REQUIRED';
      throw error;
    }

    const phoneE164 = normalizePhoneE164(rawPhone);

    // Contar cuántos grupos están adelante en espera
    const waitingBefore = await prisma.waitlistEntry.count({
      where: {
        restaurantId: restaurant.id,
        status: WaitlistStatus.WAITING
      }
    });

    const estimatedMinutes = (waitingBefore + 1) * 7; // ~7 min por mesa estimada

    const entry = await prisma.waitlistEntry.create({
      data: {
        restaurantId: restaurant.id,
        guestName,
        partySize,
        phone: phoneE164,
        status: WaitlistStatus.WAITING,
        preOrderData: null, // Desactivado para piloto
        estimatedWaitMinutes: estimatedMinutes
      }
    });

    // Notificación en tiempo real para el panel del staff (con datos operativos)
    eventBus.broadcast(restaurant.id, 'waitlist.guest_joined', {
      id: entry.id,
      restaurantId: entry.restaurantId,
      guestName: entry.guestName,
      partySize: entry.partySize,
      phone: entry.phone,
      status: entry.status,
      estimatedWaitMinutes: entry.estimatedWaitMinutes,
      positionInQueue: waitingBefore + 1,
      createdAt: entry.createdAt.toISOString()
    });

    // RESPUESTA PÚBLICA: Confirmación de ticket individual sin exponer listados ni teléfonos
    return {
      id: entry.id,
      restaurantId: entry.restaurantId,
      guestName: entry.guestName,
      partySize: entry.partySize,
      status: entry.status as WaitlistStatus,
      estimatedWaitMinutes: entry.estimatedWaitMinutes,
      positionInQueue: waitingBefore + 1,
      createdAt: entry.createdAt.toISOString()
    };
  }

  /**
   * Obtiene la lista activa de espera para el staff del restaurante.
   * Reglas de seguridad:
   * - Aislamiento de tenant estricto por staff autenticado (403).
   */
  static async getQueue(restaurantIdOrSlug: string, staffRestaurantId?: string): Promise<WaitlistEntryDTO[]> {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }]
      }
    });

    if (!restaurant) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      error.code = 'RESTAURANT_NOT_FOUND';
      throw error;
    }

    if (staffRestaurantId && restaurant.id !== staffRestaurantId) {
      const error: any = new Error('No autorizado para consultar la fila de espera de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    const entries = await prisma.waitlistEntry.findMany({
      where: {
        restaurantId: restaurant.id,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.CALLED] }
      },
      orderBy: { createdAt: 'asc' }
    });

    return entries.map((e, index) => ({
      id: e.id,
      restaurantId: e.restaurantId,
      guestName: e.guestName,
      partySize: e.partySize,
      phone: e.phone,
      status: e.status as WaitlistStatus,
      preOrderData: null,
      estimatedWaitMinutes: e.estimatedWaitMinutes,
      positionInQueue: index + 1,
      calledAt: e.calledAt?.toISOString() || null,
      seatedAt: e.seatedAt?.toISOString() || null,
      createdAt: e.createdAt.toISOString()
    }));
  }

  /**
   * Mozo llama al comensal (aviso de mesa lista).
   * Reglas de seguridad:
   * - Aislamiento de tenant estricto por staff autenticado (403).
   * - Rechaza llamar a turnos ya sentados o cancelados (409).
   */
  static async callGuest(waitlistId: string, staffRestaurantId?: string): Promise<WaitlistEntryDTO> {
    const entry = await prisma.waitlistEntry.findUnique({
      where: { id: waitlistId }
    });

    if (!entry) {
      const error: any = new Error('Turno de espera no encontrado');
      error.statusCode = 404;
      error.code = 'WAITLIST_ENTRY_NOT_FOUND';
      throw error;
    }

    if (staffRestaurantId && entry.restaurantId !== staffRestaurantId) {
      const error: any = new Error('No autorizado para gestionar turnos de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    if (entry.status === WaitlistStatus.SEATED) {
      const error: any = new Error('No se puede llamar a un comensal que ya fue sentado');
      error.statusCode = 409;
      error.code = 'INVALID_WAITLIST_STATUS';
      throw error;
    }

    if (entry.status === WaitlistStatus.CANCELLED) {
      const error: any = new Error('No se puede llamar a un turno cancelado');
      error.statusCode = 409;
      error.code = 'INVALID_WAITLIST_STATUS';
      throw error;
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: waitlistId },
      data: {
        status: WaitlistStatus.CALLED,
        calledAt: new Date()
      }
    });

    const parsedDTO: WaitlistEntryDTO = {
      id: updated.id,
      restaurantId: updated.restaurantId,
      guestName: updated.guestName,
      partySize: updated.partySize,
      phone: updated.phone,
      status: updated.status as WaitlistStatus,
      preOrderData: null,
      estimatedWaitMinutes: 0,
      calledAt: updated.calledAt?.toISOString() || null,
      createdAt: updated.createdAt.toISOString()
    };

    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_called', parsedDTO);

    return parsedDTO;
  }

  /**
   * Sienta al comensal en una mesa y finaliza la espera.
   * Reglas de seguridad:
   * - Aislamiento de tenant estricto por staff autenticado (403).
   * - Impide doble seating secuencial o asignación sobre turno ya finalizado (409).
   * - Valida mesa destino: pertenencia al mismo restaurante (403) y disponibilidad (409).
   * - Transiciona mesa FSM a OCCUPIED_NO_ORDER de manera controlada.
   */
  static async seatGuest(
    waitlistId: string,
    options?: {
      staffRestaurantId?: string;
      staffUserId?: string;
      tableId?: string;
    }
  ): Promise<WaitlistEntryDTO> {
    if (!options?.tableId || typeof options.tableId !== 'string' || !options.tableId.trim()) {
      const error: any = new Error('tableId es requerido para sentar a un comensal');
      error.statusCode = 400;
      error.code = 'TABLE_ID_REQUIRED';
      throw error;
    }

    const tableId = options.tableId.trim();

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id: waitlistId }
    });

    if (!entry) {
      const error: any = new Error('Turno de espera no encontrado');
      error.statusCode = 404;
      error.code = 'WAITLIST_ENTRY_NOT_FOUND';
      throw error;
    }

    if (options?.staffRestaurantId && entry.restaurantId !== options.staffRestaurantId) {
      const error: any = new Error('No autorizado para sentar comensales de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    // Impide doble asignación / seating secuencial
    if (entry.status === WaitlistStatus.SEATED) {
      const error: any = new Error('El comensal ya fue sentado previamente en una mesa');
      error.statusCode = 409;
      error.code = 'ALREADY_SEATED';
      throw error;
    }

    if (entry.status === WaitlistStatus.CANCELLED) {
      const error: any = new Error('No se puede sentar a un turno cancelado');
      error.statusCode = 409;
      error.code = 'INVALID_WAITLIST_STATUS';
      throw error;
    }

    // Validación y ocupación de la mesa destino requerida
    const table = await prisma.table.findUnique({
      where: { id: tableId }
    });

    if (!table) {
      const error: any = new Error('Mesa destino no encontrada');
      error.statusCode = 404;
      error.code = 'TABLE_NOT_FOUND';
      throw error;
    }

    // Validar que la mesa pertenezca al mismo restaurante de la fila de espera
    if (table.restaurantId !== entry.restaurantId) {
      const error: any = new Error('La mesa destino no pertenece al mismo restaurante de la fila de espera');
      error.statusCode = 403;
      error.code = 'TABLE_RESTAURANT_MISMATCH';
      throw error;
    }

    // Validar disponibilidad de la mesa (impedir doble ocupación de la mesa física)
    if (table.currentState !== TableFSMState.AVAILABLE) {
      const error: any = new Error(`La mesa destino no se encuentra disponible (estado actual: ${table.currentState})`);
      error.statusCode = 409;
      error.code = 'TABLE_NOT_AVAILABLE';
      throw error;
    }

    // Transicionar estado FSM de la mesa a OCCUPIED_NO_ORDER
    try {
      await fsmService.attemptTransition({
        tableId: table.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: `Comensal de fila virtual sentado (${entry.guestName}, grupo de ${entry.partySize})`,
        staffUserId: options?.staffUserId
      });
    } catch (err: any) {
      const error: any = new Error(`Conflicto al ocupar la mesa destino: ${err.message}`);
      error.statusCode = err.statusCode || 409;
      error.code = err.code || 'TABLE_STATE_CONFLICT';
      throw error;
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: waitlistId },
      data: {
        status: WaitlistStatus.SEATED,
        seatedAt: new Date()
      }
    });

    const parsedDTO: WaitlistEntryDTO = {
      id: updated.id,
      restaurantId: updated.restaurantId,
      guestName: updated.guestName,
      partySize: updated.partySize,
      phone: updated.phone,
      status: updated.status as WaitlistStatus,
      preOrderData: null,
      seatedAt: updated.seatedAt?.toISOString() || null,
      createdAt: updated.createdAt.toISOString()
    };

    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_seated', parsedDTO);

    return parsedDTO;
  }
}
