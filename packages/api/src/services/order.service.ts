import { randomUUID, createHash } from 'crypto';
import { isRestaurantInConfiguredInstance } from '../lib/environment';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { fsmService } from './fsm.service';
import { SessionService } from './session.service';
import { RewardsService, normalizeRewardsPhone } from './rewards.service';
import {
  OrderStatus,
  OrderDTO,
  AddOrderItemDTO,
  ClaimItemDTO,
  SplitMode,
  SplitBillSessionDTO,
  TableFSMState,
  SignalSource,
  DEFAULT_REVIEW_QUANTITY_THRESHOLD,
  ServiceReviewReasonDTO
} from '@mesaya/shared';

export class DigitalPaymentsUnavailableError extends Error {
  readonly statusCode: number = 503;
  readonly code: string = 'DIGITAL_PAYMENTS_UNAVAILABLE';

  constructor(message = 'Pagos digitales y división de cuenta no disponibles en esta release; el cobro es presencial') {
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

/** Línea de tanda dentro de la cuenta de sesión (B03). Importes en centavos. */
export interface SessionTandaLineDTO {
  orderId: string;
  status: OrderStatus;
  totalMinor: number;
  createdAt: string;
  updatedAt: string;
  cancellationReason?: string;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    guestName?: string | null;
  }>;
}

/** Cuenta agregada de una TableSession (B03, contrato C1–C4). Importes en centavos. */
export interface SessionAccountDTO {
  tableSessionId: string;
  tableId: string;
  version: string;
  unit: 'ARS_MINOR';
  consumoMinor: number;
  paidMinor: number;
  tipMinor: number;
  saldoMinor: number;
  tandas: SessionTandaLineDTO[];
  pendingValidation: Array<{ orderId: string; totalMinor: number; createdAt: string; updatedAt: string }>;
  draft: { orderId: string; totalMinor: number; createdAt: string; updatedAt: string } | null;
}

/**
 * Dinero en centavos como PROYECCIÓN redondeada desde el Float legado (C3, estado B03).
 * La aritmética de cuenta ocurre en enteros, pero NADA está persistido en minor-unit:
 * la migración/backfill y el ledger objetivo siguen NEEDS_REVIEW/B04. No afirmar
 * "exacto persistido".
 */
function toMinor(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

type OrderReviewReason = Pick<ServiceReviewReasonDTO, 'code' | 'detail'>;

const REVIEW_REASON_LABELS: Record<ServiceReviewReasonDTO['code'], string> = {
  WAITER_VALIDATION_REQUIRED: 'Revisión manual requerida',
  STOCK_UNAVAILABLE: 'Stock cambió antes del envío',
  QUANTITY_THRESHOLD: 'Cantidad fuera del umbral'
};

export function formatOrderReviewReason(code: unknown, detail?: unknown): ServiceReviewReasonDTO | null {
  if (typeof code !== 'string' || !(code in REVIEW_REASON_LABELS)) return null;
  return {
    code: code as ServiceReviewReasonDTO['code'],
    label: REVIEW_REASON_LABELS[code as ServiceReviewReasonDTO['code']],
    detail: typeof detail === 'string' && detail.trim() ? detail : null
  };
}

function reviewReasonForSubmission(params: {
  requireValidation: boolean;
  reviewQuantityThreshold: number;
  unavailableItems: Array<{ name?: string | null }>;
  oversizedItems: Array<{ name?: string | null; quantity: number }>;
}): OrderReviewReason | null {
  const unavailable = params.unavailableItems[0];
  if (unavailable) {
    return {
      code: 'STOCK_UNAVAILABLE',
      detail: `El plato "${unavailable.name || 'seleccionado'}" cambió a no disponible; revisá stock antes de enviarlo a cocina.`
    };
  }

  const oversized = params.oversizedItems[0];
  if (oversized) {
    return {
      code: 'QUANTITY_THRESHOLD',
      detail: `${oversized.quantity} unidades de "${oversized.name || 'un plato'}" superan el umbral configurado de ${params.reviewQuantityThreshold}; verificá la intención antes de enviarlas.`
    };
  }

  if (params.requireValidation) {
    return {
      code: 'WAITER_VALIDATION_REQUIRED',
      detail: 'El modo manual del local mantiene la comanda pendiente hasta que un mozo la confirme.'
    };
  }

  return null;
}

/**
 * Tandas que integran consumo cobrable: aceptadas no canceladas (C2/I1).
 * PAID se conserva como historial para que I2 (saldo = consumo − pagos) sea consistente.
 */
const SESSION_CONSUMO_STATUSES: readonly OrderStatus[] = Object.freeze([
  OrderStatus.CONFIRMED,
  OrderStatus.IN_KITCHEN,
  OrderStatus.READY_TO_SERVE,
  OrderStatus.SERVED,
  OrderStatus.PAID
]);

/** Métodos presenciales aceptados por el camino nuevo de liquidación (B04/C4 + Ventas y cobros). */
const SETTLE_METHODS: readonly string[] = Object.freeze([
  'WAITER_CASH',
  'WAITER_CARD',
  'WAITER_CARD_DEBIT',
  'WAITER_CARD_CREDIT',
  'WAITER_MP_QR',
  'WAITER_TRANSFER'
]);

/** Liquidación registrada por el camino nuevo (importes en centavos). */
export interface SettlementDTO {
  id: string;
  tableSessionId: string;
  restaurantId: string;
  method: string;
  amountMinor: number;
  tipMinor: number;
  status: string;
  accountVersion: string;
  idempotencyKey: string;
  createdBy: string;
  responsibleStaffUserId?: string | null;
  createdAt: string;
  allocations: Array<{ orderId: string; amountMinor: number }>;
}

/** Entrada del camino nuevo de liquidación por cuenta (B04). */
export interface SettleSessionInput {
  tableSessionId: string;
  staffUserId: string;
  staffRestaurantId: string;
  staffRole: string;
  method: string;
  idempotencyKey: string;
  expectedAccountVersion: string;
  responsibleStaffUserId?: string;
  amountMinor?: number;
  tipMinor?: number;
  allocations?: Array<{ orderId: string; amountMinor: number }>;
}

export class OrderService {
  /**
   * Toque de serialización (B06): PRIMERA sentencia de toda tx que muta la cuenta.
   * Incrementa mutationSeq tomando el lock de escritura de la fila TableSession
   * (portable SQLite/PostgreSQL) y valida vigencia sobre lo recién leído. Toda
   * lectura posterior en la tx ocurre después del lock; toda verificación final
   * compara la serie. En PostgreSQL el lock bloquea al contendiente (serialización
   * real); en SQLite el conflicto emerge como error ocupado → 409 accionable.
   * Sin catch-continue dentro de la tx: ante P2002/P2034 se aborta y el llamante
   * decide (reintento limpio solo si nada se escribió antes del fallo, o 409).
   */
  private static async touchSessionTx(
    client: any,
    tableSessionId: string
  ): Promise<{ closedAt: Date | null; expiresAt: Date; mutationSeq: number }> {
    await client.tableSession.updateMany({
      where: { id: tableSessionId },
      data: { mutationSeq: { increment: 1 } }
    });
    const session = await client.tableSession.findUnique({
      where: { id: tableSessionId },
      select: { closedAt: true, expiresAt: true, mutationSeq: true }
    });
    if (!session) {
      const error: any = new Error('Sesión de mesa no encontrada o código QR no válido');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }
    return session as { closedAt: Date | null; expiresAt: Date; mutationSeq: number };
  }

  /**
   * Guarda de vigencia post-lock (B06): 410 si la sesión está cerrada o expirada.
   * Se llama tras el touch para que el veredicto corra sobre estado post-lock.
   */
  private static assertSessionOpenRow(session: { closedAt: Date | null; expiresAt: Date }) {
    if (session.closedAt !== null) {
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
  }

  /**
   * Una mesa en estado PAID ya fue cerrada operativamente para esa ocupación.
   * La cuenta en saldo cero, en cambio, no basta para bloquear pedidos: el
   * contrato permite que el grupo siga sentado y agregue otra ronda antes de
   * liberar la mesa.
   */
  private static assertSessionCanReceiveOrderState(tableState: TableFSMState): void {
    if (tableState === TableFSMState.PAID) {
      const error: any = new Error(
        'Esta cuenta ya fue cobrada. Liberá la mesa y escaneá el QR de una nueva ocupación antes de pedir otra vez.'
      );
      error.statusCode = 409;
      error.code = 'TABLE_NOT_ORDERABLE';
      error.details = { tableState };
      throw error;
    }
  }

  private static async assertSessionCanReceiveOrderTx(client: any, tableSessionId: string): Promise<void> {
    const session = await client.tableSession.findUnique({
      where: { id: tableSessionId },
      select: { id: true, table: { select: { currentState: true } } }
    });
    if (!session) {
      const error: any = new Error('Sesión de mesa no encontrada o código QR no válido');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }
    OrderService.assertSessionCanReceiveOrderState(
      (session.table.currentState as TableFSMState) || TableFSMState.AVAILABLE
    );
  }

  private static async assertSessionCanReceiveOrder(tableSessionId: string): Promise<void> {
    const session = await prisma.tableSession.findUnique({
      where: { id: tableSessionId },
      select: { id: true, table: { select: { currentState: true } } }
    });
    if (!session) {
      const error: any = new Error('Sesión de mesa no encontrada o código QR no válido');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }
    OrderService.assertSessionCanReceiveOrderState(
      (session.table.currentState as TableFSMState) || TableFSMState.AVAILABLE
    );
  }

  /**
   * Verificación de cierre (B06): ÚLTIMA sentencia de la tx, condicional y sin
   * escritura real. Si otra mutación se intercaló (serie movida), aborta con 409
   * en vez de consolidar sobre estado viejo. Límite honesto: bajo intercalado de
   * sentencias sin aislamiento (una sola conexión SQLite) un commit ajeno entre
   * esta verificación y el commit propio no sería visible; en PostgreSQL el lock
   * del touch lo impide. Ver §27.
   */
  private static async verifySessionUnchanged(
    client: any,
    tableSessionId: string,
    seenSeq: number,
    code: string
  ) {
    const ok = await client.tableSession.updateMany({
      where: { id: tableSessionId, mutationSeq: seenSeq },
      data: { mutationSeq: seenSeq }
    });
    if (ok.count !== 1) {
      const error: any = new Error('La cuenta cambió durante la operación; releé y reintentá de forma consciente');
      error.statusCode = 409;
      error.code = code;
      throw error;
    }
  }

  /**
   * Un pedido presencial no puede dejar una mesa libre con consumo abierto.
   * La comanda se escribe antes de tocar la FSM para que las validaciones de
   * menú sean atómicas; por eso la transición se resuelve aquí, paso a paso,
   * respetando la matriz canónica (AVAILABLE -> OCCUPIED_NO_ORDER ->
   * ORDER_IN_KITCHEN) y reintentando solo conflictos optimistas.
   */
  private static async transitionTableForStaffOrder(params: {
    tableId: string;
    staffUserId?: string;
    trigger: string;
  }): Promise<void> {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const table = await prisma.table.findUnique({
        where: { id: params.tableId },
        select: { currentState: true }
      });

      if (!table) {
        const error: any = new Error('Mesa no encontrada');
        error.statusCode = 404;
        error.code = 'TABLE_NOT_FOUND';
        throw error;
      }

      const current = (table.currentState as TableFSMState) || TableFSMState.AVAILABLE;
      this.assertTableCanReceiveOrder(current);

      let next: TableFSMState;
      // E02: TO_CLEAN nunca reabre ocupación directo; sólo `Mesa lista`
      // (TO_CLEAN → AVAILABLE) habilita la siguiente ocupación.
      if ([TableFSMState.AVAILABLE, TableFSMState.RESERVED].includes(current)) {
        next = TableFSMState.OCCUPIED_NO_ORDER;
      } else if (current === TableFSMState.BILL_REQUESTED) {
        // La cuenta solicitada no impide una nueva ronda: vuelve a servicio.
        next = TableFSMState.EATING;
      } else if (current === TableFSMState.OCCUPIED_NO_ORDER || current === TableFSMState.EATING) {
        next = TableFSMState.ORDER_IN_KITCHEN;
      } else if (current === TableFSMState.ORDER_IN_KITCHEN) {
        // La tanda ya dejó la mesa señalizada en cocina; no se duplica el evento.
        return;
      } else {
        const error: any = new Error(`La mesa no admite pedidos en estado ${current}`);
        error.statusCode = 422;
        error.code = 'TABLE_STATE_NOT_ORDERABLE';
        throw error;
      }

      try {
        await fsmService.attemptTransition({
          tableId: params.tableId,
          toState: next,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: `${params.trigger} (${current} -> ${next})`,
          staffUserId: params.staffUserId,
          expectedCurrentState: current
        });
      } catch (error: any) {
        if (error?.code === 'STATE_CONFLICT' && attempt < maxAttempts - 1) continue;
        throw error;
      }
    }

    const error: any = new Error('La mesa cambió mientras se cargaba el pedido; releé el estado y reintentá');
    error.statusCode = 409;
    error.code = 'STATE_CONFLICT';
    throw error;
  }

  private static assertTableCanReceiveOrder(currentState: TableFSMState): void {
    // E02: TO_CLEAN exige `Mesa lista` antes de cualquier pedido; PAID exige liberación.
    if (currentState === TableFSMState.TO_CLEAN) {
      const error: any = new Error('La mesa está en limpieza; confirmá `Mesa lista` antes de cargar otro pedido');
      error.statusCode = 409;
      error.code = 'TABLE_NEEDS_CLEANING';
      throw error;
    }
    if (currentState === TableFSMState.PAID) {
      const error: any = new Error('La mesa ya fue cobrada y debe liberarse antes de cargar otro pedido');
      error.statusCode = 409;
      error.code = 'TABLE_NOT_ORDERABLE';
      throw error;
    }
  }

  /**
   * Helper para formatear cualquier registro de comanda a OrderDTO.
   */
  static formatOrderDTO(order: any, options: { includeTechnicalIdentity?: boolean } = {}): OrderDTO {
    const publicItems = (order.items || []).map((item: any) => ({
      id: item.id,
      orderId: item.orderId,
      menuItemId: item.menuItemId,
      name: item.menuItem?.name || item.name || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      notes: item.notes,
      guestName: item.guestName ?? null
    }));

    const result: any = {
      id: order.id,
      tableSessionId: order.tableSessionId,
      status: order.status as OrderStatus,
      totalAmount: order.totalAmount,
      source: order.source ?? null,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
      items: publicItems,
      reviewReason: formatOrderReviewReason(order.reviewReasonCode, order.reviewReasonDetail),
      cancellationReason: order.cancellationReason ?? null,
      cancelledAt: order.cancelledAt instanceof Date ? order.cancelledAt.toISOString() : (order.cancelledAt ?? null)
    };

    // Las proyecciones públicas no necesitan correlacionar una línea con un
    // token de comensal ni con un actor técnico. Se conserva una proyección
    // interna opt-in para comandos administrativos/auditorías existentes.
    if (options.includeTechnicalIdentity) {
      result.createdByStaffUserId = order.createdByStaffUserId ?? null;
      result.items = publicItems.map((item: any, index: number) => ({
        ...item,
        addedByGuest: order.items?.[index]?.addedByGuest,
        claimedByGuest: order.items?.[index]?.claimedByGuest,
        claimVersion: order.items?.[index]?.claimVersion,
        isPaid: order.items?.[index]?.isPaid
      }));
    }

    return result;
  }

  /**
   * Obtiene una orden por su identificador directo con ítems formateados.
   */
  static async getOrderById(orderId: string, options: { includeTechnicalIdentity?: boolean } = {}): Promise<OrderDTO | null> {
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
    return this.formatOrderDTO(order, options);
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

    // Guest order endpoints are public bearer-token APIs too. Do not let a
    // single-restaurant deployment read or mutate another tenant's session.
    if (!isRestaurantInConfiguredInstance(session.table.restaurantId)) {
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
      error.details = { tableSessionId: session.id, tableState: session.table.currentState };
      throw error;
    }

    if (session.closedAt !== null || session.table.currentState === TableFSMState.TO_CLEAN) {
      const error: any = new Error('Esta sesión de mesa ya finalizó. Escaneá el QR físico en la mesa para iniciar una nueva atención.');
      error.statusCode = 410;
      error.code = 'SESSION_CLOSED';
      error.details = { tableSessionId: session.id, tableState: session.table.currentState };
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
    const requireWaiterValidation = session.table.restaurant.moduleConfig?.requireWaiterValidation ?? false;
    const history = await this.getSessionOrderHistory(session.id);

    return {
      order,
      account: await this.getSessionAccount(session.id),
      history,
      allowOrdering,
      requireWaiterValidation
    };
  }

  /**
   * Obtiene o crea la orden activa para una sesión de mesa.
   * Prioriza el borrador (DRAFT) si existe, o la comanda activa más reciente.
   */
  static async getActiveOrder(tableSessionId: string): Promise<OrderDTO | null> {
    // Borradores históricos duplicados (pre-draftKey): lectura determinista por el más
    // antiguo; las escrituras los rechazan con DRAFT_CONFLICT hasta resolución explícita.
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
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
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

    return this.formatOrderDTO(order);
  }

  /**
   * Cuenta de la ocupación (B03, contrato 04-CONTRATO-CUENTA-B01 C1–C4).
   * Agrega por TableSession todas las tandas aceptadas no canceladas, con dinero
   * calculado de forma exacta en unidades menores enteras (C3). El carrito (DRAFT)
   * y la validación pendiente NO integran el consumo cobrable.
   * No registra pagos ni cambia estados: solo lee (B04 hará la liquidación).
   */
  static async getSessionAccount(tableSessionId: string): Promise<SessionAccountDTO> {
    const { session, orders, settlements } = await this.loadAccountData(prisma, tableSessionId);
    return this.buildSessionAccount(session.id, session.tableId, orders, settlements);
  }

  /**
   * Historial público de tandas de una sesión (C05).
   *
   * Es deliberadamente distinto de getActiveOrder(): el borrador se mantiene
   * separado y cada envío conserva su identidad, estado, importe snapshot y
   * líneas. Las tandas pendientes y canceladas se devuelven para que el cliente
   * no confunda "esperando confirmación" con "recibido por cocina" ni oculte un
   * rechazo. La proyección no expone guestSessionId ni notas privadas/técnicas.
   */
  static async getSessionOrderHistory(tableSessionId: string): Promise<SessionTandaLineDTO[]> {
    const { orders } = await this.loadAccountData(prisma, tableSessionId);
    return orders
      .filter((order: any) => order.status !== OrderStatus.DRAFT)
      .map((order: any) => this.formatSessionTandaLine(order));
  }

  private static formatSessionTandaLine(order: any): SessionTandaLineDTO {
    const totalMinor = order.totalAmountMinor ?? toMinor(order.totalAmount);
    const createdAt = order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt;
    const updatedAt = order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt;
    return {
      orderId: order.id,
      status: order.status as OrderStatus,
      totalMinor,
      createdAt,
      updatedAt,
      ...(order.cancellationReason ? { cancellationReason: order.cancellationReason } : {}),
      items: (order.items || []).map((item: any) => {
        const unitPriceMinor = item.unitPriceMinor ?? toMinor(item.unitPrice);
        return {
          itemId: item.id,
          name: item.menuItem?.name || item.name || '',
          quantity: item.quantity,
          unitPriceMinor,
          lineTotalMinor: unitPriceMinor * item.quantity,
          ...(item.guestName ? { guestName: item.guestName } : {})
        };
      })
    };
  }

  private static async loadAccountData(client: any, tableSessionId: string) {
    const session = await client.tableSession.findUnique({
      where: { id: tableSessionId },
      select: { id: true, tableId: true, closedAt: true, table: { select: { restaurantId: true } } }
    });
    if (!session) {
      const error: any = new Error('Sesión no encontrada');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }
    // Orden estable (createdAt + id): el fingerprint no debe moverse con timestamps iguales.
    const orders = await client.order.findMany({
      where: { tableSessionId },
      include: {
        items: {
          include: { menuItem: { select: { name: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        },
        payments: true
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const settlements = await client.accountSettlement.findMany({
      where: { tableSessionId, status: 'SETTLED' },
      include: { allocations: { orderBy: { orderId: 'asc' } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return { session, orders, settlements };
  }

  private static buildSessionAccount(
    sessionId: string,
    tableId: string,
    orders: any[],
    settlements: any[] = []
  ): SessionAccountDTO {
    const tandas: SessionTandaLineDTO[] = [];
    const pendingValidation: SessionAccountDTO['pendingValidation'] = [];
    let draft: SessionAccountDTO['draft'] = null;
    let consumoMinor = 0;
    let paidMinor = 0;
    let tipMinor = 0;

    for (const order of orders) {
      // Minor persistido cuando existe; fallback redondeado SOLO para historia Float
      // (C3, estado B04: escritores fuera de B04 aún no rellenan *Minor — ver §19).
      const totalMinor = order.totalAmountMinor ?? toMinor(order.totalAmount);
      const createdAt =
        order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt;
      const updatedAt =
        order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt;

      if (order.status === OrderStatus.DRAFT) {
        if (!draft || updatedAt > draft.updatedAt) {
          draft = { orderId: order.id, totalMinor, createdAt, updatedAt };
        }
        continue;
      }
      if (order.status === OrderStatus.PENDING_VALIDATION) {
        pendingValidation.push({ orderId: order.id, totalMinor, createdAt, updatedAt });
        continue;
      }
      if (order.status === OrderStatus.CANCELLED) continue;
      if (!SESSION_CONSUMO_STATUSES.includes(order.status as OrderStatus)) continue;

      consumoMinor += totalMinor;
      tandas.push(this.formatSessionTandaLine(order));
      for (const payment of order.payments || []) {
        if (payment.status === 'APPROVED' || payment.status === 'MANUAL_SETTLED') {
          paidMinor += payment.amountMinor ?? toMinor(payment.amount);
          tipMinor += payment.tipAmountMinor ?? toMinor(payment.tipAmount);
        }
      }
    }

    // Vía nueva B04 (tablas disjuntas de la legada: jamás se suma dos veces la misma fila).
    for (const settlement of settlements) {
      paidMinor += settlement.amountMinor;
      tipMinor += settlement.tipMinor;
    }

    const saldoMinor = Math.max(0, consumoMinor - paidMinor);
    // Fingerprint completo del estado contable para control optimista B04: cubre
    // tandas (id, estado, total, created/updated, líneas estables), pagos
    // (id, orderId, estado, importes, createdAt) y pending/draft con importes y
    // timestamps. Sin secretos: sin tokens de sesión, sin guestSessionId,
    // sin mpPaymentId. Cualquier cambio contable mueve la versión.
    const version = createHash('sha1')
      .update(
        [
          sessionId,
          tandas
            .map(
              (t) =>
                `${t.orderId}:${t.status}:${t.totalMinor}:${t.createdAt}:${t.updatedAt}:` +
                t.items.map((i) => `${i.itemId}:${i.quantity}:${i.unitPriceMinor}`).join(',')
            )
            .join(';'),
          (orders || [])
            .filter((o) => SESSION_CONSUMO_STATUSES.includes(o.status as OrderStatus))
            .flatMap((o) => o.payments || [])
            .map(
              (p: any) =>
                `${p.id}:${p.orderId}:${p.status}:${p.amountMinor ?? toMinor(p.amount)}:${p.tipAmountMinor ?? toMinor(p.tipAmount)}:${p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt}:${p.resolvedAt instanceof Date ? p.resolvedAt.toISOString() : (p.resolvedAt || '')}`
            )
            .join(';'),
          settlements
            .map(
              (s: any) =>
                `${s.id}:${s.amountMinor}:${s.tipMinor}:${s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt}`
            )
            .join(';'),
          `consumo=${consumoMinor}`,
          `paid=${paidMinor}`,
          `tip=${tipMinor}`,
          pendingValidation
            .map((p) => `${p.orderId}:${p.totalMinor}:${p.createdAt}:${p.updatedAt}`)
            .join(';'),
          draft ? `${draft.orderId}:${draft.totalMinor}:${draft.createdAt}:${draft.updatedAt}` : 'no-draft'
        ].join('|')
      )
      .digest('hex')
      .slice(0, 16);

    return {
      tableSessionId: sessionId,
      tableId,
      version,
      unit: 'ARS_MINOR',
      consumoMinor,
      paidMinor,
      tipMinor,
      saldoMinor,
      tandas,
      pendingValidation,
      draft
    };
  }

  /**
   * Cuentas agregadas por sesión para caja (B03): una entrada por TableSession abierta,
   * sin duplicar y sin filtrar otras mesas/tenants. No reemplaza `getCashOrders`
   * (filas legadas por comanda, conservadas por compatibilidad); S08 elegirá la vista.
   */
  static async getCashAccounts(
    restaurantIdOrSlug: string,
    staffRestaurantId?: string
  ): Promise<SessionAccountDTO[]> {
    const restaurant = await this.resolveCashRestaurant(restaurantIdOrSlug, staffRestaurantId);
    const sessions = await prisma.tableSession.findMany({
      where: {
        closedAt: null,
        table: { restaurantId: restaurant.id },
        orders: { some: { status: { not: OrderStatus.CANCELLED } } }
      },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    const accounts: SessionAccountDTO[] = [];
    for (const session of sessions) {
      accounts.push(await this.getSessionAccount(session.id));
    }
    return accounts;
  }

  /**
   * Liquidación presencial por CUENTA de TableSession (B04, contrato C4).
   * Una sola transacción de servidor: lee cuenta fresca, valida idempotencia,
   * compara expectedAccountVersion, valida saldo/asignaciones y registra una sola
   * liquidación con su ledger. No marca órdenes como PAID ni libera la mesa
   * (payment/fulfillment separados; B05). No depende de bucles del navegador.
   */
  static async settleSessionAccount(input: SettleSessionInput): Promise<{
    settlement: SettlementDTO;
    account: SessionAccountDTO;
    idempotentReplay: boolean;
  }> {
    if (!input || typeof input !== 'object') return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'Datos de liquidación requeridos');
    if (input.staffRole !== 'MANAGER') return this.settleError(403, 'SETTLE_REQUIRES_MANAGER', 'Cobrar requiere rol MANAGER.');
    if (typeof input.tableSessionId !== 'string' || !input.tableSessionId) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'tableSessionId requerido');
    }
    // Clave acotada y segura: string 1..200 caracteres (sin controles). Nunca 500 por payload.
    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (!idempotencyKey || idempotencyKey.length > 200 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'idempotencyKey 1..200 caracteres sin controles');
    }
    if (typeof input.expectedAccountVersion !== 'string' || !input.expectedAccountVersion) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'expectedAccountVersion requerido');
    }
    // Cantidades: enteros seguros; monto > 0, propina ≥ 0. Nunca 500 por payload.
    if (input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)) {
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'amountMinor debe ser entero seguro > 0 (centavos)');
    }
    if (input.tipMinor !== undefined && (!Number.isSafeInteger(input.tipMinor) || input.tipMinor < 0)) {
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'tipMinor debe ser entero seguro ≥ 0 (centavos)');
    }
    // Allocations: array de objetos {orderId string, amountMinor entero > 0}; se valida
    // forma aquí y semántica (suma/límites por tanda) dentro de la transacción.
    let requestedAllocations: Array<{ orderId: string; amountMinor: number }> | undefined;
    if (input.allocations !== undefined) {
      if (!Array.isArray(input.allocations)) {
        return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'allocations debe ser un array');
      }
      requestedAllocations = [];
      for (const a of input.allocations) {
        if (!a || typeof a !== 'object' || typeof a.orderId !== 'string' || !a.orderId) {
          return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'Cada allocation requiere orderId string');
        }
        if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor <= 0) {
          return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'Cada allocation requiere amountMinor entero seguro > 0');
        }
        requestedAllocations.push({ orderId: a.orderId, amountMinor: a.amountMinor });
      }
    }
    if (!SETTLE_METHODS.includes(input.method)) {
      if (typeof input.method === 'string' && input.method.startsWith('DIGITAL_')) {
        return this.settleError(422, 'DIGITAL_METHOD_UNAVAILABLE', 'Pagos digitales no disponibles; el cobro es presencial');
      }
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'Método presencial inválido (WAITER_CASH | WAITER_CARD | WAITER_MP_QR)');
    }
    const tipMinor = input.tipMinor ?? 0;
    if (!Number.isInteger(tipMinor) || tipMinor < 0) return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'tipMinor debe ser entero ≥ 0 (centavos)');

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Touch primero (B06): ordena este cobro frente a cierre/mutaciones; las
        // lecturas siguientes ven el estado post-lock y la unicidad (sesión, versión)
        // blinda el intercalado. La sesión cerrada tiene su propio arbitraje abajo
        // (replay seguro o 409 SESSION_CLOSED), así que aquí solo se toca.
        await OrderService.touchSessionTx(tx, input.tableSessionId);
        const { session, orders, settlements } = await this.loadAccountData(tx, input.tableSessionId);
        if (session.table.restaurantId !== input.staffRestaurantId) {
          return this.settleError(403, 'STAFF_TENANT_MISMATCH', 'No autorizado para cobrar otra cuenta/restaurante');
        }
        const fresh = this.buildSessionAccount(session.id, session.tableId, orders, settlements);

        // 1. Idempotencia PRIMERO: un reintento tras saldo 0 resuelve monto 0 y jamás
        // debe caer en validación de monto. Misma sesión + método + propina, y monto
        // igual al registrado (u omitido = misma intención "saldar") → replay.
        // Cualquier otra intención con la misma clave → 409.
        const existing = await tx.accountSettlement.findUnique({
          where: { idempotencyKey },
          include: { allocations: true }
        });
        // 1b. Sesión cerrada: una ocupación cerrada no acepta nuevos cobros (arbitraje
        // cuenta/cierre). Solo el replay seguro de una liquidación ya registrada
        // (misma intención completa: presencia exacta de allocations + contenido)
        // devuelve 200; lo demás es 409 sin escribir.
        if (session.closedAt) {
          if (existing && OrderService.isSameSettleIntent(existing, session.id, input, tipMinor, requestedAllocations)) {
            return {
              settlement: this.formatSettlement(existing),
              account: fresh,
              idempotentReplay: true
            };
          }
          const closedError: any = new Error('La sesión ya fue cerrada; no se aceptan nuevos cobros sobre esta ocupación');
          closedError.statusCode = 409;
          closedError.code = 'SESSION_CLOSED';
          closedError.details = { tableSessionId: session.id };
          throw closedError;
        }
        if (existing) {
          // Intención completa: misma clave + misma sesión + método + propina + versión
          // contra la que se liquidó + monto + presencia exacta de allocations +
          // reparto normalizado por tanda. Un reparto distinto con igual monto NO es
          // replay: 409 sin escribir. Omitido ≠ [] ≠ reparto distinto: sólo el mismo
          // body/versión devuelve replay. Camino FIFO (sin allocations): la versión
          // existente ancla la intención, por eso el replay tras saldo 0 sigue
          // devolviendo 200 con el mismo payload.
          if (OrderService.isSameSettleIntent(existing, session.id, input, tipMinor, requestedAllocations)) {
            return {
              settlement: this.formatSettlement(existing),
              account: fresh,
              idempotentReplay: true
            };
          }
          return this.settleError(409, 'IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con otra intención/sesión/monto/reparto');
        }

        // 2. Versión optimista ANTES de validar montos: un perdedor serializado de
        // carrera resuelve monto 0 y debe recibir 409 STALE (accionable), no 422.
        if (fresh.version !== input.expectedAccountVersion) {
          const error: any = new Error('La cuenta cambió desde tu lectura; revisá el nuevo saldo');
          error.statusCode = 409;
          error.code = 'STALE_ACCOUNT_VERSION';
          error.details = { currentVersion: fresh.version, consumoMinor: fresh.consumoMinor, saldoMinor: fresh.saldoMinor };
          throw error;
        }

        const amountMinor = input.amountMinor ?? fresh.saldoMinor;
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
          return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'amountMinor debe ser entero > 0 (centavos)');
        }

        // 3. Nada que cobrar / por encima del saldo.
        if (fresh.saldoMinor <= 0) return this.settleError(422, 'NOTHING_TO_SETTLE', 'La cuenta no tiene saldo pendiente');
        if (amountMinor > fresh.saldoMinor) {
          return this.settleError(422, 'OVERPAYMENT', `El monto supera el saldo (${fresh.saldoMinor} centavos)`);
        }

        // 4. Asignaciones conciliadas a tandas (explícitas o FIFO), nunca sobre saldo.
        // Filas duplicadas para la misma tanda se fusionan (suman) para respetar
        // @@unique(settlementId, orderId): una asignación por tanda y liquidación,
        // con trazabilidad completa en la fila resultante.
        const remainingByOrder = new Map<string, number>();
        for (const tanda of fresh.tandas) {
          const legacyPaid = (orders.find((o: any) => o.id === tanda.orderId)?.payments || [])
            .filter((p: any) => p.status === 'APPROVED' || p.status === 'MANUAL_SETTLED')
            .reduce((sum: number, p: any) => sum + (p.amountMinor ?? toMinor(p.amount)), 0);
          const settled = settlements
            .flatMap((s: any) => s.allocations || [])
            .filter((a: any) => a.orderId === tanda.orderId)
            .reduce((sum: number, a: any) => sum + a.amountMinor, 0);
          remainingByOrder.set(tanda.orderId, Math.max(0, tanda.totalMinor - legacyPaid - settled));
        }
        let allocations: Array<{ orderId: string; amountMinor: number }>;
        if (!requestedAllocations) {
          allocations = [];
          let rest = amountMinor;
          for (const tanda of fresh.tandas) {
            if (rest <= 0) break;
            const take = Math.min(remainingByOrder.get(tanda.orderId) || 0, rest);
            if (take > 0) {
              allocations.push({ orderId: tanda.orderId, amountMinor: take });
              rest -= take;
            }
          }
          if (rest > 0) return this.settleError(422, 'OVERPAYMENT', 'Asignación imposible sin superar tandas');
        } else {
          const merged = new Map<string, number>();
          for (const a of requestedAllocations) {
            merged.set(a.orderId, (merged.get(a.orderId) || 0) + a.amountMinor);
          }
          allocations = [...merged].map(([orderId, orderAmount]) => ({ orderId, amountMinor: orderAmount }));
          const sum = allocations.reduce((s, a) => s + a.amountMinor, 0);
          if (sum !== amountMinor) {
            return this.settleError(422, 'INVALID_SETTLE_REQUEST', `Las asignaciones agregadas por tanda deben sumar el monto (${amountMinor})`);
          }
          for (const a of allocations) {
            if (!remainingByOrder.has(a.orderId)) {
              return this.settleError(422, 'INVALID_SETTLE_REQUEST', `Tanda no cobrable: ${a.orderId}`);
            }
            if (a.amountMinor > (remainingByOrder.get(a.orderId) || 0)) {
              return this.settleError(422, 'OVERPAYMENT', `Asignación agregada supera el saldo de la tanda ${a.orderId}`);
            }
          }
        }

        const responsibleStaffUserId = await OrderService.resolveResponsibleStaffForSession(
          tx,
          session.id,
          input.staffUserId,
          input.responsibleStaffUserId
        );

        let created: any;
        try {
          created = await tx.accountSettlement.create({
            data: {
              tableSessionId: session.id,
              restaurantId: session.table.restaurantId,
              method: input.method,
              amountMinor,
              tipMinor,
              status: 'SETTLED',
              accountVersion: fresh.version,
              idempotencyKey,
              createdBy: input.staffUserId,
              responsibleStaffUserId,
              allocationsProvided: requestedAllocations !== undefined,
              allocations: { create: allocations.map((a) => ({ orderId: a.orderId, amountMinor: a.amountMinor })) }
            },
            include: { allocations: true }
          });
        } catch (err: any) {
          if (err?.code === 'P2002' || err?.code === 'P2034') {
            const conflict: any = new Error('Cobro concurrente sobre la misma cuenta/versión; revisá el saldo actual');
            conflict.statusCode = 409;
            conflict.code = 'SETTLE_CONFLICT';
            throw conflict;
          }
          throw err;
        }

        const after = this.buildSessionAccount(session.id, session.tableId, orders, [
          ...settlements,
          { ...created, allocations: created.allocations }
        ]);
        return { settlement: this.formatSettlement(created), account: after, idempotentReplay: false };
      });

      // El cobro de la cuenta no cambia el estado de las órdenes de cocina ni
      // cierra la ocupación: el contrato permite pedir otra ronda mientras el
      // grupo siga sentado. EATING con saldo cero mantiene el contexto visible
      // y deja "Liberar mesa" como acción explícita de cierre.
      if (result.account.saldoMinor === 0) {
        try {
          await fsmService.ensureOperationalState({
            tableId: result.account.tableId,
            toState: TableFSMState.EATING,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: 'Cuenta liquidada; ocupación permanece abierta',
            staffUserId: input.staffUserId
          });
        } catch (err) {
          // El ledger ya está confirmado; no se revierte el cobro por una
          // señal operativa momentáneamente retrasada. Se conserva evidencia
          // en logs para que el monitor pueda reauditar la mesa.
          console.warn('FSM transition to EATING non-blocking warning on settleSessionAccount:', err);
        }
      }

      return result;
    } catch (err: any) {
      if (err?.statusCode) throw err;
      // Conflicto de escritura a nivel de transacción (SQLite concurrente): el cliente
      // debe releer la cuenta y reintentar de forma consciente, nunca duplicar.
      if (err?.code === 'P2034') {
        const conflict: any = new Error('Cobro concurrente sobre la misma cuenta; releé el saldo y reintentá');
        conflict.statusCode = 409;
        conflict.code = 'SETTLE_CONFLICT';
        throw conflict;
      }
      throw err;
    }
  }

  /**
   * Comando atómico de cierre operativo (E03): `settle-and-close`.
   * En UNA transacción de servidor: revalida versión, registra el pago TOTAL de forma
   * idempotente, cierra la sesión (closedAt + activeKey null), revoca el token y deja
   * la auditoría completa. Fuera de la tx transiciona a TO_CLEAN (tarea de limpieza
   * priorizada `Mesa X · pagada · falta limpiar` vía plano/Servicio).
   * - Reintento con la misma clave e intención → 200 sin duplicar pago ni cierre.
   * - Pago concurrente con nueva ronda → 409 serializable (STALE/CONFLICT), nunca huérfano.
   * - Con deuda restante, borrador, revisión o llamado → 409 sin cierre parcial.
   * - Opción separada para pagar y continuar: `settleSessionAccount` (sin cierre).
   */
  static async settleAndCloseSessionAccount(input: SettleSessionInput): Promise<{
    settlement: SettlementDTO;
    account: SessionAccountDTO;
    idempotentReplay: boolean;
    closed: boolean;
    tableId: string;
  }> {
    if (!input || typeof input !== 'object') return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'Datos de liquidación requeridos');
    if (input.staffRole !== 'MANAGER') return this.settleError(403, 'SETTLE_REQUIRES_MANAGER', 'Cobrar requiere rol MANAGER.');
    if (typeof input.tableSessionId !== 'string' || !input.tableSessionId) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'tableSessionId requerido');
    }
    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (!idempotencyKey || idempotencyKey.length > 200 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'idempotencyKey 1..200 caracteres sin controles');
    }
    if (typeof input.expectedAccountVersion !== 'string' || !input.expectedAccountVersion) {
      return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'expectedAccountVersion requerido');
    }
    if (input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)) {
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'amountMinor debe ser entero seguro > 0 (centavos)');
    }
    if (input.tipMinor !== undefined && (!Number.isSafeInteger(input.tipMinor) || input.tipMinor < 0)) {
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'tipMinor debe ser entero seguro ≥ 0 (centavos)');
    }
    let requestedAllocations: Array<{ orderId: string; amountMinor: number }> | undefined;
    if (input.allocations !== undefined) {
      if (!Array.isArray(input.allocations)) {
        return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'allocations debe ser un array');
      }
      requestedAllocations = [];
      for (const a of input.allocations) {
        if (!a || typeof a !== 'object' || typeof a.orderId !== 'string' || !a.orderId) {
          return this.settleError(400, 'INVALID_SETTLE_REQUEST', 'Cada allocation requiere orderId string');
        }
        if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor <= 0) {
          return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'Cada allocation requiere amountMinor entero seguro > 0');
        }
        requestedAllocations.push({ orderId: a.orderId, amountMinor: a.amountMinor });
      }
    }
    if (!SETTLE_METHODS.includes(input.method)) {
      if (typeof input.method === 'string' && input.method.startsWith('DIGITAL_')) {
        return this.settleError(422, 'DIGITAL_METHOD_UNAVAILABLE', 'Pagos digitales no disponibles; el cobro es presencial');
      }
      return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'Método presencial inválido (WAITER_CASH | WAITER_CARD | WAITER_MP_QR)');
    }
    const tipMinor = input.tipMinor ?? 0;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const touched = await OrderService.touchSessionTx(tx, input.tableSessionId);
        const seenSeq = touched.mutationSeq;
        const { session, orders, settlements } = await this.loadAccountData(tx, input.tableSessionId);
        if (session.table.restaurantId !== input.staffRestaurantId) {
          return this.settleError(403, 'STAFF_TENANT_MISMATCH', 'No autorizado para cobrar otra cuenta/restaurante');
        }
        const fresh = this.buildSessionAccount(session.id, session.tableId, orders, settlements);

        const existing = await tx.accountSettlement.findUnique({
          where: { idempotencyKey },
          include: { allocations: true }
        });

        // Sesión ya cerrada: sólo replay seguro de la misma intención completa
        // (presencia exacta de allocations + contenido). Lo demás es 409.
        if (session.closedAt) {
          if (existing && OrderService.isSameSettleIntent(existing, session.id, input, tipMinor, requestedAllocations)) {
            return {
              settlement: this.formatSettlement(existing),
              account: fresh,
              idempotentReplay: true,
              closed: true,
              tableId: session.tableId
            };
          }
          const closedError: any = new Error('La sesión ya fue cerrada; no se aceptan nuevos cobros sobre esta ocupación');
          closedError.statusCode = 409;
          closedError.code = 'SESSION_CLOSED';
          closedError.details = { tableSessionId: session.id };
          throw closedError;
        }

        let settlementRow: any;
        let accountAfter: SessionAccountDTO;
        let isReplay = false;

        if (existing) {
          // L2: misma clave exige mismo body/versión (presencia exacta de
          // allocations + contenido). Omitido ≠ [] ≠ reparto distinto → 409.
          if (!OrderService.isSameSettleIntent(existing, session.id, input, tipMinor, requestedAllocations)) {
            return this.settleError(409, 'IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con otra intención/sesión/monto/reparto');
          }
          // Reintento tras respuesta perdida: el pago ya existe; completar el cierre abajo.
          settlementRow = existing;
          accountAfter = this.buildSessionAccount(session.id, session.tableId, orders, [
            ...settlements.filter((s: any) => s.id !== existing.id),
            { ...existing, allocations: existing.allocations }
          ]);
          isReplay = true;
        } else {
          // Guardas de cierre ANTES de cobrar: sin cierre parcial (E03/03-§cuenta y cobro 29-34).
          if (fresh.draft) {
            const error: any = new Error(
              'La mesa tiene un carrito sin enviar; descartalo o envialo explícitamente antes de cobrar y cerrar.'
            );
            error.statusCode = 409;
            error.code = 'DRAFT_UNRESOLVED';
            throw error;
          }
          if (fresh.pendingValidation.length > 0) {
            const error: any = new Error(
              'La mesa tiene tandas esperando confirmación; aceptalas o rechazalas explícitamente antes de cobrar y cerrar.'
            );
            error.statusCode = 409;
            error.code = 'PENDING_VALIDATION_UNRESOLVED';
            throw error;
          }
          const pendingCalls = await tx.callRequest.count({
            where: { tableSessionId: session.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
          });
          if (pendingCalls > 0) {
            const error: any = new Error(
              `La mesa tiene ${pendingCalls} llamado(s) pendiente(s); resolvelos o cancelalos explícitamente antes de cobrar y cerrar.`
            );
            error.statusCode = 409;
            error.code = 'PENDING_CALLS';
            error.details = { count: pendingCalls };
            throw error;
          }

          if (fresh.version !== input.expectedAccountVersion) {
            const error: any = new Error('La cuenta cambió desde tu lectura; revisá el nuevo saldo');
            error.statusCode = 409;
            error.code = 'STALE_ACCOUNT_VERSION';
            error.details = { currentVersion: fresh.version, consumoMinor: fresh.consumoMinor, saldoMinor: fresh.saldoMinor };
            throw error;
          }

          // settle-and-close exige saldar el TOTAL: nada de cierre parcial con deuda restante.
          const amountMinor = input.amountMinor ?? fresh.saldoMinor;
          if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return this.settleError(422, 'INVALID_SETTLE_REQUEST', 'amountMinor debe ser entero > 0 (centavos)');
          }
          if (fresh.saldoMinor <= 0) return this.settleError(422, 'NOTHING_TO_SETTLE', 'La cuenta no tiene saldo pendiente');
          if (amountMinor !== fresh.saldoMinor) {
            return this.settleError(422, 'CLOSE_REQUIRES_FULL_SETTLEMENT', `Cobrar y cerrar exige el saldo total (${fresh.saldoMinor} centavos); para pagos parciales use Registrar pago y mantener mesa`);
          }

          const remainingByOrder = new Map<string, number>();
          for (const tanda of fresh.tandas) {
            const legacyPaid = (orders.find((o: any) => o.id === tanda.orderId)?.payments || [])
              .filter((p: any) => p.status === 'APPROVED' || p.status === 'MANUAL_SETTLED')
              .reduce((sum: number, p: any) => sum + (p.amountMinor ?? toMinor(p.amount)), 0);
            const settled = settlements
              .flatMap((s: any) => s.allocations || [])
              .filter((a: any) => a.orderId === tanda.orderId)
              .reduce((sum: number, a: any) => sum + a.amountMinor, 0);
            remainingByOrder.set(tanda.orderId, Math.max(0, tanda.totalMinor - legacyPaid - settled));
          }
          let allocations: Array<{ orderId: string; amountMinor: number }>;
          if (!requestedAllocations) {
            allocations = [];
            let rest = amountMinor;
            for (const tanda of fresh.tandas) {
              if (rest <= 0) break;
              const take = Math.min(remainingByOrder.get(tanda.orderId) || 0, rest);
              if (take > 0) {
                allocations.push({ orderId: tanda.orderId, amountMinor: take });
                rest -= take;
              }
            }
            if (rest > 0) return this.settleError(422, 'OVERPAYMENT', 'Asignación imposible sin superar tandas');
          } else {
            const merged = new Map<string, number>();
            for (const a of requestedAllocations) {
              merged.set(a.orderId, (merged.get(a.orderId) || 0) + a.amountMinor);
            }
            allocations = [...merged].map(([orderId, orderAmount]) => ({ orderId, amountMinor: orderAmount }));
            const sum = allocations.reduce((s, a) => s + a.amountMinor, 0);
            if (sum !== amountMinor) {
              return this.settleError(422, 'INVALID_SETTLE_REQUEST', `Las asignaciones agregadas por tanda deben sumar el monto (${amountMinor})`);
            }
            for (const a of allocations) {
              if (!remainingByOrder.has(a.orderId)) {
                return this.settleError(422, 'INVALID_SETTLE_REQUEST', `Tanda no cobrable: ${a.orderId}`);
              }
              if (a.amountMinor > (remainingByOrder.get(a.orderId) || 0)) {
                return this.settleError(422, 'OVERPAYMENT', `Asignación agregada supera el saldo de la tanda ${a.orderId}`);
              }
            }
          }

          const responsibleStaffUserId = await OrderService.resolveResponsibleStaffForSession(
            tx,
            session.id,
            input.staffUserId,
            input.responsibleStaffUserId
          );

          try {
            settlementRow = await tx.accountSettlement.create({
              data: {
                tableSessionId: session.id,
                restaurantId: session.table.restaurantId,
                method: input.method,
                amountMinor,
                tipMinor,
                status: 'SETTLED',
                accountVersion: fresh.version,
                idempotencyKey,
                createdBy: input.staffUserId,
                responsibleStaffUserId,
                allocationsProvided: requestedAllocations !== undefined,
                allocations: { create: allocations.map((a) => ({ orderId: a.orderId, amountMinor: a.amountMinor })) }
              },
              include: { allocations: true }
            });
          } catch (err: any) {
            if (err?.code === 'P2002' || err?.code === 'P2034') {
              const conflict: any = new Error('Cobro concurrente sobre la misma cuenta/versión; revisá el saldo actual');
              conflict.statusCode = 409;
              conflict.code = 'SETTLE_CONFLICT';
              throw conflict;
            }
            throw err;
          }
          accountAfter = this.buildSessionAccount(session.id, session.tableId, orders, [
            ...settlements,
            { ...settlementRow, allocations: settlementRow.allocations }
          ]);
        }

        // Cierre condicional en la misma tx: si una ronda se intercaló, la serie se movió → 409.
        const now = new Date();
        const closed = await tx.tableSession.updateMany({
          where: { id: session.id, closedAt: null, mutationSeq: seenSeq },
          data: { closedAt: now, activeKey: null }
        });
        if (closed.count !== 1) {
          const error: any = new Error('La mesa cambió durante el cobro y cierre; releé el estado y reintentá');
          error.statusCode = 409;
          error.code = 'CLOSE_CONFLICT';
          throw error;
        }

        return {
          settlement: this.formatSettlement(settlementRow),
          account: accountAfter,
          idempotentReplay: isReplay,
          closed: true,
          tableId: session.tableId
        };
      });

      // Fuera de la tx: TO_CLEAN + tarea de limpieza priorizada. Nunca AVAILABLE directo.
      // Si el cobro/cierre DB quedó confirmado pero la FSM falla, no ocultar
      // como éxito: 503/409 SETTLE_CLOSURE_INCOMPLETE con detalles accionables.
      // El reintento con la misma key/body reintenta la FSM y sólo devuelve
      // replay cuando TO_CLEAN está confirmado. Nunca AVAILABLE->TO_CLEAN.
      const ensureToClean = async () => {
        const tableRow = await prisma.table.findUnique({
          where: { id: result.tableId },
          select: { currentState: true }
        });
        const current = tableRow?.currentState as TableFSMState | undefined;
        if (current === TableFSMState.TO_CLEAN) return;
        if (current === TableFSMState.AVAILABLE) {
          if (result.idempotentReplay) return; // ciclo ya completado (Mesa lista); no regressar
          const incomplete: any = new Error(
            'El cobro y cierre quedaron registrados, pero la mesa figura AVAILABLE sin pasar por limpieza; requiere revisión manual antes de reintentar.'
          );
          incomplete.statusCode = 503;
          incomplete.code = 'SETTLE_CLOSURE_INCOMPLETE';
          incomplete.details = {
            tableId: result.tableId,
            tableSessionId: input.tableSessionId,
            settlementId: result.settlement.id,
            idempotencyKey,
            currentState: current,
            nextAction: 'retry-settle-and-close-same-key-body'
          };
          throw incomplete;
        }
        const { fsmService } = await import('./fsm.service');
        try {
          // Gate A: sin override; TO_CLEAN por matriz + guardas H2. Un salto
          // inválido aquí es cierre incompleto, no éxito.
          await fsmService.attemptTransition({
            tableId: result.tableId,
            toState: TableFSMState.TO_CLEAN,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: 'STAFF_SETTLE_AND_CLOSE',
            metadata: { settlementId: result.settlement.id, idempotencyKey }
          });
        } catch (err: any) {
          const error: any = new Error(
            'El cobro y cierre quedaron registrados, pero la mesa no pasó a limpieza; reintentá con la misma clave y body para completar el cierre.'
          );
          error.statusCode = err?.statusCode === 409 ? 409 : 503;
          error.code = 'SETTLE_CLOSURE_INCOMPLETE';
          error.details = {
            tableId: result.tableId,
            tableSessionId: input.tableSessionId,
            settlementId: result.settlement.id,
            idempotencyKey,
            currentState: current ?? null,
            fsmCode: err?.code ?? null,
            fsmMessage: err?.message ?? null,
            nextAction: 'retry-settle-and-close-same-key-body'
          };
          throw error;
        }
      };
      await ensureToClean();

      return result;
    } catch (err: any) {
      if (err?.statusCode) throw err;
      if (err?.code === 'P2034') {
        const conflict: any = new Error('Cobro concurrente sobre la misma cuenta; releé el saldo y reintentá');
        conflict.statusCode = 409;
        conflict.code = 'SETTLE_CONFLICT';
        throw conflict;
      }
      throw err;
    }
  }

  /**
   * L2: idempotencia exacta de allocations sobre el modelo Prisma.
   * `AccountSettlement.allocationsProvided` registra si la liquidación original
   * trajo `allocations` explícito (true) u omitido (false, default de filas
   * legadas). La comparación de replay exige presencia idéntica + contenido
   * normalizado idéntico: omitido ≠ [] ≠ reparto distinto. Sin DDL ni SQL
   * crudo en runtime: la marca viaja en el propio create del settlement.
   */
  private static isSameSettleIntent(
    existing: any,
    sessionId: string,
    input: SettleSessionInput,
    tipMinor: number,
    requestedAllocations: Array<{ orderId: string; amountMinor: number }> | undefined
  ): boolean {
    if (
      existing.tableSessionId !== sessionId ||
      existing.method !== input.method ||
      existing.tipMinor !== tipMinor ||
      existing.accountVersion !== input.expectedAccountVersion ||
      (input.amountMinor !== undefined && existing.amountMinor !== input.amountMinor)
    ) {
      return false;
    }
    const retryHasAllocations = requestedAllocations !== undefined;
    // Filas legadas (default false) = camino FIFO sin allocations explícito.
    const originalHasAllocations = existing.allocationsProvided ?? false;
    if (retryHasAllocations !== originalHasAllocations) return false;
    if (!retryHasAllocations) return true;
    const wanted = new Map<string, number>();
    for (const a of requestedAllocations ?? []) {
      wanted.set(a.orderId, (wanted.get(a.orderId) || 0) + a.amountMinor);
    }
    const kept = new Map<string, number>();
    for (const a of existing.allocations || []) {
      kept.set(a.orderId, (kept.get(a.orderId) || 0) + a.amountMinor);
    }
    return (
      wanted.size === kept.size &&
      [...wanted].every(([orderId, amount]) => kept.get(orderId) === amount)
    );
  }

  private static settleError(statusCode: number, code: string, message: string): never {
    const error: any = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    throw error;
  }

  /**
   * Resuelve el mozo responsable del cobro:
   * 1. Valor explícito provisto (permite edición/override por el operador).
   * 2. Mozo que reclamó/atendió la solicitud de cuenta (BILL).
   * 3. Mozo que reclamó la tarea de cobranza de la sesión (ACCOUNT_COLLECTION).
   * 4. Operador autenticado que ejecuta el cobro.
   */
  private static async resolveResponsibleStaffForSession(
    tx: any,
    tableSessionId: string,
    fallbackStaffUserId: string,
    explicitStaffUserId?: string | null
  ): Promise<string> {
    if (explicitStaffUserId && explicitStaffUserId.trim().length > 0) {
      const explicitId = explicitStaffUserId.trim();
      const session = await tx.tableSession.findUnique({
        where: { id: tableSessionId },
        select: { table: { select: { restaurantId: true } } }
      });
      const staff = session?.table?.restaurantId
        ? await tx.staffUser.findFirst({
            where: { id: explicitId, restaurantId: session.table.restaurantId },
            select: { id: true }
          })
        : null;
      if (!staff) {
        return this.settleError(422, 'INVALID_RESPONSIBLE_STAFF', 'El mozo responsable no pertenece al restaurante de la mesa.');
      }
      return staff.id;
    }

    try {
      const latestBill = await tx.callRequest.findFirst({
        where: { tableSessionId, type: 'BILL' },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      });

      if (latestBill) {
        const billClaim = await tx.serviceTaskClaim.findFirst({
          where: { taskType: 'CALL', targetId: latestBill.id },
          orderBy: { claimedAt: 'desc' },
          select: { staffUserId: true }
        });
        if (billClaim?.staffUserId) {
          return billClaim.staffUserId;
        }
      }

      const sessionClaim = await tx.serviceTaskClaim.findFirst({
        where: { taskType: 'ACCOUNT_COLLECTION', targetId: tableSessionId },
        orderBy: { claimedAt: 'desc' },
        select: { staffUserId: true }
      });
      if (sessionClaim?.staffUserId) {
        return sessionClaim.staffUserId;
      }
    } catch {
      // Si falla la consulta de trazabilidad, recurrir al operador
    }

    return fallbackStaffUserId;
  }

  private static formatSettlement(s: any): SettlementDTO {
    return {
      id: s.id,
      tableSessionId: s.tableSessionId,
      restaurantId: s.restaurantId,
      method: s.method,
      amountMinor: s.amountMinor,
      tipMinor: s.tipMinor,
      status: s.status,
      accountVersion: s.accountVersion,
      idempotencyKey: s.idempotencyKey,
      createdBy: s.createdBy,
      responsibleStaffUserId: s.responsibleStaffUserId || s.createdBy || null,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      allocations: (s.allocations || []).map((a: any) => ({ orderId: a.orderId, amountMinor: a.amountMinor }))
    };
  }

  private static async resolveCashRestaurant(
    restaurantIdOrSlug: string,
    staffRestaurantId?: string
  ) {
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
      const error: any = new Error('No autorizado para consultar caja de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }
    return restaurant;
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

    // Validación de longitud de notas. Se conserva el contenido tal cual: el
    // nombre del participante nunca se concatena ni se usa como nota de cocina.
    if (dto.notes !== undefined && dto.notes !== null) {
      if (typeof dto.notes !== 'string' || dto.notes.length > 500) {
        const error: any = new Error('Las notas del plato no pueden superar los 500 caracteres');
        error.statusCode = 400;
        error.code = 'NOTES_TOO_LONG';
        throw error;
      }
    }
    // E13: nombre opcional del participante, separado de notes (máx 40, sin truncar).
    let guestName: string | null = null;
    if (dto.guestName !== undefined && dto.guestName !== null) {
      if (typeof dto.guestName !== 'string') {
        const error: any = new Error('El nombre del participante es inválido');
        error.statusCode = 400;
        error.code = 'INVALID_GUEST_NAME';
        throw error;
      }
      const normalizedGuestName = dto.guestName.trim();
      if (normalizedGuestName.length > 40) {
        const error: any = new Error('El nombre no puede superar los 40 caracteres');
        error.statusCode = 400;
        error.code = 'GUEST_NAME_TOO_LONG';
        throw error;
      }
      guestName = normalizedGuestName || null;
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

    // Guardar primero la regla de negocio y luego sincronizar la señal visual
    // de la mesa. La misma regla vuelve a comprobarse dentro de la transacción
    // para cubrir una liquidación/cierre concurrente.
    await OrderService.assertSessionCanReceiveOrder(session.id);
    await fsmService.ensureOperationalState({
      tableId: session.tableId,
      toState: TableFSMState.OCCUPIED_NO_ORDER,
      source: SignalSource.CUSTOMER_APP,
      trigger: 'Comensal comenzó a armar un pedido'
    });

    // UNA sola transacción (B06/T11 + reauditoría): touch+guarda de sesión vigente,
    // reclamo/creación del único DRAFT, inserción y recálculo. Ninguna escritura de
    // Order ocurre antes de confirmar en esta misma tx que la sesión sigue abierta.
    // Sin catch-continue dentro del tx: P2002 en la creación (carrera) se traduce
    // fuera a reintento limpio de UNA vez (nada se escribió antes del fallo) o 409.
    let attempt = 0;
    let wroteItem = false;
    for (;;) {
      attempt += 1;
      try {
        await prisma.$transaction(async (tx) => {
          const touched = await OrderService.touchSessionTx(tx, session.id);
          OrderService.assertSessionOpenRow(touched);
          await OrderService.assertSessionCanReceiveOrderTx(tx, session.id);
          const mutationSeq = touched.mutationSeq;

          // Borrador único: 0 → crear con clave; 1 → vincular/usar; >1 → 409.
          const drafts = await tx.order.findMany({
            where: { tableSessionId: session.id, status: OrderStatus.DRAFT },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, draftKey: true, status: true }
          });
          if (drafts.length > 1) {
            const error: any = new Error(
              `La mesa tiene ${drafts.length} borradores históricos; pedí al personal que resuelva el carrito antes de seguir.`
            );
            error.statusCode = 409;
            error.code = 'DRAFT_CONFLICT';
            error.details = { tableSessionId: session.id, draftIds: drafts.map((d: any) => d.id) };
            throw error;
          }
          let orderId: string;
          if (drafts.length === 0) {
            const created = await tx.order.create({
              data: {
                tableSessionId: session.id,
                status: OrderStatus.DRAFT,
                totalAmount: 0,
                totalAmountMinor: 0,
                draftKey: session.id,
                source: 'GUEST_QR'
              }
            });
            orderId = created.id;
          } else {
            if (!drafts[0].draftKey) {
              await tx.order.update({ where: { id: drafts[0].id }, data: { draftKey: session.id } });
            }
            orderId = drafts[0].id;
          }

          // Crear el ítem: precio unitario SIEMPRE tomado del servidor (menuItem.price de la BD)
          const unitPriceMinor = menuItem.priceMinor ?? toMinor(menuItem.price);
          wroteItem = false;
          await tx.orderItem.create({
            data: {
              orderId,
              menuItemId: menuItem.id,
              quantity: qty,
              unitPrice: menuItem.price, // PRECIO DEL SERVIDOR (Inmune a manipulación en el cliente)
              unitPriceMinor,
              notes: dto.notes !== undefined && dto.notes !== null && dto.notes !== '' ? dto.notes : null,
              guestName,
              addedByGuest: dto.guestSessionId || 'guest-web',
            claimVersion: 0,
            isPaid: false
          }
        });
        wroteItem = true;

        // Recalcular total estrictamente en el servidor: sum(unitPrice * quantity)
          const allItems = await tx.orderItem.findMany({
            where: { orderId }
          });
          const newTotal = allItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
          const safeTotal = Math.max(0, Math.round(newTotal * 100) / 100);
          const totalMinor = allItems.reduce(
            (sum, it) => sum + ((it as any).unitPriceMinor ?? toMinor(it.unitPrice)) * it.quantity,
            0
          );

          await tx.order.update({
            where: { id: orderId },
            data: { totalAmount: safeTotal, totalAmountMinor: totalMinor }
          });

          // Verificación de cierre: aborta si alguien mutó la cuenta en el medio.
          await OrderService.verifySessionUnchanged(tx, session.id, mutationSeq, 'DRAFT_CONFLICT');
        });
        break;
      } catch (err: any) {
        if (err?.statusCode) throw err;
        // Reintento limpio UNA vez solo si nada se escribió (fallo en touch, reclamo
        // o creación del borrador): converge bajo carrera sin duplicar. Si el ítem
        // ya se creó en el intento, 409 accionable en vez de duplicar a ciegas.
        if (!wroteItem && (err?.code === 'P2002' || err?.code === 'P2034') && attempt === 1) continue;
        if (err?.code === 'P2002' || err?.code === 'P2034') {
          const conflict: any = new Error('El carrito se está editando desde otra sesión; reintentá');
          conflict.statusCode = 409;
          conflict.code = 'DRAFT_CONFLICT';
          throw conflict;
        }
        throw err;
      }
    }

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

    // B06/T11: borrar y recalcular en una transacción; el perdedor de una carrera
    // recibe 409 accionable en vez de corromper el total en silencio.
    const runRemove = () =>
      prisma.$transaction(async (tx) => {
        // Guardas dentro de la tx (B06): touch primero (lock+serie), luego revalidar
        // que ni la sesión ni la tanda cambiaron; verificación condicional al final.
        const touched = await OrderService.touchSessionTx(tx, session.id);
        OrderService.assertSessionOpenRow(touched);
        await OrderService.assertSessionCanReceiveOrderTx(tx, session.id);
        const mutationSeq = touched.mutationSeq;
        // Revalidar dentro de la tx: la tanda pudo enviarse entre la lectura y la escritura.
        const freshOrder = await tx.order.findUnique({ where: { id: item.orderId }, select: { status: true } });
        if (!freshOrder || freshOrder.status !== OrderStatus.DRAFT) {
          const error: any = new Error('No se pueden modificar o eliminar platos de una comanda ya enviada o confirmada');
          error.statusCode = 409;
          error.code = 'ORDER_NOT_IN_DRAFT';
          throw error;
        }
        await tx.orderItem.delete({
          where: { id: orderItemId }
        });

        // Recalcular total en el servidor
        const allItems = await tx.orderItem.findMany({
          where: { orderId: item.orderId }
        });
        const newTotal = allItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
        const safeTotal = Math.max(0, Math.round(newTotal * 100) / 100);
        const totalMinor = allItems.reduce(
          (sum, it) => sum + ((it as any).unitPriceMinor ?? toMinor(it.unitPrice)) * it.quantity,
          0
        );

        await tx.order.update({
          where: { id: item.orderId },
          data: { totalAmount: safeTotal, totalAmountMinor: totalMinor }
        });

        await OrderService.verifySessionUnchanged(tx, session.id, mutationSeq, 'DRAFT_CONFLICT');
      });

    try {
      await runRemove();
    } catch (err: any) {
      if (err?.code === 'P2025') {
        const error: any = new Error('Ítem no encontrado en la comanda de esta mesa');
        error.statusCode = 404;
        error.code = 'ITEM_NOT_FOUND';
        throw error;
      }
      if (err?.code === 'P2002' || err?.code === 'P2034') {
        const conflict: any = new Error('El carrito se está editando desde otra sesión; reintentá');
        conflict.statusCode = 409;
        conflict.code = 'DRAFT_CONFLICT';
        throw conflict;
      }
      throw err;
    }

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
   * - Sesión activa centralizada (404/410): cerrada/expirada arbitra sin huérfanos.
   * - Flag de comandas digitales en servidor (403).
   * - Idempotencia con clave opcional: una clave aceptada apunta a exactamente una
   *   tanda (SubmitReceipt). Reintentos con la misma clave (doble clic, timeout con
   *   respuesta perdida) devuelven la tanda original sin crear otra, aunque ya exista
   *   un borrador nuevo. Sin clave se conserva el comportamiento legado.
   * - Disponibilidad y umbral revalidados al commit: una excepción queda en
   *   PENDING_VALIDATION con motivo persistido; el precio conserva la instantánea
   *   tomada al agregar (histórico intacto).
   * - Rechaza transiciones desde estados finales (PAID/CANCELLED) (409).
   * Recuperación: ante timeout, reintentá con la MISMA idempotencyKey; ante 422 por
   * stock, quitá el plato señalado y reenviá con clave nueva; ante 409/410, no dupliques.
   */
  static async submitOrder(sessionToken: string, options?: { idempotencyKey?: string }): Promise<OrderDTO> {
    const session = await this.validateActiveGuestSession(sessionToken);

    // Flag en servidor: permitir pedidos digitales
    if (session.table?.restaurant?.moduleConfig && session.table.restaurant.moduleConfig.allowOrdering === false) {
      const error: any = new Error('Las comandas digitales están desactivadas en este restaurante (Modo Carta Informativa)');
      error.statusCode = 403;
      error.code = 'ORDERING_DISABLED';
      throw error;
    }

    const rawKey = typeof options?.idempotencyKey === 'string' ? options.idempotencyKey.trim() : '';
    if (options?.idempotencyKey !== undefined && (!rawKey || rawKey.length > 200)) {
      const error: any = new Error('idempotencyKey de 1..200 caracteres');
      error.statusCode = 400;
      error.code = 'INVALID_SUBMIT_KEY';
      throw error;
    }
    const submitKey = rawKey || null;

    // En modo automático sólo las excepciones identificadas quedan pendientes.
    // El flag histórico conserva un modo manual global para locales que lo necesitan.
    const requireValidation = session.table.restaurant.moduleConfig?.requireWaiterValidation ?? false;
    const configuredThreshold = session.table.restaurant.moduleConfig?.reviewQuantityThreshold;
    const reviewQuantityThreshold = typeof configuredThreshold === 'number' && Number.isInteger(configuredThreshold) && configuredThreshold >= 2 && configuredThreshold <= 50
      ? configuredThreshold
      : DEFAULT_REVIEW_QUANTITY_THRESHOLD;
    const defaultNextStatus = requireValidation ? OrderStatus.PENDING_VALIDATION : OrderStatus.IN_KITCHEN;

    const submitInTx = () =>
      prisma.$transaction(async (tx) => {
        // Replay por clave: la tanda original, aunque ya haya un borrador nuevo.
        // Solo lectura: seguro incluso si la sesión se cerró después de aceptar.
        if (submitKey) {
          const receipt = await tx.submitReceipt.findUnique({ where: { idempotencyKey: submitKey } });
          if (receipt) {
            if (receipt.tableSessionId !== session.id) {
              const error: any = new Error('La clave de envío ya se usó en otra sesión');
              error.statusCode = 409;
              error.code = 'SUBMIT_KEY_REUSED';
              throw error;
            }
            return { orderId: receipt.orderId, replay: true as boolean, silent: true as boolean };
          }
        }

        // Guarda transaccional (B06): touch primero (lock+serie de la fila sesión),
        // luego toda lectura ocurre post-lock. Ni DRAFT nuevo ni ticket en sesión
        // cerrada o expirada, aunque el cierre se intercale tras la validación previa.
        const touched = await OrderService.touchSessionTx(tx, session.id);
        OrderService.assertSessionOpenRow(touched);
        const mutationSeq = touched.mutationSeq;

        // Borrador único con determinismo total. Múltiples históricos no se eligen
        // arbitrariamente: 409 accionable.
        const draftIds = await tx.order.findMany({
          where: { tableSessionId: session.id, status: OrderStatus.DRAFT },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, draftKey: true }
        });
        if (draftIds.length > 1) {
          const error: any = new Error(
            `La mesa tiene ${draftIds.length} borradores históricos; pedí al personal que resuelva el carrito antes de seguir.`
          );
          error.statusCode = 409;
          error.code = 'DRAFT_CONFLICT';
          error.details = { tableSessionId: session.id, draftIds: draftIds.map((d) => d.id) };
          throw error;
        }
        if (draftIds.length === 0) {
          // Sin borrador y con clave: asociar la clave a la tanda histórica
          // determinística (última enviada) en forma atómica, o conflicto estable.
          // Sin clave: comportamiento legado (compatibilidad total).
          if (!submitKey) return { fallback: true as boolean };
          const latest = await tx.order.findFirst({
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
          if (!latest) return { fallback: true as boolean };
          // La "última enviada" debe seguir siéndolo al fijar el pin.
          await OrderService.verifySessionUnchanged(tx, session.id, mutationSeq, 'SUBMIT_CONFLICT');
          await tx.submitReceipt.create({
            data: { tableSessionId: session.id, orderId: latest.id, idempotencyKey: submitKey }
          });
          // Pin sin ticket nuevo: nada operativo cambió, no se avisa.
          return { orderId: latest.id, replay: false as boolean, silent: true as boolean };
        }

        // Vincular singleton histórico sin clave (recuperación determinista).
        if (!draftIds[0].draftKey) {
          await tx.order.update({ where: { id: draftIds[0].id }, data: { draftKey: session.id } });
        }
        // Buscar orden en DRAFT con sus ítems y disponibilidad vigente.
        const draftOrder = await tx.order.findFirst({
          where: { id: draftIds[0].id },
          include: { items: { include: { menuItem: { select: { name: true, isAvailable: true } } } } }
        });
        if (!draftOrder) return { fallback: true as boolean };

        if (draftOrder.items.length === 0) {
          const error: any = new Error('No hay ítems en la comanda para enviar');
          error.statusCode = 400;
          error.code = 'EMPTY_ORDER';
          throw error;
        }

        // E05: la disponibilidad y el umbral se vuelven un motivo persistido de
        // revisión. El pedido no entra a cocina hasta que el mozo lo acepte o
        // lo rechace; así no se pierde el contexto ni se envía stock imposible.
        const unavailable = draftOrder.items.filter((item: any) => !item.menuItem || !item.menuItem.isAvailable);
        const oversized = draftOrder.items.filter((item: any) => item.quantity > reviewQuantityThreshold);
        const reviewReason = reviewReasonForSubmission({
          requireValidation,
          reviewQuantityThreshold,
          unavailableItems: unavailable.map((item: any) => ({ name: item.menuItem?.name || null })),
          oversizedItems: oversized.map((item: any) => ({ name: item.menuItem?.name || null, quantity: item.quantity }))
        });
        const nextStatus = reviewReason ? OrderStatus.PENDING_VALIDATION : OrderStatus.IN_KITCHEN;

        await tx.order.update({
          where: { id: draftOrder.id },
          data: {
            status: nextStatus,
            draftKey: null,
            source: draftOrder.source || 'GUEST_QR',
            reviewReasonCode: reviewReason?.code || null,
            reviewReasonDetail: reviewReason?.detail || null
          }
        });
        if (submitKey) {
          await tx.submitReceipt.create({
            data: { tableSessionId: session.id, orderId: draftOrder.id, idempotencyKey: submitKey }
          });
        }
        // Verificación de cierre: aborta si la cuenta mutó tras el touch.
        await OrderService.verifySessionUnchanged(tx, session.id, mutationSeq, 'SUBMIT_CONFLICT');
        return { orderId: draftOrder.id, replay: false as boolean, nextStatus };
      });

    let decided: { orderId?: string; replay?: boolean; silent?: boolean; fallback?: boolean; nextStatus?: OrderStatus };
    try {
      decided = await submitInTx();
    } catch (err: any) {
      // Carrera de doble submit con la misma clave: el recibo ya existe → replay.
      // P2002 del bind de draftKey (otra tanda reclama la clave de sesión) →
      // recuento: múltiples → DRAFT_CONFLICT, si no SUBMIT_CONFLICT.
      if (submitKey && (err?.code === 'P2002' || err?.code === 'P2034')) {
        const receipt = await prisma.submitReceipt.findUnique({ where: { idempotencyKey: submitKey } });
        if (receipt && receipt.tableSessionId === session.id) {
          decided = { orderId: receipt.orderId, replay: true, silent: true };
        } else if (err?.statusCode) {
          throw err;
        } else {
          const drafts = await prisma.order.count({ where: { tableSessionId: session.id, status: OrderStatus.DRAFT } });
          if (drafts > 1) {
            const conflict: any = new Error('La mesa tiene borradores duplicados; pedí al personal que resuelva el carrito antes de seguir.');
            conflict.statusCode = 409;
            conflict.code = 'DRAFT_CONFLICT';
            throw conflict;
          }
          const conflict: any = new Error('Envío concurrente sobre el mismo carrito; reintentá con la misma clave');
          conflict.statusCode = 409;
          conflict.code = 'SUBMIT_CONFLICT';
          throw conflict;
        }
      } else if (err?.statusCode) {
        throw err;
      } else if (err?.code === 'P2002' || err?.code === 'P2034') {
        const drafts = await prisma.order.count({ where: { tableSessionId: session.id, status: OrderStatus.DRAFT } });
        if (drafts > 1) {
          const conflict: any = new Error('La mesa tiene borradores duplicados; pedí al personal que resuelva el carrito antes de seguir.');
          conflict.statusCode = 409;
          conflict.code = 'DRAFT_CONFLICT';
          throw conflict;
        }
        const conflict: any = new Error('Envío concurrente sobre el mismo carrito; reintentá');
        conflict.statusCode = 409;
        conflict.code = 'SUBMIT_CONFLICT';
        throw conflict;
      } else {
        throw err;
      }
    }

    if (decided!.fallback) {
      // Comportamiento legado sin clave y sin borrador (compatibilidad total).
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

    const fullOrder = await this.getOrderById(decided!.orderId!);
    if (!fullOrder) throw new Error('Error al recargar orden');

    const effectiveNextStatus = decided!.nextStatus || defaultNextStatus;
    if (!decided!.replay && !decided!.silent && decided!.orderId) {
      await fsmService.ensureOperationalState({
        tableId: session.tableId,
        toState: effectiveNextStatus === OrderStatus.PENDING_VALIDATION
          ? TableFSMState.OCCUPIED_NO_ORDER
          : TableFSMState.ORDER_IN_KITCHEN,
        source: SignalSource.CUSTOMER_APP,
        trigger: 'Comensal envió una nueva tanda'
      });
    }

    // Notificar al mozo y a los comensales, salvo replay o pin (ningún ticket nuevo:
    // un retry no debe duplicar aviso ni tarea operativa).
    if (!decided!.replay && !decided!.silent) {
      eventBus.broadcast(session.table.restaurantId, 'order.submitted', {
        tableId: session.tableId,
        tableLabel: session.table.label,
        sector: session.table.sector,
        requiresValidation: effectiveNextStatus === OrderStatus.PENDING_VALIDATION,
        order: fullOrder
      });
    }

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
      include: {
        tableSession: { include: { table: true } },
        items: { include: { menuItem: { select: { name: true, isAvailable: true } } } }
      }
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
      await fsmService.ensureOperationalState({
        tableId: order.tableSession.tableId,
        toState: TableFSMState.ORDER_IN_KITCHEN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Mozo confirmó una comanda ya enviada'
      });
      const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
      return fullOrder!;
    }

    const unavailable = order.items.filter((item: any) => !item.menuItem || !item.menuItem.isAvailable);
    if (unavailable.length > 0) {
      const error: any = new Error(
        `El plato "${unavailable[0].menuItem?.name || 'seleccionado'}" sigue sin stock; resolvé la excepción o rechazá la comanda.`
      );
      error.statusCode = 422;
      error.code = 'ITEM_NOT_AVAILABLE';
      error.details = {
        items: unavailable.map((item: any) => ({
          orderItemId: item.id,
          menuItemId: item.menuItemId,
          name: item.menuItem?.name || null
        }))
      };
      throw error;
    }

    // Validar transición permitida
    const allowed = ALLOWED_ORDER_TRANSITIONS[order.status as OrderStatus];
    if (!allowed || !allowed.includes(OrderStatus.IN_KITCHEN)) {
      const error: any = new Error(`Transición no permitida: no se puede validar una comanda en estado ${order.status}`);
      error.statusCode = 422;
      error.code = 'INVALID_ORDER_TRANSITION';
      throw error;
    }

    await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING_VALIDATION },
      data: {
        status: OrderStatus.IN_KITCHEN,
        draftKey: null,
        reviewReasonCode: null,
        reviewReasonDetail: null
      }
    }).then(async (changed) => {
      if (changed.count !== 0) return;
      const latest = await prisma.order.findUnique({ where: { id: orderId } });
      if (latest?.status === OrderStatus.IN_KITCHEN) return;
      if (latest?.status === OrderStatus.CANCELLED || latest?.status === OrderStatus.PAID) {
        const finalErr: any = new Error('La comanda cambió mientras se validaba; actualizá Servicio.');
        finalErr.statusCode = 409;
        finalErr.code = 'ORDER_REVIEW_CONFLICT';
        throw finalErr;
      }
      const conflict: any = new Error('La comanda cambió mientras se validaba; actualizá Servicio.');
      conflict.statusCode = 409;
      conflict.code = 'ORDER_REVIEW_CONFLICT';
      throw conflict;
    });

    await fsmService.ensureOperationalState({
      tableId: order.tableSession.tableId,
      toState: TableFSMState.ORDER_IN_KITCHEN,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: 'Mozo validó una comanda'
    });

    const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
    if (!fullOrder) throw new Error('Error al recargar orden');

    eventBus.broadcast(order.tableSession.table.restaurantId, 'order.validated', {
      tableId: order.tableSession.tableId,
      tableLabel: order.tableSession.table.label,
      order: fullOrder
    });

    return fullOrder;
  }

  /**
   * Rechaza una comanda pendiente de revisión.
   * La operación es idempotente: repetirla sobre una comanda ya CANCELLED
   * devuelve el mismo resultado y nunca crea un pago ni una segunda auditoría.
   */
  static async rejectOrder(
    orderId: string,
    reason: string,
    options?: { staffRestaurantId?: string; staffUserId?: string }
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
      const error: any = new Error('No autorizado para rechazar comandas de otro restaurante');
      error.statusCode = 403;
      error.code = 'STAFF_TENANT_MISMATCH';
      throw error;
    }

    // La respuesta histórica es la misma para cualquier reintento de rechazo.
    if (order.status === OrderStatus.CANCELLED) {
      const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
      if (!fullOrder) throw new Error('Error al recargar orden');
      return fullOrder;
    }

    if (order.status === OrderStatus.PAID) {
      const error: any = new Error('No se puede rechazar una comanda que ya fue cobrada');
      error.statusCode = 409;
      error.code = 'ORDER_FINAL_STATE';
      throw error;
    }

    const cleanReason = String(reason || '').trim().slice(0, 240);
    if (!cleanReason) {
      const error: any = new Error('Rechazar una comanda requiere un motivo explícito');
      error.statusCode = 400;
      error.code = 'REJECTION_REASON_REQUIRED';
      throw error;
    }
    if (!options?.staffUserId) {
      const error: any = new Error('No se puede auditar el rechazo sin el actor autenticado');
      error.statusCode = 403;
      error.code = 'STAFF_ACTOR_REQUIRED';
      throw error;
    }
    if (order.status !== OrderStatus.PENDING_VALIDATION) {
      const error: any = new Error('La comanda ya no está pendiente de revisión');
      error.statusCode = 422;
      error.code = 'ORDER_NOT_REVIEWABLE';
      throw error;
    }

    const cancelledAt = new Date();
    const changed = await prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.PENDING_VALIDATION },
      data: {
        status: OrderStatus.CANCELLED,
        draftKey: null,
        cancellationReason: cleanReason,
        cancelledBy: options.staffUserId,
        cancelledAt
      }
    });

    if (changed.count === 0) {
      const latest = await prisma.order.findUnique({ where: { id: order.id } });
      if (latest?.status === OrderStatus.CANCELLED) {
        const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
        if (!fullOrder) throw new Error('Error al recargar orden');
        return fullOrder;
      }
      const conflict: any = new Error('La comanda cambió mientras se rechazaba; actualizá Servicio.');
      conflict.statusCode = 409;
      conflict.code = 'ORDER_REVIEW_CONFLICT';
      throw conflict;
    }

    const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
    if (!fullOrder) throw new Error('Error al recargar orden');
    const restaurantId = order.tableSession.table.restaurantId;
    eventBus.broadcast(restaurantId, 'order.rejected', {
      orderId: order.id,
      tableId: order.tableSession.tableId,
      tableLabel: order.tableSession.table.label,
      reason: cleanReason,
      order: fullOrder
    });
    eventBus.broadcast(restaurantId, 'order.status_changed', {
      orderId: order.id,
      tableId: order.tableSession.tableId,
      tableLabel: order.tableSession.table.label,
      newStatus: OrderStatus.CANCELLED,
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

    OrderService.assertTableCanReceiveOrder(
      (table.currentState as TableFSMState) || TableFSMState.AVAILABLE
    );

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

    // Reusar una sesión vigente o rotar sólo sesiones anteriores ya resueltas.
    // Esto evita que una sesión QR vencida quede compitiendo con la nueva cuenta.
    const session = await SessionService.getOrCreateOperationalSession(
      table.id,
      table.restaurantId
    );
    if (!session) {
      const error: any = new Error('No hay un turno de servicio abierto para esta mesa');
      error.statusCode = 409;
      error.code = 'SHIFT_INACTIVE';
      throw error;
    }

    await OrderService.assertSessionCanReceiveOrder(session.id);

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
          totalAmount: 0,
          totalAmountMinor: 0,
          source: 'STAFF_TERMINAL',
          createdByStaffUserId: params.staffUserId || null
        }
      });
    } else if (order.status === OrderStatus.DRAFT || order.status === OrderStatus.PENDING_VALIDATION) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.IN_KITCHEN,
          draftKey: null,
          source: order.source || 'STAFF_TERMINAL',
          createdByStaffUserId: order.createdByStaffUserId || params.staffUserId || null
        }
      });
    }

    // Crear el ítem
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: menuItem.id,
        quantity: qty,
        unitPrice: menuItem.price,
        unitPriceMinor: (menuItem as any).priceMinor ?? toMinor(menuItem.price),
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
    const totalMinor = allItems.reduce(
      (sum, it) => sum + ((it as any).unitPriceMinor ?? toMinor(it.unitPrice)) * it.quantity,
      0
    );

    await prisma.order.update({
      where: { id: order.id },
      data: { totalAmount: safeTotal, totalAmountMinor: totalMinor }
    });

    await OrderService.transitionTableForStaffOrder({
      tableId: table.id,
      staffUserId: params.staffUserId,
      trigger: `Comanda cargada por mozo (${params.staffName || 'Salón'})`
    });

    const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
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
   * Carga presencial como una tanda propia, con varias líneas atómicas.
   * S05 no debe anexar un plato nuevo a una tanda que ya está en cocina: el
   * mismo circuito de cuenta/KDS no significa mezclar rondas. La identidad
   * del actor queda en la comanda y en cada línea conserva una nota legible.
   */
  static async addManualOrderByStaff(params: {
    tableId: string;
    lines: Array<{ menuItemId: string; quantity: number; notes?: string }>;
    staffUserId?: string;
    staffName?: string;
    staffRestaurantId?: string;
  }): Promise<OrderDTO> {
    if (!Array.isArray(params.lines) || params.lines.length === 0 || params.lines.length > 20) {
      const error: any = new Error('El pedido presencial debe contener entre 1 y 20 ítems');
      error.statusCode = 400;
      error.code = 'INVALID_MANUAL_ORDER';
      throw error;
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const now = new Date();
      const table = await tx.table.findUnique({
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
      OrderService.assertTableCanReceiveOrder(
        (table.currentState as TableFSMState) || TableFSMState.AVAILABLE
      );

      const lines = params.lines.map((line) => ({
        menuItemId: typeof line?.menuItemId === 'string' ? line.menuItemId.trim() : '',
        quantity: line?.quantity,
        notes: line?.notes
      }));
      if (lines.some((line) => !line.menuItemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50 || (line.notes !== undefined && (typeof line.notes !== 'string' || line.notes.length > 500)))) {
        const error: any = new Error('Cada ítem presencial requiere plato, cantidad entre 1 y 50 y notas de hasta 500 caracteres');
        error.statusCode = 400;
        error.code = 'INVALID_MANUAL_ORDER';
        throw error;
      }

      const ids = [...new Set(lines.map((line) => line.menuItemId))];
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: ids }, category: { restaurantId: table.restaurantId } },
        include: { category: true }
      });
      const menuById = new Map<string, any>(menuItems.map((item: any) => [item.id, item] as [string, any]));
      if (ids.some((id) => !menuById.has(id))) {
        const error: any = new Error('Uno o más platos presenciales no pertenecen a este restaurante');
        error.statusCode = 404;
        error.code = 'ITEM_NOT_FOUND';
        throw error;
      }
      if (ids.some((id) => !menuById.get(id).isAvailable)) {
        const error: any = new Error('Uno o más platos presenciales ya no están disponibles');
        error.statusCode = 422;
        error.code = 'ITEM_NOT_AVAILABLE';
        throw error;
      }

      const session = await SessionService.getOrCreateOperationalSessionTx(
        tx,
        table.id,
        table.restaurantId,
        now
      );
      if (!session) {
        const error: any = new Error('No hay un turno de servicio abierto para esta mesa');
        error.statusCode = 409;
        error.code = 'SHIFT_INACTIVE';
        throw error;
      }

      await OrderService.assertSessionCanReceiveOrderTx(tx, session.id);

      const order = await tx.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.IN_KITCHEN,
          totalAmount: 0,
          totalAmountMinor: 0,
          source: 'STAFF_TERMINAL',
          createdByStaffUserId: params.staffUserId || null
        }
      });

      const actor = params.staffName || 'Mozo';
      await tx.orderItem.createMany({
        data: lines.map((line) => {
          const menuItem = menuById.get(line.menuItemId);
          return {
            orderId: order.id,
            menuItemId: menuItem.id,
            quantity: line.quantity,
            unitPrice: menuItem.price,
            unitPriceMinor: menuItem.priceMinor ?? toMinor(menuItem.price),
            notes: line.notes ? `${line.notes} (Cargado por ${actor})` : `(Cargado por ${actor})`,
            addedByGuest: params.staffUserId || actor
          };
        })
      });

      const allItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { unitPrice: true, unitPriceMinor: true, quantity: true }
      });
      const totalAmount = Math.max(0, Math.round(allItems.reduce((sum: number, item: any) => sum + item.unitPrice * item.quantity, 0) * 100) / 100);
      const totalAmountMinor = allItems.reduce((sum: number, item: any) => sum + (item.unitPriceMinor ?? toMinor(item.unitPrice)) * item.quantity, 0);
      await tx.order.update({ where: { id: order.id }, data: { totalAmount, totalAmountMinor } });

      return { orderId: order.id, table, sessionId: session.id };
    });

    await OrderService.transitionTableForStaffOrder({
      tableId: result.table.id,
      staffUserId: params.staffUserId,
      trigger: `Pedido presencial cargado por ${params.staffName || 'Salón'}`
    });

    const fullOrder = await this.getOrderById(result.orderId, { includeTechnicalIdentity: true });
    if (!fullOrder) throw new Error('Error al recargar pedido presencial');
    eventBus.broadcast(result.table.restaurantId, 'order.submitted', {
      tableId: result.table.id,
      tableLabel: result.table.label,
      sector: result.table.sector,
      source: 'STAFF_TERMINAL',
      staffUserId: params.staffUserId || null,
      order: fullOrder
    });
    return fullOrder;
  }

  /**
   * Promueve un pre-pedido de fila en una única transacción.
   *
   * A diferencia de addItemByStaff (que atiende un toque individual del panel),
   * este camino valida todos los platos y escribe todas las líneas juntas. Así
   * un cambio de stock o un error de tenant no puede dejar media comanda en KDS.
   */
  static async addPreOrderByStaff(params: {
    tableId: string;
    lines: Array<{ menuItemId: string; quantity: number; notes?: string }>;
    staffUserId?: string;
    staffName?: string;
    staffRestaurantId?: string;
  }): Promise<OrderDTO> {
    if (!Array.isArray(params.lines) || params.lines.length === 0 || params.lines.length > 20) {
      const error: any = new Error('El pre-pedido debe contener entre 1 y 20 ítems');
      error.statusCode = 400;
      error.code = 'INVALID_PREORDER';
      throw error;
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const now = new Date();
      const table = await tx.table.findUnique({
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
      OrderService.assertTableCanReceiveOrder(
        (table.currentState as TableFSMState) || TableFSMState.AVAILABLE
      );

      const lines = params.lines.map((line) => ({
        menuItemId: typeof line?.menuItemId === 'string' ? line.menuItemId.trim() : '',
        quantity: line?.quantity,
        notes: line?.notes
      }));
      if (lines.some((line) => !line.menuItemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50 || (line.notes !== undefined && (typeof line.notes !== 'string' || line.notes.length > 500)))) {
        const error: any = new Error('Cada ítem del pre-pedido requiere plato, cantidad entre 1 y 50 y notas de hasta 500 caracteres');
        error.statusCode = 400;
        error.code = 'INVALID_PREORDER';
        throw error;
      }

      const ids = [...new Set(lines.map((line) => line.menuItemId))];
      const menuItems = await tx.menuItem.findMany({
        where: {
          id: { in: ids },
          category: { restaurantId: table.restaurantId }
        },
        include: { category: true }
      });
      const menuById = new Map<string, any>(menuItems.map((item: any) => [item.id, item] as [string, any]));
      if (ids.some((id) => !menuById.has(id))) {
        const error: any = new Error('Uno o más platos del pre-pedido no pertenecen a este restaurante');
        error.statusCode = 404;
        error.code = 'ITEM_NOT_FOUND';
        throw error;
      }
      if (ids.some((id) => !menuById.get(id).isAvailable)) {
        const error: any = new Error('Uno o más platos del pre-pedido ya no están disponibles');
        error.statusCode = 422;
        error.code = 'ITEM_NOT_AVAILABLE';
        throw error;
      }

      const session = await SessionService.getOrCreateOperationalSessionTx(
        tx,
        table.id,
        table.restaurantId,
        now
      );
      if (!session) {
        const error: any = new Error('No hay un turno de servicio abierto para esta mesa');
        error.statusCode = 409;
        error.code = 'SHIFT_INACTIVE';
        throw error;
      }

      await OrderService.assertSessionCanReceiveOrderTx(tx, session.id);

      let order = await tx.order.findFirst({
        where: {
          tableSessionId: session.id,
          status: { in: [OrderStatus.DRAFT, OrderStatus.PENDING_VALIDATION, OrderStatus.IN_KITCHEN, OrderStatus.CONFIRMED] }
        }
      });
      if (!order) {
        order = await tx.order.create({
          data: { tableSessionId: session.id, status: OrderStatus.IN_KITCHEN, totalAmount: 0 }
        });
      } else if (order.status === OrderStatus.DRAFT || order.status === OrderStatus.PENDING_VALIDATION) {
        order = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.IN_KITCHEN, draftKey: null }
        });
      }

      await tx.orderItem.createMany({
        data: lines.map((line) => {
          const menuItem = menuById.get(line.menuItemId);
          return {
            orderId: order.id,
            menuItemId: menuItem.id,
            quantity: line.quantity,
            unitPrice: menuItem.price,
            unitPriceMinor: menuItem.priceMinor ?? toMinor(menuItem.price),
            notes: line.notes ? `${line.notes} (Cargado por ${params.staffName || 'Fila virtual'})` : `(Cargado por ${params.staffName || 'Fila virtual'})`,
            addedByGuest: params.staffName || 'Fila virtual'
          };
        })
      });

      const allItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { unitPrice: true, unitPriceMinor: true, quantity: true }
      });
      const totalAmount = Math.max(0, Math.round(allItems.reduce((sum: number, item: any) => sum + item.unitPrice * item.quantity, 0) * 100) / 100);
      const totalAmountMinor = allItems.reduce(
        (sum: number, item: any) => sum + (item.unitPriceMinor ?? toMinor(item.unitPrice)) * item.quantity,
        0
      );
      await tx.order.update({ where: { id: order.id }, data: { totalAmount, totalAmountMinor } });

      return { orderId: order.id, table };
    });

    await OrderService.transitionTableForStaffOrder({
      tableId: result.table.id,
      staffUserId: params.staffUserId,
      trigger: `Pre-pedido de fila cargado por ${params.staffName || 'Salón'}`
    });

    const fullOrder = await this.getOrderById(result.orderId, { includeTechnicalIdentity: true });
    if (!fullOrder) throw new Error('Error al recargar orden');
    eventBus.broadcast(result.table.restaurantId, 'order.submitted', {
      tableId: result.table.id,
      tableLabel: result.table.label,
      sector: result.table.sector,
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
      paymentIdempotencyKey?: string;
      reason?: string;
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

    let cancellationReason: string | undefined;
    if (newStatus === OrderStatus.CANCELLED) {
      cancellationReason = String(options?.reason || '').trim().slice(0, 240);
      if (!cancellationReason) {
        const error: any = new Error('Rechazar o cancelar una comanda requiere un motivo explícito');
        error.statusCode = 400;
        error.code = 'CANCELLATION_REASON_REQUIRED';
        throw error;
      }
      if (!options?.staffUserId) {
        const error: any = new Error('No se puede auditar la cancelación sin el actor autenticado');
        error.statusCode = 403;
        error.code = 'STAFF_ACTOR_REQUIRED';
        throw error;
      }
    }

    // Idempotencia para estados intermedios/operativos
    if (order.status === newStatus) {
      const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
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
          idempotencyKey: options?.paymentIdempotencyKey || `manual_pay_${order.id}_${Date.now()}_${randomUUID().slice(0, 8)}`,
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
      // Al salir de DRAFT se libera la clave de borrador único (un nuevo carrito es posible).
      data: {
        status: newStatus,
        ...(order.status === OrderStatus.DRAFT && newStatus !== OrderStatus.DRAFT ? { draftKey: null } : {}),
        ...(newStatus === OrderStatus.CANCELLED
          ? { cancellationReason, cancelledBy: options?.staffUserId, cancelledAt: new Date() }
          : {})
      }
    });

    const restaurantId = order.tableSession.table.restaurantId;

    // Actualización de estado en FSM de la mesa
    if (newStatus === OrderStatus.SERVED) {
      try {
        await fsmService.ensureOperationalState({
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

    const fullOrder = await this.getOrderById(order.id, { includeTechnicalIdentity: true });
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
   * Cobro manual presencial por comanda — DEPRECADO (E01, contrato 04-CONTRATO-CANONICO-E01).
   * Conservado sólo por compatibilidad histórica; el camino normal es `settleSessionAccount`
   * / `settleAndCloseSessionAccount` por cuenta de sesión. No usar en flujos nuevos.
   * @deprecated Usar cuenta por sesión (`settleSessionAccount` / `settle-and-close`).
   */
  static async registerManualPayment(params: {
    orderId: string;
    staffRestaurantId: string;
    staffRole: string;
    staffUserId: string;
    paymentMethod?: string;
    tipAmount?: number;
    idempotencyKey?: string;
    customerPhone?: string;
  }) {
    const normalizedCustomerPhone = params.customerPhone?.trim()
      ? normalizeRewardsPhone(params.customerPhone)
      : undefined;
    const idempotencyKey = params.idempotencyKey?.trim() || `manual_pay_${params.orderId}_${randomUUID()}`;
    if (idempotencyKey.length > 160) {
      const error: any = new Error('idempotencyKey inválido');
      error.statusCode = 400;
      error.code = 'INVALID_IDEMPOTENCY_KEY';
      throw error;
    }

    const existingPayment = await prisma.paymentTransaction.findUnique({
      where: { idempotencyKey }
    });
    if (existingPayment) {
      if (existingPayment.orderId !== params.orderId) {
        const error: any = new Error('La clave de idempotencia ya fue utilizada para otra orden');
        error.statusCode = 409;
        error.code = 'IDEMPOTENCY_KEY_REUSED';
        throw error;
      }
      const existingOrder = await this.getOrderById(params.orderId, { includeTechnicalIdentity: true });
      return {
        order: existingOrder,
        transaction: {
          id: existingPayment.id,
          method: existingPayment.method,
          amount: existingPayment.amount,
          tipAmount: existingPayment.tipAmount,
          status: existingPayment.status,
          recordedBy: existingPayment.guestSessionId,
          resolvedAt: existingPayment.resolvedAt?.toISOString() || null
        },
        idempotentReplay: true
      };
    }

    const updatedOrder = await this.updateOrderStatusByStaff(params.orderId, OrderStatus.PAID, {
      staffRestaurantId: params.staffRestaurantId,
      staffRole: params.staffRole,
      staffUserId: params.staffUserId,
      paymentMethod: params.paymentMethod,
      tipAmount: params.tipAmount,
      paymentIdempotencyKey: idempotencyKey
    });

    const paymentTx = await prisma.paymentTransaction.findFirst({
      where: { idempotencyKey },
      orderBy: { createdAt: 'desc' }
    });

    let rewards: any = null;
    let rewardsWarning: string | null = null;
    if (normalizedCustomerPhone && paymentTx) {
      const rewardContext = await prisma.order.findUnique({
        where: { id: params.orderId },
        select: {
          tableSession: {
            select: {
              table: {
                select: {
                  restaurantId: true,
                  restaurant: { select: { moduleConfig: { select: { enableRewards: true } } } }
                }
              }
            }
          }
        }
      });
      if (rewardContext?.tableSession.table.restaurant.moduleConfig?.enableRewards) {
        try {
          rewards = await RewardsService.accrueForPayment({
            restaurantId: rewardContext.tableSession.table.restaurantId,
            phone: normalizedCustomerPhone,
            amount: paymentTx.amount,
            paymentId: paymentTx.id
          });
        } catch (err: any) {
          // El cobro presencial ya quedó confirmado. No se revierte por un
          // fallo de Rewards; se devuelve una advertencia para que el staff
          // pueda repetir el ajuste con la misma referencia.
          rewardsWarning = err?.message || 'No se pudieron acreditar los puntos Rewards';
        }
      }
    }

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
        : null,
      idempotentReplay: false,
      rewards,
      ...(rewardsWarning ? { rewardsWarning } : {})
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
        reviewReasonCode: o.reviewReasonCode ?? null,
        reviewReasonDetail: o.reviewReasonDetail ?? null,
        source: o.source ?? null,
        totalAmountMinor: o.totalAmountMinor ?? null,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt.toISOString(),
        elapsedMinutes,
        urgency: elapsedMinutes >= 25 ? 'CRITICAL' : elapsedMinutes >= 15 ? 'WARNING' : 'NORMAL',
        items: o.items.map((it) => ({
          id: it.id,
          name: it.menuItem.name,
          quantity: it.quantity,
          notes: it.notes,
          guestName: it.guestName ?? null,
          unitPrice: it.unitPrice,
          unitPriceMinor: it.unitPriceMinor ?? null
        }))
      };
    });
  }

  /**
   * Snapshot de caja presencial: sólo comandas activas con saldo pendiente.
   * No incluye pagos digitales ni órdenes finales, y conserva tenant/mesa para
   * que una sola pantalla pueda cobrar y luego liberar la mesa.
   */
  static async getCashOrders(restaurantIdOrSlug: string, staffRestaurantId?: string) {
    const restaurant = await this.resolveCashRestaurant(restaurantIdOrSlug, staffRestaurantId);

    const orders = await prisma.order.findMany({
      where: {
        tableSession: { closedAt: null, table: { restaurantId: restaurant.id } },
        status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] }
      },
      include: {
        tableSession: { include: { table: true } },
        items: { include: { menuItem: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        payments: { where: { status: { in: ['APPROVED', 'MANUAL_SETTLED'] } } }
      },
      orderBy: { createdAt: 'asc' }
    });

    return orders.flatMap((order) => {
      const paidAmount = order.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const remainingAmount = Math.max(0, Math.round((order.totalAmount - paidAmount) * 100) / 100);
      if (remainingAmount <= 0.01) return [];
      return [{
        id: order.id,
        tableId: order.tableSession.tableId,
        tableLabel: order.tableSession.table.label,
        sector: order.tableSession.table.sector,
        status: order.status,
        totalAmount: order.totalAmount,
        paidAmount,
        remainingAmount,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          notes: item.notes
        }))
      }];
    });
  }

  /**
   * Reclamo de ítem en Split Bill.
   * No disponible en la release base: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
   * Ninguna bandera de restaurante (allowSplitBill) puede saltar este bloqueo.
   */
  static async claimItemOptimistic(_dto: ClaimItemDTO): Promise<boolean> {
    throw new DigitalPaymentsUnavailableError();
  }

  /**
   * Crea o consulta una sesión de Split Bill.
   * No disponible en la release base: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
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
   * No disponible en la release base: rechaza con 503 DIGITAL_PAYMENTS_UNAVAILABLE.
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
    * HISTORIAL / LÓGICA PRE-RELEASE (PRESERVADA PARA UNA FUTURA PASARELA)
    * No borrar historial: lógica conservada para cuando se integre una pasarela real.
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
  /** Cuenta agregada con cualquier cliente Prisma (global o transaccional). */
  static async getSessionAccountTx(client: any, tableSessionId: string): Promise<SessionAccountDTO> {
    const { session, orders, settlements } = await this.loadAccountData(client, tableSessionId);
    return this.buildSessionAccount(session.id, session.tableId, orders, settlements);
  }

  /**
   * Saldo pendiente por MESA a partir de la cuenta agregada de su TableSession
   * activa (B05, C7/I5): consumo aceptado no cancelado menos pagos legacy y
   * settlements. Una tanda SERVED no cuenta como pendiente si la cuenta está
   * liquidada; pagar no marca fulfillment. remainingAmount se conserva en unidad
   * mayor por compatibilidad; remainingMinor es la verdad en centavos.
   */
  static async hasUnpaidBalance(tableId: string): Promise<{
    hasUnpaid: boolean;
    remainingAmount: number;
    remainingMinor: number;
    pendingBillCalls: number;
    pendingCalls: number;
    activeOrdersCount: number;
  }> {
    const activeSession = await prisma.tableSession.findFirst({
      where: { tableId, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true }
    });

    if (!activeSession) {
      return {
        hasUnpaid: false,
        remainingAmount: 0,
        remainingMinor: 0,
        pendingBillCalls: 0,
        pendingCalls: 0,
        activeOrdersCount: 0
      };
    }

    const account = await this.getSessionAccount(activeSession.id);
    const [pendingBillCalls, pendingCalls] = await Promise.all([
      prisma.callRequest.count({
        where: { tableSessionId: activeSession.id, type: 'BILL', status: { in: ['PENDING', 'IN_PROGRESS'] } }
      }),
      prisma.callRequest.count({
        where: { tableSessionId: activeSession.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
      })
    ]);

    const hasUnpaid = account.saldoMinor > 0 || pendingBillCalls > 0;

    return {
      hasUnpaid,
      remainingAmount: account.saldoMinor / 100,
      remainingMinor: account.saldoMinor,
      pendingBillCalls,
      pendingCalls,
      activeOrdersCount:
        account.tandas.filter((t) => t.status !== OrderStatus.PAID).length +
        account.pendingValidation.length +
        (account.draft ? 1 : 0)
    };
  }
}
