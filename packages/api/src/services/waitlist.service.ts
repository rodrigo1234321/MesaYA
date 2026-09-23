import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { FSMService } from './fsm.service';
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
  /** Seam de test para inyectar un fallo entre pasos de la tx atómica (E07). */
  static _testSeam?: (phase: 'after_occupy' | 'after_claim' | 'before_preorder', ctx: { tx: any; waitlistId: string; tableId: string }) => void | Promise<void>;
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

    // Política explícita de vencimiento:
    // Turnos llamados hace más de 30 minutos sin sentarse pasan a NO_SHOW
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const staleEntries = await prisma.waitlistEntry.findMany({
      where: {
        restaurantId: restaurant.id,
        status: WaitlistStatus.CALLED,
        calledAt: { lt: staleThreshold }
      }
    });

    if (staleEntries.length > 0) {
      await prisma.waitlistEntry.updateMany({
        where: { id: { in: staleEntries.map((e) => e.id) } },
        data: { status: WaitlistStatus.NO_SHOW }
      });
      for (const entry of staleEntries) {
        const parsedDTO = toEntryDTO({ ...entry, status: WaitlistStatus.NO_SHOW }, { includePhone: true });
        eventBus.broadcast(entry.restaurantId, 'waitlist.guest_no_show', parsedDTO);
      }
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

    // Si estaba llamado y pasaron más de 30 minutos, marcar como NO_SHOW
    if (entry.status === WaitlistStatus.CALLED && entry.calledAt && entry.calledAt < new Date(Date.now() - 30 * 60 * 1000)) {
      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: WaitlistStatus.NO_SHOW }
      });
      entry.status = WaitlistStatus.NO_SHOW;
      const parsedDTO = toEntryDTO(entry, { includePhone: true });
      eventBus.broadcast(entry.restaurantId, 'waitlist.guest_no_show', parsedDTO);
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
   * Cancelación segura pública del propio ticket por parte del comensal.
   * Requiere el teléfono normalizado como factor de privacidad liviano.
   */
  static async cancelPublicTicket(waitlistId: string, rawPhone: string, _reason?: string): Promise<WaitlistEntryDTO> {
    const phone = typeof rawPhone === 'string' ? rawPhone.trim() : '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      waitlistError('Ticket no encontrado', 404, 'WAITLIST_TICKET_NOT_FOUND');
    }

    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId) || entry.phone !== normalizePhoneE164(phone)) {
      waitlistError('Ticket no encontrado', 404, 'WAITLIST_TICKET_NOT_FOUND');
    }

    if (entry.status === WaitlistStatus.SEATED) {
      waitlistError('No se puede cancelar un turno que ya fue sentado en una mesa', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.NO_SHOW) {
      waitlistError('El turno ya se encuentra vencido/no-show', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.CANCELLED) {
      return toEntryDTO(entry);
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.CANCELLED }
    });

    const parsedDTO = toEntryDTO(updated, { includePhone: true });
    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_cancelled', parsedDTO);

    return toEntryDTO(updated);
  }

  /**
   * Cancelación de turno por parte del personal del restaurante (staff).
   */
  static async cancelByStaff(waitlistId: string, staffRestaurantId?: string, _reason?: string): Promise<WaitlistEntryDTO> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId)) {
      waitlistError('Turno de espera no encontrado', 404, 'WAITLIST_ENTRY_NOT_FOUND');
    }

    if (staffRestaurantId && entry.restaurantId !== staffRestaurantId) {
      waitlistError('No autorizado para gestionar turnos de otro restaurante', 403, 'STAFF_TENANT_MISMATCH');
    }

    if (entry.status === WaitlistStatus.SEATED) {
      waitlistError('No se puede cancelar un turno que ya fue sentado en una mesa', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.NO_SHOW) {
      waitlistError('El turno ya se encuentra vencido/no-show', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.CANCELLED) {
      return toEntryDTO(entry, { includePhone: true });
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.CANCELLED }
    });

    const parsedDTO = toEntryDTO(updated, { includePhone: true });
    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_cancelled', parsedDTO);

    return parsedDTO;
  }

  /**
   * Mozo o encargado marca un turno como no-show tras aviso sin comparecencia.
   */
  static async markNoShow(waitlistId: string, staffRestaurantId?: string, _reason?: string): Promise<WaitlistEntryDTO> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!entry || !isRestaurantInConfiguredInstance(entry.restaurantId)) {
      waitlistError('Turno de espera no encontrado', 404, 'WAITLIST_ENTRY_NOT_FOUND');
    }

    if (staffRestaurantId && entry.restaurantId !== staffRestaurantId) {
      waitlistError('No autorizado para gestionar turnos de otro restaurante', 403, 'STAFF_TENANT_MISMATCH');
    }

    if (entry.status === WaitlistStatus.SEATED) {
      waitlistError('No se puede marcar como no-show a un comensal que ya fue sentado', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.CANCELLED) {
      waitlistError('No se puede marcar como no-show a un turno cancelado', 409, 'INVALID_WAITLIST_STATUS');
    }

    if (entry.status === WaitlistStatus.NO_SHOW) {
      return toEntryDTO(entry, { includePhone: true });
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.NO_SHOW }
    });

    const parsedDTO = toEntryDTO(updated, { includePhone: true });
    eventBus.broadcast(updated.restaurantId, 'waitlist.guest_no_show', parsedDTO);

    return parsedDTO;
  }

  /**
   * Mozo llama al comensal (aviso de mesa lista).
   * Reglas de seguridad:
   * - Aislamiento de tenant estricto por staff autenticado (403).
   * - Rechaza llamar a turnos ya sentados, cancelados o vencidos (409).
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

    if (entry.status === WaitlistStatus.NO_SHOW) {
      const error: any = new Error('No se puede llamar a un turno marcado como no-show');
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
   * Sienta al comensal en una mesa y finaliza la espera — ATÓMICO E07.
   * Toda la mutación (FSM OCCUPIED_NO_ORDER + claim SEATED + pre-orden
   * + promoción a ORDER_IN_KITCHEN) ocurre en UNA transacción Prisma.
   * Si cualquier paso falla o el proceso muere, la transacción revierte y
   * no queda mesa ocupada huérfana ni ticket SEATED inconsistente.
   * Los broadcasts se emiten sólo post-commit, sin falsos éxitos.
   *
   * skipPreOrder es recovery explícito: si el ticket trae preOrderData y
   * skipPreOrder===true, se exige skipReason (5..240) o rol MANAGER. Sin
   * razón se rechaza con 400/403. El bypass queda auditado en
   * TableStateEvent.metadata y documentado como PENDING_HUMAN cuando la
   * política de rol lo exige.
   */
  static async seatGuest(
    waitlistId: string,
    options?: {
      staffRestaurantId?: string;
      staffUserId?: string;
      staffRole?: string;
      tableId?: string;
      skipPreOrder?: boolean;
      skipReason?: string;
    }
  ): Promise<WaitlistEntryDTO> {
    if (!options?.tableId || typeof options.tableId !== 'string' || !options.tableId.trim()) {
      const error: any = new Error('tableId es requerido para sentar a un comensal');
      error.statusCode = 400;
      error.code = 'TABLE_ID_REQUIRED';
      throw error;
    }
    const tableId = options.tableId.trim();

    // Validaciones tempranas fuera de la tx para errores accionables rápidos.
    const entryEarly = await prisma.waitlistEntry.findUnique({ where: { id: waitlistId } });
    if (!entryEarly || !isRestaurantInConfiguredInstance(entryEarly.restaurantId)) {
      const error: any = new Error('Turno de espera no encontrado');
      error.statusCode = 404; error.code = 'WAITLIST_ENTRY_NOT_FOUND'; throw error;
    }
    if (options?.staffRestaurantId && entryEarly.restaurantId !== options.staffRestaurantId) {
      const error: any = new Error('No autorizado para sentar comensales de otro restaurante');
      error.statusCode = 403; error.code = 'STAFF_TENANT_MISMATCH'; throw error;
    }
    if (entryEarly.status === WaitlistStatus.SEATED) waitlistError('El comensal ya fue sentado previamente en una mesa', 409, 'ALREADY_SEATED');
    if (entryEarly.status === WaitlistStatus.CANCELLED) waitlistError('No se puede sentar a un turno cancelado', 409, 'INVALID_WAITLIST_STATUS');
    if (entryEarly.status === WaitlistStatus.NO_SHOW) waitlistError('No se puede sentar a un turno marcado como no-show', 409, 'INVALID_WAITLIST_STATUS');

    const tableEarly = await prisma.table.findUnique({ where: { id: tableId } });
    if (!tableEarly) { const e:any=new Error('Mesa destino no encontrada'); e.statusCode=404; e.code='TABLE_NOT_FOUND'; throw e; }
    if (tableEarly.restaurantId !== entryEarly.restaurantId) { const e:any=new Error('La mesa destino no pertenece al mismo restaurante de la fila de espera'); e.statusCode=403; e.code='TABLE_RESTAURANT_MISMATCH'; throw e; }
    if (tableEarly.currentState !== TableFSMState.AVAILABLE) { const e:any=new Error(`La mesa destino no se encuentra disponible (estado actual: ${tableEarly.currentState})`); e.statusCode=409; e.code='TABLE_NOT_AVAILABLE'; throw e; }

    // Validación de skipPreOrder con razón/permiso coherente (no ocultar bypass)
    const earlyPreOrder = parsePreOrderData(entryEarly.preOrderData);
    if (options?.skipPreOrder && earlyPreOrder?.length) {
      const reason = typeof options.skipReason === 'string' ? options.skipReason.trim() : '';
      const isManager = options.staffRole === 'MANAGER';
      if (!reason && !isManager) {
        // PENDING_HUMAN: WAITER que bypassea pre-pedido sin razón es riesgo auditado.
        // Se exige razón explícita; MANAGER puede bypassear con razón corta o sin ella si audita.
        const error: any = new Error('Omitir el pre-pedido requiere motivo explícito (skipReason 5..240) o rol MANAGER');
        error.statusCode = 400;
        error.code = 'SKIP_PREORDER_REQUIRES_REASON';
        error.details = { requires: 'skipReason 5..240 o MANAGER', pendingHuman: true };
        throw error;
      }
      if (reason && (reason.length < 5 || reason.length > 240)) {
        const error: any = new Error('skipReason debe tener entre 5 y 240 caracteres');
        error.statusCode = 400; error.code = 'INVALID_SKIP_REASON'; throw error;
      }
    }

    let txResult: { updated: any; table: any; fromState: TableFSMState; toState: TableFSMState; orderId?: string; skipAudit?: boolean } | null = null;

    try {
      txResult = await prisma.$transaction(async (tx: any) => {
        // Revalidar dentro de la tx (TOCTOU)
        const entry = await tx.waitlistEntry.findUnique({ where: { id: waitlistId } });
        if (!entry || entry.restaurantId !== entryEarly.restaurantId) waitlistError('Turno de espera no encontrado', 404, 'WAITLIST_ENTRY_NOT_FOUND');
        if (entry.status !== WaitlistStatus.WAITING && entry.status !== WaitlistStatus.CALLED) {
          if (entry.status === WaitlistStatus.SEATED) waitlistError('El comensal ya fue sentado previamente en una mesa', 409, 'ALREADY_SEATED');
          waitlistError(`No se puede sentar a un turno ${String(entry.status).toLowerCase()}`, 409, 'INVALID_WAITLIST_STATUS');
        }
        const table = await tx.table.findUnique({ where: { id: tableId } });
        if (!table) { const e:any=new Error('Mesa destino no encontrada'); e.statusCode=404; e.code='TABLE_NOT_FOUND'; throw e; }
        if (table.restaurantId !== entry.restaurantId) { const e:any=new Error('La mesa destino no pertenece al mismo restaurante de la fila de espera'); e.statusCode=403; e.code='TABLE_RESTAURANT_MISMATCH'; throw e; }

        // 1. FSM OCCUPIED_NO_ORDER dentro de la tx (CAS)
        const fsmResult = await FSMService.transitionTx(tx, {
          tableId: table.id,
          toState: TableFSMState.OCCUPIED_NO_ORDER,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: `Comensal de fila virtual sentado (${entry.guestName}, grupo de ${entry.partySize})` + (options?.skipPreOrder && earlyPreOrder?.length ? ` [skipPreOrder: ${options.skipReason || 'MANAGER_BYPASS'}]` : ''),
          staffUserId: options?.staffUserId,
          expectedCurrentState: TableFSMState.AVAILABLE,
          restaurantId: entry.restaurantId,
          metadata: options?.skipPreOrder && earlyPreOrder?.length ? { skipPreOrder: true, skipReason: options.skipReason || null, staffRole: options.staffRole || null } : undefined
        });

        if (WaitlistService._testSeam) {
          await WaitlistService._testSeam('after_occupy', { tx, waitlistId, tableId: table.id });
        }

        // 2. Claim atómico del ticket (WAITING/CALLED -> SEATED)
        const claimTime = new Date();
        const claim = await tx.waitlistEntry.updateMany({
          where: { id: waitlistId, restaurantId: entry.restaurantId, status: { in: [WaitlistStatus.WAITING, WaitlistStatus.CALLED] } },
          data: { status: WaitlistStatus.SEATED, seatedAt: claimTime }
        });
        if (claim.count === 0) {
          const fresh = await tx.waitlistEntry.findUnique({ where: { id: waitlistId } });
          if (fresh?.status === WaitlistStatus.SEATED) waitlistError('El comensal ya fue sentado previamente en una mesa', 409, 'ALREADY_SEATED');
          if (fresh?.status === WaitlistStatus.CANCELLED || fresh?.status === WaitlistStatus.NO_SHOW) waitlistError(`No se puede sentar a un turno ${fresh.status.toLowerCase()}`, 409, 'INVALID_WAITLIST_STATUS');
          waitlistError('El turno ya no está disponible para ser sentado', 409, 'INVALID_WAITLIST_STATUS');
        }

        if (WaitlistService._testSeam) {
          await WaitlistService._testSeam('after_claim', { tx, waitlistId, tableId: table.id });
        }

        const updated = await tx.waitlistEntry.findUnique({ where: { id: waitlistId } });
        if (!updated) waitlistError('El turno desapareció durante la asignación', 409, 'WAITLIST_STATE_CONFLICT');

        const preOrder = parsePreOrderData(updated.preOrderData);
        let orderId: string | undefined;

        if (preOrder?.length && !options?.skipPreOrder) {
          const mod = await tx.restaurantModuleConfig.findUnique({ where: { restaurantId: entry.restaurantId } });
          if (mod && mod.enableWaitlistPreOrder === false) {
            const error: any = new Error('El pre-pedido no está habilitado para este restaurante');
            error.statusCode = 409; error.code = 'PREORDER_PROMOTION_FAILED'; throw error;
          }
          if (WaitlistService._testSeam) {
            await WaitlistService._testSeam('before_preorder', { tx, waitlistId, tableId: table.id });
          }
          try {
            const res = await OrderService.addPreOrderByStaffTx(tx, {
              tableId: table.id,
              lines: preOrder,
              staffUserId: options?.staffUserId,
              staffName: 'Fila virtual',
              staffRestaurantId: entry.restaurantId
            });
            orderId = res.orderId;
          } catch (err: any) {
            // Cualquier fallo (stock, precio, tenant) revierte la tx completa sin orden parcial.
            // Traducir a código estable para el caller sin ocultar la causa.
            if (err.statusCode && err.code) throw err;
            const error: any = new Error(`La promoción del pre-pedido falló: ${err.message}`);
            error.statusCode = 409; error.code = 'PREORDER_PROMOTION_FAILED'; throw error;
          }
        } else if (preOrder?.length && options?.skipPreOrder) {
          // Recovery explícito auditado: no se crea comanda, pero la tx ya auditó skip en FSM metadata.
        }

        // Estado final comprometido dentro de la tx: si hubo promoción, ensureOperationalStateTx ya avanzó a ORDER_IN_KITCHEN.
        // Capturarlo aquí evita que el broadcast post-commit reporte OCCUPIED_NO_ORDER cuando el commit real es ORDER_IN_KITCHEN.
        const finalTableRow = await tx.table.findUnique({ where: { id: table.id }, select: { currentState: true } });
        const finalState = (finalTableRow?.currentState as TableFSMState) ?? fsmResult.toState;

        // Si la promoción lanzó 409/422, la tx revierte y no queda mesa ocupada ni ticket SEATED.
        return { updated, table, fromState: fsmResult.fromState, toState: finalState, orderId, skipAudit: Boolean(options?.skipPreOrder && preOrder?.length) };
      });
    } catch (err: any) {
      // Re-mapear errores de promoción a 409 estable si aún no tienen código.
      if (err.code === 'ITEM_NOT_AVAILABLE' || err.code === 'ITEM_NOT_FOUND' || err.code === 'INVALID_PREORDER') {
        const error: any = new Error(`La mesa no fue ocupada porque el pre-pedido falló: ${err.message}`);
        error.statusCode = 409; error.code = 'PREORDER_PROMOTION_FAILED'; error.details = { originalCode: err.code }; throw error;
      }
      // Si el error ya es PREORDER_PROMOTION_FAILED, propagar tal cual (la tx ya revirtió).
      throw err;
    }

    if (!txResult) waitlistError('Error interno al sentar comensal', 500, 'SEAT_FAILED');

    // === Post-commit broadcasts (sin falsos éxitos) ===
    const parsedDTO = toEntryDTO(txResult.updated, { includePhone: true });
    eventBus.broadcast(txResult.updated.restaurantId, 'waitlist.guest_seated', parsedDTO);

    // Broadcast FSM: table.state_changed (transitionTx no emite, lo hacemos post-commit)
    // El estado final comprometido debe reflejar la promoción: ORDER_IN_KITCHEN si hubo pre-order,
    // OCCUPIED_NO_ORDER si fue skip/sin pre-order. txResult.toState ya es el final capturado dentro
    // de la tx, pero re-validamos contra el row post-commit para garantizar que el evento coincida
    // con el estado realmente persistido (defensa en profundidad).
    try {
      const tableRow = await prisma.table.findUnique({ where: { id: txResult.table.id }, include: { floorZone: true, restaurant: true } });
      const committedState = (tableRow?.currentState as TableFSMState) ?? txResult.toState;
      const staffName = options?.staffUserId ? (await prisma.staffUser.findUnique({ where: { id: options.staffUserId } }))?.name || null : null;
      // Calcular occupancyMinutes similar a fsmService
      const now = new Date();
      const occupancySession = await prisma.occupancySession.findFirst({ where: { tableId: txResult.table.id, cleanedAt: null }, select: { seatedAt: true } });
      const occupancyMinutes = occupancySession ? Math.max(0, Math.floor((now.getTime() - occupancySession.seatedAt.getTime()) / 60000)) : 0;
      const { STATE_COLORS, STATE_EMOJIS } = await import('@mesaya/shared');
      eventBus.broadcastTableState({
        tableId: txResult.table.id,
        tableLabel: txResult.table.label,
        restaurantId: txResult.table.restaurantId,
        floorZoneId: txResult.table.floorZoneId ?? (tableRow as any)?.floorZoneId ?? null,
        zoneName: (tableRow as any)?.floorZone?.name ?? null,
        previousState: txResult.fromState,
        newState: committedState,
        stateColor: (STATE_COLORS as any)[committedState]?.hex ?? '#22c55e',
        stateEmoji: (STATE_EMOJIS as any)[committedState] ?? '🟢',
        trigger: `Comensal de fila virtual sentado` + (txResult.skipAudit ? ' (skipPreOrder auditado)' : ''),
        source: SignalSource.STAFF_TERMINAL_TAP,
        staffUserId: options?.staffUserId ?? null,
        staffName,
        occupancyMinutes,
        activeCall: null,
        timestamp: now.toISOString()
      } as any);
    } catch (_) {
      // Broadcast no crítico; la tx ya está confirmada.
    }

    // Broadcast de comanda si se creó (precio servidor validado)
    if (txResult.orderId) {
      try {
        const fullOrder = await OrderService.getOrderById(txResult.orderId, { includeTechnicalIdentity: true });
        if (fullOrder) {
          eventBus.broadcast(txResult.table.restaurantId, 'order.submitted', {
            tableId: txResult.table.id,
            tableLabel: txResult.table.label,
            sector: txResult.table.sector,
            order: fullOrder
          });
        }
      } catch (_) {}
    }

    return parsedDTO;
  }

}
