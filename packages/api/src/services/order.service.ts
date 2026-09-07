import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { fsmService } from './fsm.service';
import {
  OrderStatus,
  OrderDTO,
  AddOrderItemDTO,
  ClaimItemDTO,
  SplitMode,
  SplitBillSessionDTO,
  TableFSMState,
  SignalSource
} from '@mesaya/shared';

export class DigitalPaymentsUnavailableError extends Error {
  readonly statusCode: number = 503;
  readonly code: string = 'DIGITAL_PAYMENTS_UNAVAILABLE';

  constructor(message = 'Pagos digitales y división de cuenta no disponibles en el piloto presencial') {
    super(message);
    this.name = 'DigitalPaymentsUnavailableError';
  }
}

/**
 * Tabla canónica de transiciones de estado permitidas para comandas (OrderStatus).
 * Reglas de seguridad:
 * - Evita estados arbitrarios o saltos incoherentes.
 * - Prohíbe de forma absoluta la regresión o mutación desde estados finales (PAID y CANCELLED).
 */
export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = Object.freeze({
  [OrderStatus.DRAFT]: Object.freeze([
    OrderStatus.PENDING_VALIDATION,
    OrderStatus.IN_KITCHEN,
    OrderStatus.CANCELLED
  ]),
  [OrderStatus.PENDING_VALIDATION]: Object.freeze([
    OrderStatus.IN_KITCHEN,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED
  ]),
  [OrderStatus.CONFIRMED]: Object.freeze([
    OrderStatus.IN_KITCHEN,
    OrderStatus.CANCELLED
  ]),
  [OrderStatus.IN_KITCHEN]: Object.freeze([
    OrderStatus.READY_TO_SERVE,
    OrderStatus.CANCELLED,
    OrderStatus.PAID
  ]),
  [OrderStatus.READY_TO_SERVE]: Object.freeze([
    OrderStatus.SERVED,
    OrderStatus.CANCELLED,
    OrderStatus.PAID
  ]),
  [OrderStatus.SERVED]: Object.freeze([
    OrderStatus.PAID,
    OrderStatus.CANCELLED
  ]),
  [OrderStatus.PAID]: Object.freeze([]), // Estado final inmutable
  [OrderStatus.CANCELLED]: Object.freeze([]) // Estado final inmutable
});

export class OrderService {
  /**
   * Helper para formatear cualquier registro de comanda a OrderDTO.
   */
  static formatOrderDTO(order: any): OrderDTO {
    return {
      id: order.id,
      tableSessionId: order.tableSessionId,
      status: order.status as OrderStatus,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
      items: (order.items || []).map((item: any) => ({
        id: item.id,
        orderId: item.orderId,
        menuItemId: item.menuItemId,
        name: item.menuItem?.name || item.name || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes,
        addedByGuest: item.addedByGuest,
        guestName: item.guestName,
        claimedByGuest: item.claimedByGuest,
        claimVersion: item.claimVersion,
        isPaid: item.isPaid
      }))
    };
  }

