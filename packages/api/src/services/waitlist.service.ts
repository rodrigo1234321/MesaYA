import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { fsmService } from './fsm.service';
import { OrderService } from './order.service';
import { isRestaurantInConfiguredInstance } from '../lib/environment';
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

type PreOrderLine = { menuItemId: string; quantity: number; notes?: string };

function parsePreOrderData(raw: string | null | undefined): PreOrderLine[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((line) => line && typeof line.menuItemId === 'string')
      .map((line) => ({
        menuItemId: line.menuItemId,
        quantity: Number(line.quantity),
        ...(typeof line.notes === 'string' && line.notes ? { notes: line.notes } : {})
      }))
      .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
  } catch (_) {
    return null;
  }
}

function toEntryDTO(entry: any, options: { includePhone?: boolean; positionInQueue?: number } = {}): WaitlistEntryDTO {
  return {
    id: entry.id,
    restaurantId: entry.restaurantId,
    guestName: entry.guestName,
    partySize: entry.partySize,
    ...(options.includePhone ? { phone: entry.phone } : {}),
    status: entry.status as WaitlistStatus,
    preOrderData: parsePreOrderData(entry.preOrderData),
    estimatedWaitMinutes: entry.estimatedWaitMinutes,
    ...(options.positionInQueue !== undefined ? { positionInQueue: options.positionInQueue } : {}),
    calledAt: entry.calledAt?.toISOString() || null,
    seatedAt: entry.seatedAt?.toISOString() || null,
    createdAt: entry.createdAt.toISOString()
  };
}

function waitlistError(message: string, statusCode: number, code: string): never {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}

/**
 * La reserva del turno usa una guarda UPDATE ... WHERE status IN (WAITING, CALLED)
 * antes de tocar la mesa. Esto evita que dos pantallas de mozos sienten el mismo
 * turno; la FSM mantiene además el CAS de la mesa para resolver carreras entre
 * turnos distintos. Si la transición falla, la guarda se revierte al estado previo.
 */