  /**
   * Obtiene una orden por su identificador directo con ítems formateados.
   */
  static async getOrderById(orderId: string): Promise<OrderDTO | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { menuItem: { select: { name: true } } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!order) return null;
    return this.formatOrderDTO(order);
  }
  /**
   * Validador centralizado de sesión activa para acciones de comensal / invitado.
   * Comprueba:
   * - Token no vacío ni placeholder inválido.
   * - Existencia en base de datos.
   * - Expiración temporal (now < expiresAt).
   * - Cierre de sesión (closedAt === null y mesa no en TO_CLEAN).
   * - Turno existente, abierto y perteneciente al restaurante de la mesa.
   */
  static async validateActiveGuestSession(token: string) {
    if (
      !token ||
      typeof token !== 'string' ||
      token === 'demo-token' ||
      token === 'latest' ||
      token === 'null' ||
      token === 'undefined'
    ) {
      const error: any = new Error('Token de sesión no válido o no proporcionado');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    const session = await prisma.tableSession.findUnique({
      where: { token },
      include: {
        table: {
          include: {
            restaurant: {
              include: { moduleConfig: true }
            }
          }
        },
        shift: true
      }
    });

    if (!session) {
      const error: any = new Error('Sesión de mesa no encontrada o código QR no válido');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    const now = new Date();

    if (now > new Date(session.expiresAt)) {
      const error: any = new Error('La sesión de esta mesa ha expirado. Por favor volvé a escanear el QR de la mesa.');
      error.statusCode = 410;
      error.code = 'SESSION_EXPIRED';
      throw error;
    }

    if (session.closedAt !== null || session.table.currentState === TableFSMState.TO_CLEAN) {
      const error: any = new Error('Esta sesión de mesa ya finalizó. Escaneá el QR físico en la mesa para iniciar una nueva atención.');
      error.statusCode = 410;
      error.code = 'SESSION_CLOSED';
      throw error;
    }

    if (
      !session.shift ||
      session.shift.closedAt !== null ||
      session.shift.restaurantId !== session.table.restaurantId
    ) {
      const error: any = new Error('El turno de la sesión no está activo para el restaurante de esta mesa. No se pueden gestionar pedidos.');
      error.statusCode = 410;
      error.code = session.shift && session.shift.closedAt !== null ? 'SHIFT_CLOSED' : 'SHIFT_INACTIVE';
      throw error;
    }

    return session;
  }

  /**
   * Obtiene la comanda activa de un invitado tras validar su sesión activa.
   */
  static async getActiveOrderForGuest(token: string) {
    const session = await this.validateActiveGuestSession(token);
    const order = await this.getActiveOrder(session.id);
    const allowOrdering = session.table.restaurant.moduleConfig?.allowOrdering ?? true;
    const requireWaiterValidation = session.table.restaurant.moduleConfig?.requireWaiterValidation ?? true;

    return {
      order,
      allowOrdering,
      requireWaiterValidation
    };
  }

  /**
   * Obtiene o crea la orden activa para una sesión de mesa.
   * Prioriza el borrador (DRAFT) si existe, o la comanda activa más reciente.
   */
  static async getActiveOrder(tableSessionId: string): Promise<OrderDTO | null> {
    let order = await prisma.order.findFirst({
      where: {
        tableSessionId,
        status: OrderStatus.DRAFT
      },
      include: {
        items: {
          include: {
            menuItem: { select: { name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!order) {
      order = await prisma.order.findFirst({
        where: {
          tableSessionId,
          status: {
            in: [
              OrderStatus.PENDING_VALIDATION,
              OrderStatus.CONFIRMED,
              OrderStatus.IN_KITCHEN,
              OrderStatus.READY_TO_SERVE,
              OrderStatus.SERVED
            ]
          }
        },
        include: {
          items: {
            include: {
              menuItem: { select: { name: true } }
            },
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!order) return null;

    return {
      id: order.id,
      tableSessionId: order.tableSessionId,
      status: order.status as OrderStatus,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        menuItemId: item.menuItemId,
        name: item.menuItem.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes,
        addedByGuest: item.addedByGuest,
        guestName: item.guestName,
        claimedByGuest: item.claimedByGuest,
        claimVersion: item.claimVersion,
        isPaid: item.isPaid
      }))
    };
  }

  /**
   * Agrega un ítem al carrito colaborativo de la mesa y sincroniza vía SSE.
   * Reglas de seguridad:
   * - Sesión activa verificada de forma centralizada (404/410).
   * - Flags en servidor: rechaza si allowOrdering === false (403).
   * - Tenant isolation: resuelve el plato exclusivamente dentro del restaurante de la sesión (404).
   * - Disponibilidad de stock (422).
   * - Cantidad entera positiva mayor a 0 con límite explícito (400).
   * - Precio y total SIEMPRE calculados en servidor (inmune a manipulación del cliente).
   * - Modifica únicamente el DRAFT propio de la sesión.
   */
  static async addItem(dto: AddOrderItemDTO): Promise<OrderDTO> {
    if (!dto || typeof dto !== 'object') {
      const error: any = new Error('Datos del pedido requeridos');
      error.statusCode = 400;
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }

    const session = await this.validateActiveGuestSession(dto.sessionToken);

    // Flag en servidor: Comandas digitales activadas/desactivadas por restaurante
    if (session.table?.restaurant?.moduleConfig && session.table.restaurant.moduleConfig.allowOrdering === false) {
      const error: any = new Error('Las comandas digitales están desactivadas en este restaurante (Modo Carta Informativa)');
      error.statusCode = 403;
      error.code = 'ORDERING_DISABLED';
      throw error;
    }

    // Validación estricta de cantidad: entero positivo mayor a 0 con límite superior
    const qty = dto.quantity;
    if (
      qty === undefined ||
      qty === null ||
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty <= 0
    ) {
      const error: any = new Error('La cantidad debe ser un número entero positivo mayor a 0');
      error.statusCode = 400;
      error.code = 'INVALID_QUANTITY';
      throw error;
    }

    const MAX_ITEM_QUANTITY = 50;
    if (qty > MAX_ITEM_QUANTITY) {
      const error: any = new Error(`La cantidad máxima permitida por ítem es ${MAX_ITEM_QUANTITY}`);
      error.statusCode = 400;
      error.code = 'QUANTITY_LIMIT_EXCEEDED';
      throw error;
    }

    // Validación de longitud de notas
    if (dto.notes && (typeof dto.notes !== 'string' || dto.notes.length > 500)) {
      const error: any = new Error('Las notas del plato no pueden superar los 500 caracteres');
      error.statusCode = 400;
      error.code = 'NOTES_TOO_LONG';
      throw error;
    }

    let guestName: string | null = null;
    if (dto.guestName !== undefined && dto.guestName !== null) {
      if (typeof dto.guestName !== 'string') {
        const error: any = new Error('El nombre del comensal debe ser texto');
        error.statusCode = 400;
        error.code = 'INVALID_GUEST_NAME';
        throw error;
      }
      guestName = dto.guestName.trim().replace(/\s+/g, ' ');
      if (guestName.length < 2) {
        const error: any = new Error('El nombre del comensal debe tener al menos 2 caracteres');
        error.statusCode = 400;
        error.code = 'INVALID_GUEST_NAME';
        throw error;
      }
      if (guestName.length > 60) {
        const error: any = new Error('El nombre del comensal no puede superar los 60 caracteres');
        error.statusCode = 400;
        error.code = 'GUEST_NAME_TOO_LONG';
        throw error;
      }
    }

    if (!dto.menuItemId || typeof dto.menuItemId !== 'string') {
      const error: any = new Error('menuItemId requerido');
      error.statusCode = 400;
      error.code = 'INVALID_MENU_ITEM_ID';
      throw error;
    }

    // Tenant Isolation: Resolver plato estrictamente dentro del restaurante de la sesión
    const menuItem = await prisma.menuItem.findFirst({
      where: {
        id: dto.menuItemId,
        category: {
          restaurantId: session.table.restaurantId
        }
      },
      include: {
        category: true
      }
    });

    if (!menuItem) {
      const error: any = new Error('El plato seleccionado no pertenece al menú de este restaurante o no existe');
      error.statusCode = 404;
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }

    // Disponibilidad de stock del plato
    if (!menuItem.isAvailable) {
      const error: any = new Error('El plato seleccionado no está disponible');
      error.statusCode = 422;
      error.code = 'ITEM_NOT_AVAILABLE';
      throw error;
    }

    // Buscar o crear orden DRAFT propia de la sesión (solo se modifica DRAFT)
    let order = await prisma.order.findFirst({
      where: {
        tableSessionId: session.id,
        status: OrderStatus.DRAFT
      }
    });

    if (!order) {
      order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.DRAFT,
          totalAmount: 0
        }
      });
    }

    // Crear el ítem: precio unitario SIEMPRE tomado del servidor (menuItem.price de la BD)
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: menuItem.id,
        quantity: qty,
        unitPrice: menuItem.price, // PRECIO DEL SERVIDOR (Inmune a manipulación en el cliente)
        notes: dto.notes ? dto.notes.trim() : null,
        addedByGuest: dto.guestSessionId || 'guest-web',
        guestName,
        claimVersion: 0,
        isPaid: false
      }
    });

    // Recalcular total estrictamente en el servidor: sum(unitPrice * quantity)
    const allItems = await prisma.orderItem.findMany({
      where: { orderId: order.id }
    });
    const newTotal = allItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const safeTotal = Math.max(0, Math.round(newTotal * 100) / 100);

    await prisma.order.update({
      where: { id: order.id },
      data: { totalAmount: safeTotal }
    });

    const fullOrder = await this.getActiveOrder(session.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    // Broadcast SSE a la mesa y staff
    eventBus.broadcast(session.table.restaurantId, 'order.updated', {
      tableId: session.tableId,
      tableLabel: session.table.label,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Elimina un ítem del carrito colaborativo.
   * Reglas de seguridad:
   * - Solo se permite modificar DRAFT propio de la sesión.
   * - Una vez enviada la comanda a cocina, los ítems no pueden ser alterados o removidos (409).
   */
  static async removeItem(sessionToken: string, orderItemId: string): Promise<OrderDTO> {
    const session = await this.validateActiveGuestSession(sessionToken);

    if (!orderItemId || typeof orderItemId !== 'string') {
      const error: any = new Error('ID de ítem inválido');
      error.statusCode = 400;
      error.code = 'INVALID_ORDER_ITEM_ID';
      throw error;
    }

    const item = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true }
    });

    if (!item || item.order.tableSessionId !== session.id) {
      const error: any = new Error('Ítem no encontrado en la comanda de esta mesa');
      error.statusCode = 404;
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }

    // Solo se permite modificar DRAFT propio: prohibido modificar pedidos ya enviados o confirmados
    if (item.order.status !== OrderStatus.DRAFT) {
      const error: any = new Error('No se pueden modificar o eliminar platos de una comanda ya enviada o confirmada');
      error.statusCode = 409;
      error.code = 'ORDER_NOT_IN_DRAFT';
      throw error;
    }

    if (item.isPaid) {
      const error: any = new Error('No se puede eliminar un ítem que ya fue pagado');
      error.statusCode = 409;
      error.code = 'ITEM_ALREADY_PAID';
      throw error;
    }

    await prisma.orderItem.delete({
      where: { id: orderItemId }
    });

    // Recalcular total en el servidor
    const allItems = await prisma.orderItem.findMany({
      where: { orderId: item.orderId }
    });
    const newTotal = allItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const safeTotal = Math.max(0, Math.round(newTotal * 100) / 100);

    await prisma.order.update({
      where: { id: item.orderId },
      data: { totalAmount: safeTotal }
    });

    const fullOrder = await this.getActiveOrder(session.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    eventBus.broadcast(session.table.restaurantId, 'order.updated', {
      tableId: session.tableId,
      tableLabel: session.table.label,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Envía la comanda de la mesa para validación del mozo o confirmación directa en cocina.
   * Reglas de seguridad:
   * - Sesión activa centralizada (404/410).
   * - Flag de comandas digitales en servidor (403).
   * - Envío repetido es IDEMPOTENTE: no duplica comanda ni líneas de ítems.
   * - Rechaza transiciones desde estados finales (PAID/CANCELLED) (409).
   */
  static async submitOrder(sessionToken: string): Promise<OrderDTO> {
    const session = await this.validateActiveGuestSession(sessionToken);

    // Flag en servidor: permitir pedidos digitales
    if (session.table?.restaurant?.moduleConfig && session.table.restaurant.moduleConfig.allowOrdering === false) {
      const error: any = new Error('Las comandas digitales están desactivadas en este restaurante (Modo Carta Informativa)');
      error.statusCode = 403;
      error.code = 'ORDERING_DISABLED';
      throw error;
    }

    // Buscar orden en DRAFT con sus ítems
    const draftOrder = await prisma.order.findFirst({
      where: { tableSessionId: session.id, status: OrderStatus.DRAFT },
      include: { items: true }
    });

    // Envío repetido (idempotente): si ya no hay DRAFT pero hay una orden activa enviada,
    // se devuelve la orden existente sin duplicar ni recrear comanda ni ítems.
    if (!draftOrder) {
      const activeSubmittedOrder = await prisma.order.findFirst({
        where: {
          tableSessionId: session.id,
          status: {
            in: [
              OrderStatus.PENDING_VALIDATION,
              OrderStatus.CONFIRMED,
              OrderStatus.IN_KITCHEN,
              OrderStatus.READY_TO_SERVE,
              OrderStatus.SERVED
            ]
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (activeSubmittedOrder) {
        const fullExisting = await this.getActiveOrder(session.id);
        if (fullExisting) {
          return fullExisting; // Idempotente: conserva una sola comanda lógica
        }
      }

      // Comprobar si la única comanda está en estado final
      const finalOrder = await prisma.order.findFirst({
        where: {
          tableSessionId: session.id,
          status: { in: [OrderStatus.PAID, OrderStatus.CANCELLED] }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (finalOrder) {
        const error: any = new Error('La comanda se encuentra en un estado final y no puede ser re-enviada');
        error.statusCode = 409;
        error.code = 'ORDER_FINAL_STATE';
        throw error;
      }

      const error: any = new Error('No hay ítems en la comanda para enviar');
      error.statusCode = 400;
      error.code = 'EMPTY_ORDER';
      throw error;
    }

    if (draftOrder.items.length === 0) {
      const error: any = new Error('No hay ítems en la comanda para enviar');
      error.statusCode = 400;
      error.code = 'EMPTY_ORDER';
      throw error;
    }

    // Aplicar flag requireWaiterValidation en servidor
    const requireValidation = session.table.restaurant.moduleConfig?.requireWaiterValidation ?? true;
    const nextStatus = requireValidation ? OrderStatus.PENDING_VALIDATION : OrderStatus.IN_KITCHEN;

    await prisma.order.update({
      where: { id: draftOrder.id },
      data: { status: nextStatus }
    });

    const fullOrder = await this.getActiveOrder(session.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    // Notificar al mozo y a los comensales
    eventBus.broadcast(session.table.restaurantId, 'order.submitted', {
      tableId: session.tableId,
      tableLabel: session.table.label,
      sector: session.table.sector,
      requiresValidation: requireValidation,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Validación del mozo para comanda (Doble control).
   * Reglas de seguridad:
   * - Rechaza validación si la comanda está en estado final (PAID/CANCELLED) (409).
   * - Idempotente si ya está en IN_KITCHEN.
   */
  /**
   * Validación del mozo para comanda (Doble control).
   * Reglas de seguridad:
   * - Staff del tenant autenticado (403 STAFF_TENANT_MISMATCH).
   * - Rechaza validación si la comanda está en estado final (PAID/CANCELLED) (409).
   * - Idempotente si ya está en IN_KITCHEN.
   * - Valida transición permitida según ALLOWED_ORDER_TRANSITIONS (422).
   */
  static async validateOrder(
    orderId: string,
    _staffName: string = 'Mozo',
    staffRestaurantId?: string
  ): Promise<OrderDTO> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { tableSession: { include: { table: true } } }
    });

    if (!order) {
      const error: any = new Error('Orden no encontrada');
      error.statusCode = 404;
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    if (staffRestaurantId && order.tableSession.table.restaurantId !== staffRestaurantId) {
      const error: any = new Error('No autorizado para gestionar comandas de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    // Rechazar transiciones desde estados finales
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
      const error: any = new Error('No se puede validar una comanda que se encuentra en un estado final');
      error.statusCode = 409;
      error.code = 'ORDER_FINAL_STATE';
      throw error;
    }

    if (order.status === OrderStatus.IN_KITCHEN) {
      const fullOrder = await this.getOrderById(order.id);
      return fullOrder!;
    }

    // Validar transición permitida
    const allowed = ALLOWED_ORDER_TRANSITIONS[order.status as OrderStatus];
    if (!allowed || !allowed.includes(OrderStatus.IN_KITCHEN)) {
      const error: any = new Error(`Transición no permitida: no se puede validar una comanda en estado ${order.status}`);
      error.statusCode = 422;
      error.code = 'INVALID_ORDER_TRANSITION';
      throw error;
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.IN_KITCHEN }
    });

    const fullOrder = await this.getOrderById(order.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    eventBus.broadcast(order.tableSession.table.restaurantId, 'order.validated', {
      tableId: order.tableSession.tableId,
      tableLabel: order.tableSession.table.label,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Carga directa de comanda por el mozo desde su panel / tablet.
   * Resuelve la necesidad operativa de mesas que piden verbalmente al camarero,
   * unificando el 100% de los pedidos en el KDS de cocina sin tickets en papel.
   * Reglas de seguridad:
   * - Aislamiento de tenant para la mesa (403).
   * - Aislamiento de tenant para el plato (404).
   * - Validación estricta de cantidad (1..50) y longitud de notas (<=500).
   */
  static async addItemByStaff(params: {
    tableId: string;
    menuItemId: string;
    quantity: number;
    notes?: string;
    staffUserId?: string;
    staffName?: string;
    staffRestaurantId?: string;
  }): Promise<OrderDTO> {
    const table = await prisma.table.findUnique({
      where: { id: params.tableId },
      include: { restaurant: true }
    });

    if (!table) {
      const error: any = new Error('Mesa no encontrada');
      error.statusCode = 404;
      error.code = 'TABLE_NOT_FOUND';
      throw error;
    }

    if (params.staffRestaurantId && table.restaurantId !== params.staffRestaurantId) {
      const error: any = new Error('No autorizado para gestionar mesas de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    const qty = params.quantity;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) {
      const error: any = new Error('La cantidad debe ser un número entero positivo mayor a 0');
      error.statusCode = 400;
      error.code = 'INVALID_QUANTITY';
      throw error;
    }

    const MAX_ITEM_QUANTITY = 50;
    if (qty > MAX_ITEM_QUANTITY) {
      const error: any = new Error(`La cantidad máxima permitida por ítem es ${MAX_ITEM_QUANTITY}`);
      error.statusCode = 400;
      error.code = 'QUANTITY_LIMIT_EXCEEDED';
      throw error;
    }

    if (params.notes && (typeof params.notes !== 'string' || params.notes.length > 500)) {
      const error: any = new Error('Las notas del plato no pueden superar los 500 caracteres');
      error.statusCode = 400;
      error.code = 'NOTES_TOO_LONG';
      throw error;
    }

    // Tenant Isolation: el plato debe pertenecer al restaurante de la mesa
    const menuItem = await prisma.menuItem.findFirst({
      where: {
        id: params.menuItemId,
        category: { restaurantId: table.restaurantId }
      },
      include: { category: true }
    });

    if (!menuItem) {
      const error: any = new Error('El plato seleccionado no pertenece al menú de este restaurante o no existe');
      error.statusCode = 404;
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }

    if (!menuItem.isAvailable) {
      const error: any = new Error('El plato seleccionado no está disponible');
      error.statusCode = 422;
      error.code = 'ITEM_NOT_AVAILABLE';
      throw error;
    }

    // Buscar o auto-abrir sesión activa para la mesa
    let session = await prisma.tableSession.findFirst({
      where: {
        tableId: table.id,
        closedAt: null,
        expiresAt: { gt: new Date() }
      }
    });

    if (!session) {
      let shift = await prisma.shift.findFirst({
        where: { restaurantId: table.restaurantId, closedAt: null },
        orderBy: { openedAt: 'desc' }
      });
      if (!shift) {
        shift = await prisma.shift.create({
          data: { restaurantId: table.restaurantId }
        });
      }

      session = await prisma.tableSession.create({
        data: {
          tableId: table.id,
          token: randomUUID(),
          shiftId: shift.id,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
        }
      });
    }

    // Buscar orden activa o crearla directamente en estado IN_KITCHEN
    let order = await prisma.order.findFirst({
      where: {
        tableSessionId: session.id,
        status: { in: [OrderStatus.DRAFT, OrderStatus.PENDING_VALIDATION, OrderStatus.IN_KITCHEN, OrderStatus.CONFIRMED] }
      }
    });

    if (!order) {
      order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.IN_KITCHEN,
          totalAmount: 0
        }
      });
    } else if (order.status === OrderStatus.DRAFT || order.status === OrderStatus.PENDING_VALIDATION) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.IN_KITCHEN }
      });
    }

    // Crear el ítem
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: menuItem.id,
        quantity: qty,
        unitPrice: menuItem.price,
        notes: params.notes ? `${params.notes} (Cargado por ${params.staffName || 'Mozo'})` : `(Cargado por ${params.staffName || 'Mozo'})`,
        addedByGuest: params.staffName || 'Mozo'
      }
    });

    // Recalcular total
    const allItems = await prisma.orderItem.findMany({
      where: { orderId: order.id }
    });
    const newTotal = allItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const safeTotal = Math.max(0, Math.round(newTotal * 100) / 100);

    await prisma.order.update({
      where: { id: order.id },
      data: { totalAmount: safeTotal }
    });

    // Actualizar estado FSM de la mesa a ORDER_IN_KITCHEN
    try {
      await fsmService.attemptTransition({
        tableId: table.id,
        toState: TableFSMState.ORDER_IN_KITCHEN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: `Comanda cargada por mozo (${params.staffName || 'Salón'})`,
        staffUserId: params.staffUserId
      });
    } catch (_) {}

    const fullOrder = await this.getOrderById(order.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    // Notificar en tiempo real por SSE al monitor de cocina y al celular del comensal
    eventBus.broadcast(table.restaurantId, 'order.submitted', {
      tableId: table.id,
      tableLabel: table.label,
      sector: table.sector,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Actualiza el estado de una comanda (ej: IN_KITCHEN -> READY_TO_SERVE -> SERVED).
   * Reglas de seguridad:
   * - Aislamiento tenant por staff autenticado (403).
   * - Validación contra esquema enum de OrderStatus (400).
   * - Rechaza modificaciones desde estados finales (PAID/CANCELLED) (409).
   * - Idempotente si el estado actual es igual al nuevo estado (200).
   * - Valida tabla pequeña de transiciones permitidas (422).
   * - Confirmación manual de cobro sólo para manager autenticado (403),
   *   registrando actor, fecha y método presencial trazable sin crear APPROVED digital.
   * - Corrección PAID -> EATING: comanda cobrada transiciona mesa a PAID, no a EATING.
   */
  static async updateOrderStatusByStaff(
    orderId: string,
    newStatus: OrderStatus,
    options?: {
      staffRestaurantId?: string;
      staffRole?: string;
      staffUserId?: string;
      paymentMethod?: string;
      tipAmount?: number;
    }
  ): Promise<OrderDTO> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { tableSession: { include: { table: true } } }
    });

    if (!order) {
      const error: any = new Error('Comanda no encontrada');
      error.statusCode = 404;
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }

    if (options?.staffRestaurantId && order.tableSession.table.restaurantId !== options.staffRestaurantId) {
      const error: any = new Error('No autorizado para modificar comandas de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    // Validar contra esquema enum OrderStatus
    if (!Object.values(OrderStatus).includes(newStatus)) {
      const error: any = new Error(`Estado de comanda inválido: ${newStatus}`);
      error.statusCode = 400;
      error.code = 'INVALID_ORDER_STATUS';
      throw error;
    }

    // Rechazar transiciones o segundo cierre desde estados finales
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
      const error: any = new Error('No se puede modificar una comanda que se encuentra en un estado final');
      error.statusCode = 409;
      error.code = 'ORDER_FINAL_STATE';
      throw error;
    }

    // Idempotencia para estados intermedios/operativos
    if (order.status === newStatus) {
      const fullOrder = await this.getOrderById(order.id);
      return fullOrder!;
    }

    // Confirmación manual de cobro (PAID): reservada a MANAGER autenticado
    if (newStatus === OrderStatus.PAID) {
      if (options?.staffRole !== 'MANAGER') {
        const error: any = new Error('Solo un encargado (MANAGER) autenticado puede confirmar el cobro manual de la comanda');
        error.statusCode = 403;
        error.code = 'MANAGER_ROLE_REQUIRED';
        throw error;
      }

      // Validar método presencial trazable
      const rawMethod = (options?.paymentMethod || 'WAITER_CASH').toUpperCase();
      const isCard = rawMethod === 'CARD' || rawMethod === 'WAITER_CARD' || rawMethod === 'POS_PHYSICAL';
      const isCash = rawMethod === 'CASH' || rawMethod === 'WAITER_CASH';
      if (!isCard && !isCash) {
        const error: any = new Error('Método de cobro presencial no válido. Permitidos: WAITER_CASH, WAITER_CARD, CASH, CARD');
        error.statusCode = 400;
        error.code = 'INVALID_PAYMENT_METHOD';
        throw error;
      }
      const physicalMethod = isCard ? 'WAITER_CARD' : 'WAITER_CASH';

      // Validar que la comanda esté en un estado factible de cobro (SERVED, IN_KITCHEN, READY_TO_SERVE)
      const allowed = ALLOWED_ORDER_TRANSITIONS[order.status as OrderStatus];
      if (!allowed || !allowed.includes(OrderStatus.PAID)) {
        const error: any = new Error(`Transición no permitida: no se puede cobrar una comanda en estado ${order.status}`);
        error.statusCode = 422;
        error.code = 'INVALID_ORDER_TRANSITION';
        throw error;
      }

      // Registrar cobro presencial trazable sin crear 'APPROVED' digital de pasarela
      await prisma.paymentTransaction.create({
        data: {
          idempotencyKey: `manual_pay_${order.id}_${Date.now()}_${randomUUID().slice(0, 8)}`,
          orderId: order.id,
          tableSessionId: order.tableSessionId,
          guestSessionId: options?.staffUserId || 'manager-in-person',
          method: physicalMethod,
          amount: order.totalAmount,
          tipAmount: Math.max(0, options?.tipAmount || 0),
          mpPaymentId: null, // NUNCA confirmación digital de proveedor externo
          status: 'MANUAL_SETTLED', // Estado manual presencial trazable
          resolvedAt: new Date()
        }
      });
    } else {
      // Validar tabla pequeña de transiciones permitidas
      const allowed = ALLOWED_ORDER_TRANSITIONS[order.status as OrderStatus];
      if (!allowed || !allowed.includes(newStatus)) {
        const error: any = new Error(`Transición no permitida: no se puede pasar de ${order.status} a ${newStatus}`);
        error.statusCode = 422;
        error.code = 'INVALID_ORDER_TRANSITION';
        throw error;
      }
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: newStatus }
    });

    const restaurantId = order.tableSession.table.restaurantId;

    // Actualización de estado en FSM de la mesa
    if (newStatus === OrderStatus.SERVED) {
      try {
        await fsmService.attemptTransition({
          tableId: order.tableSession.tableId,
          toState: TableFSMState.EATING,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: `Comanda marcada como servida`,
          staffUserId: options?.staffUserId
        });
      } catch (_) {}
    } else if (newStatus === OrderStatus.PAID) {
      // CORRECCIÓN PAID -> EATING:
      // Al cobrar la comanda, la mesa pasa a PAID (comensales finalizando la sobremesa antes de salir),
      // JAMÁS se regresa la mesa a EATING.
      try {
        const currentTableState = order.tableSession.table.currentState;
        if (currentTableState === TableFSMState.EATING || currentTableState === TableFSMState.BILL_REQUESTED) {
          await fsmService.attemptTransition({
            tableId: order.tableSession.tableId,
            toState: TableFSMState.PAID,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: `Comanda cobrada presencialmente por encargado`,
            staffUserId: options?.staffUserId
          });
        }
      } catch (_) {}
    }

    const fullOrder = await this.getOrderById(order.id);
    if (!fullOrder) throw new Error('Error al recargar orden');

    eventBus.broadcast(restaurantId, 'order.status_changed', {
      orderId: order.id,
      tableId: order.tableSession.tableId,
      tableLabel: order.tableSession.table.label,
      newStatus,
      order: fullOrder
    });

    if (newStatus === OrderStatus.PAID) {
      eventBus.broadcast(restaurantId, 'order.paid', {
        orderId: order.id,
        tableId: order.tableSession.tableId,
        tableLabel: order.tableSession.table.label,
        totalAmount: order.totalAmount,
        paidAt: new Date().toISOString()
      });
    }

    return fullOrder;
  }

  /**
   * Endpoint de cobro manual presencial para manager.
   */
  static async registerManualPayment(params: {
    orderId: string;
    staffRestaurantId: string;
    staffRole: string;
    staffUserId: string;
    paymentMethod?: string;
    tipAmount?: number;
  }) {
    const updatedOrder = await this.updateOrderStatusByStaff(params.orderId, OrderStatus.PAID, {
      staffRestaurantId: params.staffRestaurantId,
      staffRole: params.staffRole,
      staffUserId: params.staffUserId,
      paymentMethod: params.paymentMethod,
      tipAmount: params.tipAmount
    });

    const paymentTx = await prisma.paymentTransaction.findFirst({
      where: { orderId: params.orderId },
      orderBy: { createdAt: 'desc' }
    });

    return {
      order: updatedOrder,
      transaction: paymentTx
        ? {
            id: paymentTx.id,
            method: paymentTx.method,
            amount: paymentTx.amount,
            tipAmount: paymentTx.tipAmount,
            status: paymentTx.status,
            recordedBy: paymentTx.guestSessionId,
            resolvedAt: paymentTx.resolvedAt?.toISOString() || null
          }
        : null
    };
  }

  /**
   * Consulta centralizada de todas las comandas activas para la pantalla de cocina (KDS).
   * Unifica pedidos realizados por comensales (QR) y pedidos cargados por los mozos en salón.
   * Reglas de seguridad:
   * - Aislamiento tenant por staff autenticado (403).
   */
  static async getKitchenOrders(restaurantIdOrSlug: string, staffRestaurantId?: string) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] }
    });

    if (!restaurant) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      error.code = 'RESTAURANT_NOT_FOUND';
      throw error;
    }

    if (staffRestaurantId && restaurant.id !== staffRestaurantId) {
      const error: any = new Error('No autorizado para consultar comandas de cocina de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    const orders = await prisma.order.findMany({
      where: {
        tableSession: { table: { restaurantId: restaurant.id } },
        status: { in: [OrderStatus.PENDING_VALIDATION, OrderStatus.IN_KITCHEN, OrderStatus.READY_TO_SERVE] }
      },
      include: {
        tableSession: {
          include: {
            table: true
          }
        },
        items: {
          include: {
            menuItem: { select: { name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const now = Date.now();

    return orders.map((o) => {
      const elapsedMinutes = Math.max(0, Math.floor((now - o.createdAt.getTime()) / 60000));
      return {
        id: o.id,
        tableId: o.tableSession.tableId,
        tableLabel: o.tableSession.table.label,
        sector: o.tableSession.table.sector,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt.toISOString(),
        elapsedMinutes,
        urgency: elapsedMinutes >= 25 ? 'CRITICAL' : elapsedMinutes >= 15 ? 'WARNING' : 'NORMAL',
        items: o.items.map((it) => ({
          id: it.id,
          name: it.menuItem.name,
          quantity: it.quantity,
          notes: it.notes,
          unitPrice: it.unitPrice,
          addedByGuest: it.addedByGuest,
          guestName: it.guestName
        }))
      };
    });
  }

  /**
   * Reclamo de ítem en Split Bill.
   * BLOQUEADO EN PILOTO PRESENCIAL: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
   * Ninguna bandera de restaurante (allowSplitBill) puede saltar este bloqueo.
   */
  static async claimItemOptimistic(_dto: ClaimItemDTO): Promise<boolean> {
    throw new DigitalPaymentsUnavailableError();
  }

  /**
   * Crea o consulta una sesión de Split Bill.
   * BLOQUEADO EN PILOTO PRESENCIAL: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
   * Ninguna bandera de restaurante (allowSplitBill) puede saltar este bloqueo.
   */
  static async createOrGetSplitSession(
    _orderId: string,
    _mode: SplitMode,
    _totalParts: number = 1
  ): Promise<SplitBillSessionDTO> {
    throw new DigitalPaymentsUnavailableError();
  }

  /**
   * Registra el pago de una parte en Split Bill.
   * BLOQUEADO EN PILOTO PRESENCIAL: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
   * Ninguna bandera de restaurante (allowSplitBill) puede saltar este bloqueo.
   */
  static async payEqualPart(
    _splitSessionId: string,
    _guestSessionId: string,
    _paymentMethod: string = 'MERCADO_PAGO'
  ): Promise<SplitBillSessionDTO> {
    throw new DigitalPaymentsUnavailableError();
  }

  /*
   * ============================================================================
   * HISTORIAL / LÓGICA PRE-PILOTO (PRESERVADA PARA INTEGRACIÓN POST-PILOTO)
   * No borrar historial: Lógica conservada para cuando se integre pasarela real.
   * ============================================================================
   *
   * static async __historical_claimItemOptimistic(dto: ClaimItemDTO): Promise<boolean> {
   *   const item = await prisma.orderItem.findUnique({
   *     where: { id: dto.orderItemId },
   *     include: { order: true }
   *   });
   *   if (!item) return false;
   *   const activeEqualSplit = await prisma.splitBillSession.findFirst({
   *     where: { orderId: item.orderId, mode: SplitMode.EQUAL_PARTS, status: 'OPEN', paidParts: { gt: 0 } }
   *   });
   *   if (activeEqualSplit) {
   *     throw new Error('La mesa ya tiene un pago en curso por partes iguales. No se pueden reclamar platos individuales.');
   *   }
   *   const affected = await prisma.$executeRaw`
   *     UPDATE "OrderItem"
   *     SET "claimedByGuest" = ${dto.guestSessionId}, "claimVersion" = "claimVersion" + 1
   *     WHERE "id" = ${dto.orderItemId} AND "claimVersion" = ${dto.expectedVersion} AND "claimedByGuest" IS NULL
   *   `;
   *   return affected > 0;
   * }
   *
   * static async __historical_createOrGetSplitSession(orderId: string, mode: SplitMode, totalParts: number = 1): Promise<SplitBillSessionDTO> {
   *   const order = await prisma.order.findUnique({
   *     where: { id: orderId },
   *     include: {
   *       tableSession: { include: { table: { include: { restaurant: { include: { moduleConfig: true } } } } } },
   *       items: true
   *     }
   *   });
   *   if (!order) throw new Error('Orden no encontrada');
   *   if (order.tableSession?.table?.restaurant?.moduleConfig && order.tableSession.table.restaurant.moduleConfig.allowSplitBill === false) {
   *     throw new Error('La división de cuenta (Split Bill) está deshabilitada en este local');
   *   }
   *   if (mode === SplitMode.EQUAL_PARTS) {
   *     const hasClaimedItems = order.items.some(i => i.claimedByGuest !== null || i.isPaid);
   *     if (hasClaimedItems) {
   *       throw new Error('La mesa ya tiene platos reclamados o pagados por comensales individuales. No se puede iniciar división en partes iguales sin reiniciar.');
   *     }
   *   }
   *   let session = await prisma.splitBillSession.findFirst({
   *     where: { orderId, status: 'OPEN' }
   *   });
   *   if (!session) {
   *     const partAmount = mode === SplitMode.EQUAL_PARTS ? Math.round((order.totalAmount / totalParts) * 100) / 100 : null;
   *     session = await prisma.splitBillSession.create({
   *       data: {
   *         orderId,
   *         mode,
   *         totalParts: mode === SplitMode.EQUAL_PARTS ? totalParts : 1,
   *         paidParts: 0,
   *         partAmount,
   *         totalAmount: order.totalAmount,
   *         remainingAmount: order.totalAmount,
   *         status: 'OPEN'
   *       }
   *     });
   *   }
   *   return {
   *     id: session.id,
   *     orderId: session.orderId,
   *     mode: session.mode as SplitMode,
   *     totalParts: session.totalParts,
   *     paidParts: session.paidParts,
   *     partAmount: session.partAmount,
   *     totalAmount: session.totalAmount,
   *     remainingAmount: session.remainingAmount,
   *     status: session.status as 'OPEN' | 'FULLY_PAID' | 'CANCELLED',
   *     createdAt: session.createdAt.toISOString()
   *   };
   * }
   *
   * static async __historical_payEqualPart(splitSessionId: string, guestSessionId: string, paymentMethod: string = 'MERCADO_PAGO'): Promise<SplitBillSessionDTO> {
   *   const session = await prisma.splitBillSession.findUnique({
   *     where: { id: splitSessionId },
   *     include: { order: { include: { tableSession: { include: { table: true } } } } }
   *   });
   *   if (!session || session.status !== 'OPEN') throw new Error('Sesión de división no encontrada o ya finalizada');
   *   if (session.paidParts >= session.totalParts) throw new Error('Todas las partes ya fueron abonadas');
   *   const newPaidParts = session.paidParts + 1;
   *   const isLastPart = (newPaidParts === session.totalParts);
   *   const partAmount = isLastPart ? session.remainingAmount : (session.partAmount || Math.round((session.totalAmount / session.totalParts) * 100) / 100);
   *   const newRemaining = Math.max(0, Math.round((session.remainingAmount - partAmount) * 100) / 100);
   *   const isFullyPaid = newPaidParts >= session.totalParts || newRemaining <= 0.01;
   *   const [updatedSession] = await prisma.$transaction([
   *     prisma.splitBillSession.update({
   *       where: { id: splitSessionId },
   *       data: { paidParts: newPaidParts, remainingAmount: newRemaining, status: isFullyPaid ? 'FULLY_PAID' : 'OPEN' }
   *     }),
   *     prisma.paymentTransaction.create({
   *       data: {
   *         idempotencyKey: `part_${session.id}_${newPaidParts}_${Date.now()}`,
   *         orderId: session.orderId,
   *         tableSessionId: session.order.tableSessionId,
   *         splitSessionId: session.id,
   *         guestSessionId,
   *         amount: partAmount,
   *         method: paymentMethod,
   *         status: 'APPROVED'
   *       }
   *     }),
   *     ...(isFullyPaid ? [prisma.order.update({ where: { id: session.orderId }, data: { status: OrderStatus.PAID } })] : [])
   *   ]);
   *   return {
   *     id: updatedSession.id,
   *     orderId: updatedSession.orderId,
   *     mode: updatedSession.mode as SplitMode,
   *     totalParts: updatedSession.totalParts,
   *     paidParts: updatedSession.paidParts,
   *     partAmount: updatedSession.partAmount,
   *     totalAmount: updatedSession.totalAmount,
   *     remainingAmount: updatedSession.remainingAmount,
   *     status: updatedSession.status as 'OPEN' | 'FULLY_PAID' | 'CANCELLED',
   *     createdAt: updatedSession.createdAt.toISOString()
   *   };
   * }
   */

  /**
   * Verifica si una mesa tiene saldo pendiente de cobro o llamados de cuenta sin resolver.
   * Usado como guard previo al cierre de mesa por parte de mozos de salón.
   */
  static async hasUnpaidBalance(tableId: string): Promise<{
    hasUnpaid: boolean;
    remainingAmount: number;
    pendingBillCalls: number;
    activeOrdersCount: number;
  }> {
    const activeSession = await prisma.tableSession.findFirst({
      where: { tableId, closedAt: null },
      include: {
        orders: {
          where: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PAID] } },
          include: {
            payments: {
              where: { status: 'APPROVED' }
            }
          }
        },
        calls: {
          where: {
            type: 'BILL',
            status: { in: ['PENDING', 'IN_PROGRESS'] }
          }
        }
      }
    });

    if (!activeSession) {
      return {
        hasUnpaid: false,
        remainingAmount: 0,
        pendingBillCalls: 0,
        activeOrdersCount: 0
      };
    }

    let remainingAmount = 0;
    for (const order of activeSession.orders) {
      const paidTotal = order.payments.reduce((sum, p) => sum + p.amount, 0);
      const diff = Math.max(0, order.totalAmount - paidTotal);
      remainingAmount += diff;
    }

    const pendingBillCalls = activeSession.calls.length;
    const hasUnpaid = remainingAmount > 0.01 || pendingBillCalls > 0;

    return {
      hasUnpaid,
      remainingAmount: Math.round(remainingAmount * 100) / 100,
      pendingBillCalls,
      activeOrdersCount: activeSession.orders.length
    };
  }
}