export class WaitlistService {
  /**
   * Registra a un comensal en la fila virtual pública.
   * Reglas de seguridad:
   * - Valida payload, límites de longitud y tipos estrictos (400).
   * - Respeta feature flag enableWaitlist del restaurante (403).
   * - Desactiva el pre-pedido si la configuración no lo habilita; no almacena JSON arbitrario como orden (403).
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

    if (!restaurant || !isRestaurantInConfiguredInstance(restaurant.id)) {
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

    let normalizedPreOrder: PreOrderLine[] | null = null;
    if (dto.preOrderData !== undefined) {
      if (!Array.isArray(dto.preOrderData) || dto.preOrderData.length > 20) {
        waitlistError('El pre-pedido debe contener entre 1 y 20 ítems válidos', 400, 'INVALID_PREORDER');
      }

      if (dto.preOrderData.length > 0 && !restaurant.moduleConfig.enableWaitlistPreOrder) {
        waitlistError('El pre-pedido no está habilitado para este restaurante', 403, 'PREORDER_DISABLED');
      }

      const requested = dto.preOrderData.map((line: any) => ({
        menuItemId: typeof line?.menuItemId === 'string' ? line.menuItemId.trim() : '',
        quantity: line?.quantity,
        notes: line?.notes
      }));
      if (requested.some((line) => !line.menuItemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50 || (line.notes !== undefined && (typeof line.notes !== 'string' || line.notes.length > 500)))) {
        waitlistError('Cada ítem del pre-pedido requiere plato, cantidad entre 1 y 50 y notas de hasta 500 caracteres', 400, 'INVALID_PREORDER');
      }

      if (requested.length > 0) {
        const ids = [...new Set(requested.map((line) => line.menuItemId))];
        const availableItems = await prisma.menuItem.findMany({
          where: {
            id: { in: ids },
            isAvailable: true,
            category: { restaurantId: restaurant.id }
          },
          select: { id: true }
        });
        const availableIds = new Set(availableItems.map((item) => item.id));
        if (ids.some((id) => !availableIds.has(id))) {
          waitlistError('Uno o más platos del pre-pedido no están disponibles en este restaurante', 422, 'PREORDER_ITEM_UNAVAILABLE');
        }
        normalizedPreOrder = requested.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          ...(line.notes?.trim() ? { notes: line.notes.trim() } : {})
        }));
      }
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
        preOrderData: normalizedPreOrder ? JSON.stringify(normalizedPreOrder) : null,
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
    return toEntryDTO(entry, { positionInQueue: waitingBefore + 1 });
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

    if (!restaurant || !isRestaurantInConfiguredInstance(restaurant.id)) {
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

    return entries.map((e, index) => toEntryDTO(e, { includePhone: true, positionInQueue: index + 1 }));
  }

  /** Consulta pública del ticket. El teléfono funciona como segundo factor
   * liviano y se compara normalizado para no exponer datos por enumeración. */
  static async getPublicStatus(waitlistId: string, rawPhone: string): Promise<WaitlistEntryDTO> {
    const phone = typeof rawPhone === 'string' ? rawPhone.trim() : '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      waitlistError('Ticket no encontrado', 404, 'WAITLIST_TICKET_NOT_FOUND');
    }

    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId) || entry.phone !== normalizePhoneE164(phone)) {
      waitlistError('Ticket no encontrado', 404, 'WAITLIST_TICKET_NOT_FOUND');
    }

    const position = entry.status === WaitlistStatus.WAITING || entry.status === WaitlistStatus.CALLED
      ? await prisma.waitlistEntry.count({
        where: {
          restaurantId: entry.restaurantId,
          status: { in: [WaitlistStatus.WAITING, WaitlistStatus.CALLED] },
          createdAt: { lt: entry.createdAt }
        }
      }) + 1
      : undefined;

    return toEntryDTO(entry, { positionInQueue: position });
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

    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId)) {
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

    const parsedDTO = toEntryDTO(updated, { includePhone: true });

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

    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId)) {
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

    const previousStatus = entry.status as WaitlistStatus;

    // Guarda atómica: sólo un mozo puede reclamar el turno. Se ejecuta antes
    // de la FSM para que una carrera perdedora no altere la mesa.
    const claimTime = new Date();
    const claim = await prisma.waitlistEntry.updateMany({
      where: {
        id: waitlistId,
        restaurantId: entry.restaurantId,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.CALLED] }
      },
      data: { status: WaitlistStatus.SEATED, seatedAt: claimTime }
    });
    if (claim.count === 0) {
      const fresh = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
      if (fresh?.status === WaitlistStatus.SEATED) {
        waitlistError('El comensal ya fue sentado previamente en una mesa', 409, 'ALREADY_SEATED');
      }
      waitlistError('El turno ya no está disponible para ser sentado', 409, 'INVALID_WAITLIST_STATUS');
    }

    // Transicionar estado FSM de la mesa a OCCUPIED_NO_ORDER
    try {
      await fsmService.attemptTransition({
        tableId: table.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: `Comensal de fila virtual sentado (${entry.guestName}, grupo de ${entry.partySize})`,
        staffUserId: options?.staffUserId,
        expectedCurrentState: TableFSMState.AVAILABLE
      });
    } catch (err: any) {
      await prisma.waitlistEntry.updateMany({
        where: { id: waitlistId, status: WaitlistStatus.SEATED, seatedAt: claimTime },
        data: { status: previousStatus, seatedAt: null }
      });
      const error: any = new Error(`Conflicto al ocupar la mesa destino: ${err.message}`);
      error.statusCode = err.statusCode || 409;
      error.code = err.code || 'TABLE_STATE_CONFLICT';
      throw error;
    }

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!updated) waitlistError('El turno desapareció durante la asignación', 409, 'WAITLIST_STATE_CONFLICT');

    // Un pre-pedido validado se convierte en comanda sólo después de que la
    // mesa quedó asignada. OrderService conserva el precio servidor y envía a KDS.
    const preOrder = parsePreOrderData(updated.preOrderData);
    if (preOrder?.length) {
      try {
        await OrderService.addPreOrderByStaff({
          tableId: table.id,
          lines: preOrder,
          staffUserId: options?.staffUserId,
          staffName: 'Fila virtual',
          staffRestaurantId: entry.restaurantId
        });
      } catch (err: any) {
        const error: any = new Error(`La mesa fue asignada, pero no se pudo convertir el pre-pedido en comanda: ${err.message}`);
        error.statusCode = 409;
        error.code = 'PREORDER_PROMOTION_FAILED';
        throw error;
      }
    }

    const parsedDTO = toEntryDTO(updated, { includePhone: true });

    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_seated', parsedDTO);

    return parsedDTO;
  }
}
