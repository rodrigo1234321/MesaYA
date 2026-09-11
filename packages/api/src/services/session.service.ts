import { prisma } from '../lib/prisma';
import { SessionValidationResponse, Sector, CallType, PaymentMethod, CallStatus, TableFSMState, SignalSource } from '@mesaya/shared';
import { randomUUID } from 'crypto';
import { isRestaurantInConfiguredInstance } from '../lib/environment';

// A double tap/request retry for the same explicit rotation must resolve to
// one operation in this API process. The database unique activeKey remains the
// last line of defence, while this coalesces the common concurrent-request
// case before the second request can start a sequential rotation.
const explicitRotationInFlight = new Map<string, Promise<string>>();

export class SessionService {
  /**
   * LIMITACIÓN DOCUMENTADA DE ARQUITECTURA:
   * Quien conserve la URL o fotografía de un código QR físico de mesa puede consultar el estado de la mesa
   * remotamente si esta se encuentra activa con una sesión en curso.
   * La geolocalización (GPS) actúa como una señal de telemetría y contexto, no como prueba criptográfica
   * de presencia física. Una admisión fuerte por visita o prevención de abuso requiere decisiones separadas
   * (PIN de comensal, confirmación presencial del mozo o tokens rotativos por NFC) antes de habilitar acciones
   * de alto impacto o transaccionales.
   */

  /**
   * Resuelve el escaneo de un QR físico de mesa (/r/:slug/mesa/:label).
   * Contrato de release:
   * - Si el restaurante no existe -> 404
   * - Si la mesa no existe -> 404
   * - Si no hay turno abierto o no hay sesión activa -> devuelve estado inactivo SIN token (200 con valid: false, isActive: false).
   * - Consultar el QR NUNCA crea restaurante, mesa, turno ni sesión en la base de datos.
   */
  static async getOrCreateActiveSessionBySlugAndTable(restaurantSlug: string, tableLabel: string): Promise<SessionValidationResponse> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ slug: restaurantSlug }, { id: restaurantSlug }] }
    });

    if (!restaurant) {
      const error: any = new Error(`Restaurante '${restaurantSlug}' no encontrado`);
      error.statusCode = 404;
      throw error;
    }

    // QR/NFC is public, so it must enforce the same single-restaurant
    // boundary as authenticated staff/admin routes. Do not reveal that a
    // tenant exists on an instance configured for another restaurant.
    if (!isRestaurantInConfiguredInstance(restaurant.id)) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      throw error;
    }

    // Buscar mesa por label exacto o formateado
    const table = await prisma.table.findFirst({
      where: {
        restaurantId: restaurant.id,
        OR: [
          { label: tableLabel },
          { label: `Mesa ${tableLabel}` },
          { label: tableLabel.toLowerCase() }
        ]
      },
      include: { restaurant: true }
    });

    if (!table) {
      const error: any = new Error(`Mesa '${tableLabel}' no encontrada en '${restaurantSlug}'`);
      error.statusCode = 404;
      throw error;
    }

    if (!isRestaurantInConfiguredInstance(table.restaurant.id)) {
      const error: any = new Error('Mesa no encontrada');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date();

    // E02: durante TO_CLEAN no se entrega sesión operativa ni datos anteriores.
    // El QR físico conserva slug/mesa y puede mostrar carta/modo lectura, pero nunca
    // la cuenta anterior ni un token operativo. Sólo tras `Mesa lista` (AVAILABLE) y
    // nueva ocupación se entrega una sesión distinta con cuenta cero.
    // M2: respuesta 200 válida con code/details coherentes (TABLE_NEEDS_CLEANING).
    if (table.currentState === TableFSMState.TO_CLEAN) {
      return {
        valid: false,
        isActive: false,
        code: 'TABLE_NEEDS_CLEANING',
        details: { tableId: table.id, tableState: table.currentState, nextAction: 'confirm-mesa-lista' },
        message: 'Mesa en preparación. El personal la habilitará en breve.',
        table: {
          id: table.id,
          label: table.label,
          sector: table.sector as Sector,
          isOutdoor: table.isOutdoor,
          currentState: table.currentState
        },
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          whatsappPhone: restaurant.whatsappPhone,
          pdfMenuUrl: restaurant.pdfMenuUrl,
          themeColor: restaurant.themeColor,
          templateId: restaurant.templateId,
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          radiusMeters: restaurant.radiusMeters
        },
        activeCall: null,
        token: undefined
      };
    }

    // Comprobar turno activo del restaurante
    const activeShift = await prisma.shift.findFirst({
      where: { restaurantId: restaurant.id, closedAt: null }
    });

    // Buscar sesión activa válida vinculada al turno abierto
    const session = activeShift
      ? await prisma.tableSession.findFirst({
          where: {
            tableId: table.id,
            shiftId: activeShift.id,
            closedAt: null,
            expiresAt: { gt: now }
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            table: { include: { restaurant: true } },
            calls: {
              where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              orderBy: { createdAt: 'desc' }
            }
          }
        })
      : null;

    if (!session) {
      // Mesa sin sesión activa: devuelve estado inactivo con metadata pública para explorar la carta
      return {
        valid: false,
        isActive: false,
        message: 'Mesa sin sesión activa. El personal habilitará la atención al tomar asiento.',
        table: {
          id: table.id,
          label: table.label,
          sector: table.sector as Sector,
          isOutdoor: table.isOutdoor,
          currentState: table.currentState
        },
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          whatsappPhone: restaurant.whatsappPhone,
          pdfMenuUrl: restaurant.pdfMenuUrl,
          themeColor: restaurant.themeColor,
          templateId: restaurant.templateId,
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          radiusMeters: restaurant.radiusMeters
        },
        activeCall: null,
        token: undefined
      };
    }

    if (!isRestaurantInConfiguredInstance(session.table.restaurant.id)) {
      return {
        valid: false,
        error: 'Sesión no encontrada o código QR no válido.'
      };
    }

    const activeCalls = session.calls.map((call) => ({
      id: call.id,
      type: call.type as CallType,
      paymentMethod: call.paymentMethod as PaymentMethod,
      tipMinor: call.tipMinor,
      note: call.note,
      status: call.status as CallStatus,
      createdAt: call.createdAt.toISOString()
    }));
    const activeCall = activeCalls[0] || null;

    return {
      valid: true,
      isActive: true,
      token: session.token,
      table: {
        id: session.table.id,
        label: session.table.label,
        sector: session.table.sector as Sector,
        isOutdoor: session.table.isOutdoor,
        currentState: session.table.currentState
      },
      restaurant: {
        id: session.table.restaurant.id,
        name: session.table.restaurant.name,
        slug: session.table.restaurant.slug,
        whatsappPhone: session.table.restaurant.whatsappPhone,
        pdfMenuUrl: session.table.restaurant.pdfMenuUrl,
        themeColor: session.table.restaurant.themeColor,
        templateId: session.table.restaurant.templateId,
        latitude: session.table.restaurant.latitude,
        longitude: session.table.restaurant.longitude,
        radiusMeters: session.table.restaurant.radiusMeters
      },
      activeCall,
      activeCalls,
      expiresAt: session.expiresAt.toISOString()
    };
  }

  static async getOrCreateActiveDemoSession(tableLabel: string = 'Mesa 1'): Promise<SessionValidationResponse> {
    const isExplicitTest =
      process.env.NODE_ENV === 'test' && process.env.ALLOW_LEGACY_DEMO_ROUTES === 'true';

    if (!isExplicitTest) {
      const error: any = new Error(
        'Método legacy deshabilitado. La resolución canónica de QR requiere restaurante y mesa.'
      );
      error.statusCode = 403;
      error.code = 'FORBIDDEN_LEGACY_ROUTE';
      throw error;
    }

    // Incluso con el flag de prueba activo, la ruta legacy no puede revelar ni resolver
    // tokens operativos activos de mesas o restaurantes reales. Devuelve estado inactivo sin token.
    const table = await prisma.table.findFirst({
      where: {
        OR: [
          { label: tableLabel },
          { label: `Mesa ${tableLabel}` },
          { label: tableLabel.toLowerCase() }
        ]
      },
      include: { restaurant: true }
    });

    if (!table) {
      const error: any = new Error(`Mesa '${tableLabel}' no encontrada`);
      error.statusCode = 404;
      throw error;
    }

    if (!isRestaurantInConfiguredInstance(table.restaurant.id)) {
      const error: any = new Error('Mesa no encontrada');
      error.statusCode = 404;
      throw error;
    }

    return {
      valid: false,
      isActive: false,
      message: 'Ruta legacy en modo demo: no expone tokens operativos de sesión. Utilice la URL canónica /r/:slug/mesa/:label.',
      table: {
        id: table.id,
        label: table.label,
        sector: table.sector as Sector,
        isOutdoor: table.isOutdoor,
        currentState: table.currentState
      },
      restaurant: {
        id: table.restaurant.id,
        name: table.restaurant.name,
        slug: table.restaurant.slug,
        whatsappPhone: table.restaurant.whatsappPhone,
        pdfMenuUrl: table.restaurant.pdfMenuUrl,
        themeColor: table.restaurant.themeColor,
        templateId: table.restaurant.templateId,
        latitude: table.restaurant.latitude,
        longitude: table.restaurant.longitude,
        radiusMeters: table.restaurant.radiusMeters
      },
      activeCall: null,
      token: undefined
    };
  }

  /**
   * Validación centralizada de token de comensal.
   * Comprueba:
   * - Formato de token (rechaza demo-token, latest, null, undefined)
   * - Existencia de la sesión en base de datos
   * - Estado del turno del restaurante (shift.closedAt === null)
   * - Cierre explícito de la sesión (closedAt === null)
   * - Expiración temporal (now < expiresAt)
   * - Estado de ocupación de la mesa (si la mesa fue liberada a AVAILABLE, la sesión previa está revocada)
   */
  static async validateToken(token: string): Promise<SessionValidationResponse> {
    if (!token || token === 'demo-token' || token === 'latest' || token === 'null' || token === 'undefined') {
      return {
        valid: false,
        code: 'SESSION_NOT_FOUND',
        error: 'Token de sesión no válido o no proporcionado.'
      };
    }

    const session = await prisma.tableSession.findUnique({
      where: { token },
      include: {
        table: {
          include: {
            restaurant: true
          }
        },
        shift: true,
        calls: {
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!session) {
      return {
        valid: false,
        code: 'SESSION_NOT_FOUND',
        error: 'Sesión no encontrada o código QR no válido.'
      };
    }

    // Tokens are bearer credentials. In single-restaurant mode a token from
    // another tenant must look indistinguishable from an unknown token.
    if (!isRestaurantInConfiguredInstance(session.table.restaurant.id)) {
      return {
        valid: false,
        code: 'SESSION_NOT_FOUND',
        error: 'Sesión no encontrada o código QR no válido.'
      };
    }

    const now = new Date();

    // 1. Validar si el turno fue cerrado
    // M2: 410 con code/details coherentes (SHIFT_CLOSED), preservando isClosed.
    if (session.shift && session.shift.closedAt !== null) {
      return {
        valid: false,
        isClosed: true,
        code: 'SHIFT_CLOSED',
        details: {
          tableId: session.table.id,
          tableSessionId: session.id,
          tableState: session.table.currentState,
          shiftId: session.shift.id
        },
        error: 'El turno del restaurante ha finalizado. Por favor consulta con el personal.',
        table: {
          id: session.table.id,
          label: session.table.label,
          sector: session.table.sector as Sector,
          isOutdoor: session.table.isOutdoor,
          currentState: session.table.currentState
        },
        restaurant: {
          id: session.table.restaurant.id,
          name: session.table.restaurant.name,
          slug: session.table.restaurant.slug
        }
      };
    }

    // 2. Validar si la sesión fue cerrada o si la mesa está en limpieza
    // M2: 410 con code SESSION_CLOSED + details (sesión cerrada o TO_CLEAN).
    if (
      session.closedAt !== null ||
      session.table.currentState === TableFSMState.TO_CLEAN
    ) {
      return {
        valid: false,
        isClosed: true,
        code: 'SESSION_CLOSED',
        details: {
          tableId: session.table.id,
          tableSessionId: session.id,
          tableState: session.table.currentState,
          closedAt: session.closedAt ? new Date(session.closedAt).toISOString() : null
        },
        error: 'Esta sesión de mesa ha finalizado. Por favor escanea el QR físico de la mesa para iniciar una nueva atención.',
        table: {
          id: session.table.id,
          label: session.table.label,
          sector: session.table.sector as Sector,
          isOutdoor: session.table.isOutdoor,
          currentState: session.table.currentState
        },
        restaurant: {
          id: session.table.restaurant.id,
          name: session.table.restaurant.name,
          slug: session.table.restaurant.slug
        }
      };
    }

    // 3. Validar expiración temporal
    // M2: 410 con code SESSION_EXPIRED + details.
    if (now > new Date(session.expiresAt)) {
      return {
        valid: false,
        isExpired: true,
        code: 'SESSION_EXPIRED',
        details: {
          tableId: session.table.id,
          tableSessionId: session.id,
          tableState: session.table.currentState,
          expiresAt: new Date(session.expiresAt).toISOString()
        },
        error: 'La sesión de la mesa ha expirado. Por favor escanea el QR de la mesa nuevamente.',
        table: {
          id: session.table.id,
          label: session.table.label,
          sector: session.table.sector as Sector,
          isOutdoor: session.table.isOutdoor,
          currentState: session.table.currentState
        },
        restaurant: {
          id: session.table.restaurant.id,
          name: session.table.restaurant.name,
          slug: session.table.restaurant.slug
        }
      };
    }

    const activeCalls = session.calls.map((call) => ({
      id: call.id,
      type: call.type as CallType,
      paymentMethod: call.paymentMethod as PaymentMethod,
      tipMinor: call.tipMinor,
      note: call.note,
      status: call.status as CallStatus,
      createdAt: call.createdAt.toISOString()
    }));
    const activeCall = activeCalls[0] || null;

    return {
      valid: true,
      isActive: true,
      token: session.token,
      table: {
        id: session.table.id,
        label: session.table.label,
        sector: session.table.sector as Sector,
        isOutdoor: session.table.isOutdoor,
        currentState: session.table.currentState
      },
      restaurant: {
        id: session.table.restaurant.id,
        name: session.table.restaurant.name,
        slug: session.table.restaurant.slug,
        whatsappPhone: session.table.restaurant.whatsappPhone,
        pdfMenuUrl: session.table.restaurant.pdfMenuUrl,
        themeColor: session.table.restaurant.themeColor,
        templateId: session.table.restaurant.templateId,
        latitude: session.table.restaurant.latitude,
        longitude: session.table.restaurant.longitude,
        radiusMeters: session.table.restaurant.radiusMeters
      },
      activeCall,
      activeCalls,
      expiresAt: session.expiresAt.toISOString()
    };
  }

  /**
   * Cierre de sesión de mesa (B05, C7/I5): explícito, atómico y sin pérdidas.
   * Toda la validación (saldo de cuenta, borrador, validación pendiente, llamados)
   * y el marcado de cierre ocurren dentro de UNA transacción: no existe
   * check-then-close. El carrito DRAFT no se borra ni se cobra; los llamados
   * pendientes NO se auto-resuelven (solo una acción explícita los cambia) y el
   * cierre se bloquea con 409 accionable dejando todo intacto.
   *
   * Política de force (compatibilidad de firma conservada): la ruta exige MANAGER
   * para force; el servicio exige además motivo explícito y, aun así, force NUNCA
   * omite deuda, borrador, validación ni llamados (queda auditado en el evento FSM).
   * Pagada ≠ disponible: el cierre lleva a TO_CLEAN, nunca directo a AVAILABLE.
   */
  static async closeTableSession(
    tableId: string,
    options?: { force?: boolean; reason?: string }
  ): Promise<{ success: boolean; message: string; alreadyClosed?: boolean }> {
    if (options?.force && (!options.reason || !options.reason.trim())) {
      const error: any = new Error('El cierre forzado requiere motivo explícito de encargado.');
      error.statusCode = 400;
      error.code = 'FORCE_REASON_REQUIRED';
      throw error;
    }

    let closedSessionId: string | null = null;
    const closedInTx = await prisma.$transaction(async (tx) => {
      // Touch primero (B06): serializa este cierre frente a add/remove/submit/settle
      // sobre la misma sesión. Toda lectura posterior ve el estado post-lock.
      const touchTarget = await tx.tableSession.findFirst({
        where: { tableId, closedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true }
      });
      if (!touchTarget) return false;
      await tx.tableSession.updateMany({
        where: { id: touchTarget.id },
        data: { mutationSeq: { increment: 1 } }
      });
      const touched = await tx.tableSession.findUnique({
        where: { id: touchTarget.id },
        select: { id: true, tableId: true, closedAt: true, mutationSeq: true }
      });
      if (!touched || touched.closedAt !== null) return false;
      const seenSeq = touched.mutationSeq;

      const { OrderService } = await import('./order.service');
      const account = await OrderService.getSessionAccountTx(tx, touched.id);

      // 1. Deuda de consumo: jamás se cierra con saldo, ni con force.
      if (account.saldoMinor > 0) {
        const error: any = new Error(
          `No se puede cerrar la mesa con consumos pendientes ($${(account.saldoMinor / 100).toFixed(2)}) o llamados de cuenta sin resolver.`
        );
        error.statusCode = 409;
        error.code = 'TABLE_HAS_UNPAID_BALANCE';
        throw error;
      }
      // 2. Carrito sin enviar: 409 accionable, sesión intacta (no se borra ni se cobra).
      if (account.draft) {
        const error: any = new Error(
          'La mesa tiene un carrito sin enviar; descartalo o envialo explícitamente antes de cerrar.'
        );
        error.statusCode = 409;
        error.code = 'DRAFT_UNRESOLVED';
        throw error;
      }
      // 3. Validación pendiente sin resolución explícita del personal.
      if (account.pendingValidation.length > 0) {
        const error: any = new Error(
          'La mesa tiene tandas esperando confirmación; aceptalas o rechazalas explícitamente antes de cerrar.'
        );
        error.statusCode = 409;
        error.code = 'PENDING_VALIDATION_UNRESOLVED';
        throw error;
      }
      // 4. Llamados pendientes (cualquier motivo): bloquean; sin auto-resolve.
      const pendingCalls = await tx.callRequest.findMany({
        where: {
          tableSessionId: touched.id,
          status: { in: ['PENDING', 'IN_PROGRESS'] }
        },
        select: { id: true, type: true, status: true }
      });
      if (pendingCalls.length > 0) {
        const types = [...new Set(pendingCalls.map((c) => c.type))].sort().join(',');
        const error: any = new Error(
          `La mesa tiene ${pendingCalls.length} llamado(s) pendiente(s) (${types}); resolvelos o cancelalos explícitamente antes de cerrar.`
        );
        error.statusCode = 409;
        error.code = 'PENDING_CALLS';
        error.details = { count: pendingCalls.length, types };
        throw error;
      }

      // 5. Cierre condicional (B06): solo si nadie mutó la cuenta tras el touch.
      // Si add/submit/settle se intercaló, la serie se movió → 409 CLOSE_CONFLICT
      // (releer) en vez de cerrar sobre deuda/consumo nuevo.
      const now = new Date();
      const closed = await tx.tableSession.updateMany({
        where: { id: touched.id, closedAt: null, mutationSeq: seenSeq },
        data: { closedAt: now, activeKey: null }
      });
      if (closed.count !== 1) {
        const error: any = new Error('La mesa cambió durante el cierre; releé el estado y reintentá');
        error.statusCode = 409;
        error.code = 'CLOSE_CONFLICT';
        throw error;
      }
      closedSessionId = touched.id;
      return true;
    });

    const readTableState = async () => {
      const row = await prisma.table.findUnique({ where: { id: tableId }, select: { currentState: true } });
      return (row?.currentState as TableFSMState | undefined) ?? null;
    };

    const toClosureIncomplete = (fsmErr: any, sessionId: string | null, currentState: TableFSMState | null): any => {
      const error: any = new Error(
        'La sesión quedó cerrada en base pero la mesa no pasó a limpieza; reintentá el cierre con los mismos parámetros para completar la FSM.'
      );
      error.statusCode = fsmErr?.statusCode === 409 ? 409 : 503;
      error.code = 'TABLE_CLOSURE_INCOMPLETE';
      error.details = {
        tableId,
        tableSessionId: sessionId,
        currentState,
        fsmCode: fsmErr?.code ?? null,
        fsmMessage: fsmErr?.message ?? null,
        nextAction: 'retry-close-table-session'
      };
      return error;
    };

    // M1: sin sesión abierta no implica cierre completo. Si la mesa ya está en
    // TO_CLEAN/AVAILABLE el ciclo terminó (alreadyClosed); en cualquier otro
    // estado el cierre DB quedó sin FSM → completar o TABLE_CLOSURE_INCOMPLETE.
    if (!closedInTx) {
      const currentState = await readTableState();
      if (currentState === TableFSMState.TO_CLEAN || currentState === TableFSMState.AVAILABLE) {
        return {
          success: true,
          message: 'La mesa ya se encontraba cerrada y disponible.',
          alreadyClosed: true
        };
      }
      try {
        const { fsmService } = await import('./fsm.service');
        await fsmService.attemptTransition({
          tableId,
          toState: TableFSMState.TO_CLEAN,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: 'STAFF_CLOSE_SESSION_RETRY',
          metadata: options?.force ? { forced: true, reason: options.reason } : undefined
        });
      } catch (err) {
        throw toClosureIncomplete(err, closedSessionId, currentState);
      }
      return {
        success: true,
        message: 'Sesión de mesa finalizada y mesa lista para limpieza (TO_CLEAN).'
      };
    }

    // Transición FSM a TO_CLEAN (fuera de la tx, patrón existente): mueve la mesa a
    // TO_CLEAN, nunca directo a AVAILABLE. No resuelve llamados (ya validados arriba).
    // M1: si la FSM falla, NO devolver éxito: 503/409 TABLE_CLOSURE_INCOMPLETE
    // con detalles accionables; el reintento completa la FSM (rama de arriba).
    try {
      const { fsmService } = await import('./fsm.service');
      await fsmService.attemptTransition({
        tableId,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'STAFF_CLOSE_SESSION',
        metadata: options?.force ? { forced: true, reason: options.reason } : undefined
      });
    } catch (err: any) {
      throw toClosureIncomplete(err, closedSessionId, await readTableState());
    }

    return {
      success: true,
      message: 'Sesión de mesa finalizada y mesa lista para limpieza (TO_CLEAN).'
    };
  }

  /**
   * Devuelve la única sesión operativa que puede usar el personal para una
   * mesa, cerrando únicamente sesiones anteriores ya resueltas. Las sesiones
   * vencidas dejan de servir al QR, pero no se pueden ocultar si conservan
   * saldo, borrador, validación pendiente o llamados activos.
   *
   * Se recibe un cliente Prisma para que los caminos atómicos (pedido
   * presencial y pre-pedido) ejecuten la selección, saneamiento y alta dentro
   * de la misma transacción.
   */
  static async getOrCreateOperationalSessionTx(
    client: any,
    tableId: string,
    restaurantId: string,
    now = new Date(),
    options: { createShiftIfMissing?: boolean } = {}
  ): Promise<any | null> {
    // E02: TO_CLEAN bloquea alta operativa hasta `Mesa lista`, incluso sin sesiones abiertas.
    const tableState = await client.table.findUnique({ where: { id: tableId }, select: { currentState: true } });
    if (tableState?.currentState === TableFSMState.TO_CLEAN) {
      const error: any = new Error(
        'La mesa está en limpieza; confirmá `Mesa lista` antes de iniciar una nueva ocupación.'
      );
      error.statusCode = 409;
      error.code = 'TABLE_NEEDS_CLEANING';
      error.details = { tableId };
      throw error;
    }
    const openSessions = await client.tableSession.findMany({
      where: { tableId, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    const activeSession = openSessions.find((session: any) => new Date(session.expiresAt).getTime() > now.getTime());
    const staleSessions = openSessions.filter((session: any) => session.id !== activeSession?.id);

    // Sin sesión vigente, EATING/PAID nunca reabren por este camino: se valida
    // ANTES de cerrar o sanear nada. EATING implica servicio en curso sin
    // sesión válida (inconsistencia a resolver por staff) y PAID exige
    // liberación/limpieza antes de otra ocupación. TO_CLEAN ya se bloqueó arriba.
    if (!activeSession) {
      const currentForCreate = tableState?.currentState as TableFSMState | undefined;
      if (currentForCreate === TableFSMState.EATING || currentForCreate === TableFSMState.PAID) {
        const error: any = new Error(
          currentForCreate === TableFSMState.PAID
            ? 'La mesa ya fue cobrada y debe liberarse/limpiarse antes de iniciar otra ocupación.'
            : 'La mesa está en servicio y no puede iniciar una ocupación nueva sin sesión vigente; resolvé la ocupación actual.'
        );
        error.statusCode = 409;
        error.code = 'TABLE_NOT_AVAILABLE';
        error.details = { tableId, currentState: currentForCreate };
        throw error;
      }
    }

    if (staleSessions.length > 0) {
      const { OrderService } = await import('./order.service');
      const unresolved: Array<Record<string, unknown>> = [];
      const seenById = new Map<string, number>();

      for (const stale of staleSessions) {
        // Serializar mutationSeq antes de leer la cuenta: el touch toma el lock
        // de escritura y toda lectura posterior ve el estado post-lock.
        await client.tableSession.updateMany({
          where: { id: stale.id },
          data: { mutationSeq: { increment: 1 } }
        });
        const touched = await client.tableSession.findUnique({
          where: { id: stale.id },
          select: { id: true, closedAt: true, mutationSeq: true }
        });
        if (!touched || touched.closedAt !== null) continue;
        seenById.set(stale.id, touched.mutationSeq);
        const account = await OrderService.getSessionAccountTx(client, stale.id);
        const pendingCalls = await client.callRequest.count({
          where: {
            tableSessionId: stale.id,
            status: { in: ['PENDING', 'IN_PROGRESS'] }
          }
        });
        if (account.saldoMinor > 0 || account.draft || account.pendingValidation.length > 0 || pendingCalls > 0) {
          unresolved.push({
            tableSessionId: stale.id,
            saldoMinor: account.saldoMinor,
            hasDraft: Boolean(account.draft),
            pendingValidation: account.pendingValidation.length,
            pendingCalls
          });
        }
      }

      if (unresolved.length > 0) {
        const error: any = new Error(
          'Existe otra sesión abierta de esta mesa con saldo o trabajo pendiente. Resolvela antes de iniciar una nueva atención.'
        );
        error.statusCode = 409;
        error.code = 'STALE_SESSION_UNRESOLVED';
        error.details = { tableId, sessions: unresolved };
        throw error;
      }

      // Revalidación: sólo cerrar si nadie mutó tras el touch; si la serie se
      // movió, otra mutación válida se intercaló → 409 para releer.
      for (const stale of staleSessions) {
        const seenSeq = seenById.get(stale.id);
        if (seenSeq === undefined) continue;
        const closed = await client.tableSession.updateMany({
          where: { id: stale.id, closedAt: null, mutationSeq: seenSeq },
          data: { closedAt: now, activeKey: null }
        });
        if (closed.count !== 1) {
          const error: any = new Error('La mesa cambió durante la resolución; releé el estado y reintentá');
          error.statusCode = 409;
          error.code = 'STALE_SESSION_CONFLICT';
          error.details = { tableId, tableSessionId: stale.id };
          throw error;
        }
      }
    }

    // Versiones antiguas podían dejar activeKey en sesiones cerradas o crear
    // la sesión nueva sin esa clave. Sanear sólo la misma mesa permite que la
    // restricción única vuelva a proteger una sesión operativa por mesa.
    await client.tableSession.updateMany({
      where: {
        tableId,
        activeKey: { not: null },
        ...(activeSession ? { id: { not: activeSession.id } } : {})
      },
      data: { activeKey: null }
    });

    if (activeSession) {
      if (activeSession.activeKey !== tableId) {
        await client.tableSession.updateMany({
          where: { id: activeSession.id, closedAt: null },
          data: { activeKey: tableId }
        });
      }
      return activeSession;
    }

    // Sin sesión vigente, crear sólo si la mesa puede iniciar ocupación.
    // EATING/PAID/TO_CLEAN ya se bloquearon arriba antes de mutar nada.
    let shift = await client.shift.findFirst({
      where: { restaurantId, closedAt: null },
      orderBy: { openedAt: 'desc' }
    });
    if (!shift && options.createShiftIfMissing === false) return null;
    if (!shift) shift = await client.shift.create({ data: { restaurantId } });

    return client.tableSession.create({
      data: {
        tableId,
        shiftId: shift.id,
        activeKey: tableId,
        token: randomUUID(),
        expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        createdAt: now
      }
    });
  }

  /**
   * Variante para escritores que no tienen una transacción envolvente. La
   * clave única de TableSession convierte una carrera de alta en una relectura
   * limpia del ganador.
   */
  static async getOrCreateOperationalSession(
    tableId: string,
    restaurantId: string,
    now = new Date(),
    options: { createShiftIfMissing?: boolean } = {}
  ): Promise<any | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction((tx) =>
          SessionService.getOrCreateOperationalSessionTx(tx, tableId, restaurantId, now, options)
        );
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt === 0) continue;
        throw err;
      }
    }
    return null;
  }

  /**
   * Rotación explícita de sesión (E02, manager): sólo acepta mesa AVAILABLE.
   * Nunca reabre EATING/PAID/TO_CLEAN ni reutiliza una ocupación anterior:
   * con deuda, borrador, revisión o llamado responde 409 accionable y deja
   * todo intacto. Sólo sesiones ya resueltas se revocan antes de emitir
   * id/token nuevos con cuenta cero. Serializa mutationSeq antes de leer la
   * cuenta y revalida antes de cerrar/crear; una carrera concurrente siempre
   * termina con una sola sesión activa protegida por `activeKey` y el último
   * token creado queda como ganador observable.
   * El QR físico conserva slug/mesa; lo que rota es id/token de ocupación.
   */
  static async createNewSessionForTable(tableId: string): Promise<string> {
    const inFlight = explicitRotationInFlight.get(tableId);
    if (inFlight) return inFlight;

    const operation = SessionService.rotateSessionForTable(tableId);
    explicitRotationInFlight.set(tableId, operation);
    try {
      return await operation;
    } finally {
      if (explicitRotationInFlight.get(tableId) === operation) {
        explicitRotationInFlight.delete(tableId);
      }
    }
  }

  private static async rotateSessionForTable(tableId: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const token = randomUUID();
      try {
        const session = await prisma.$transaction(async (tx) => {
          const table = await tx.table.findUnique({ where: { id: tableId } });
          if (!table) {
            const error: any = new Error('Mesa no encontrada');
            error.statusCode = 404;
            throw error;
          }

          // E02: TO_CLEAN bloquea toda rotación hasta `Mesa lista` (AVAILABLE).
          // Sólo la confirmación física de limpieza habilita la siguiente ocupación
          // con id/token nuevos y cuenta cero; el QR conserva slug/mesa.
          if (table.currentState === TableFSMState.TO_CLEAN) {
            const error: any = new Error(
              'La mesa está en limpieza; confirmá `Mesa lista` antes de iniciar una nueva ocupación.'
            );
            error.statusCode = 409;
            error.code = 'TABLE_NEEDS_CLEANING';
            error.details = { tableId };
            throw error;
          }

          const openSessions = await tx.tableSession.findMany({
            where: { tableId, closedAt: null },
            select: { id: true }
          });

          // La deuda y otros bloqueos de la ocupación son más accionables que
          // el estado derivado de la mesa. Se consultan antes de TABLE_NOT_AVAILABLE
          // sin escribir nada; así el personal recibe la resolución correcta y la
          // ocupación permanece intacta.
          if (openSessions.length > 0 && (table.currentState as TableFSMState) !== TableFSMState.AVAILABLE) {
            const { OrderService } = await import('./order.service');
            for (const open of openSessions) {
              const account = await OrderService.getSessionAccountTx(tx, open.id);
              if (account.saldoMinor > 0) {
                const error: any = new Error(
                  `No se puede rotar la mesa con consumos pendientes ($${(account.saldoMinor / 100).toFixed(2)}).`
                );
                error.statusCode = 409;
                error.code = 'TABLE_HAS_UNPAID_BALANCE';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              if (account.draft) {
                const error: any = new Error(
                  'La mesa tiene un carrito sin enviar; descartalo o envialo explícitamente antes de rotar.'
                );
                error.statusCode = 409;
                error.code = 'DRAFT_UNRESOLVED';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              if (account.pendingValidation.length > 0) {
                const error: any = new Error(
                  'La mesa tiene tandas esperando confirmación; aceptalas o rechazalas explícitamente antes de rotar.'
                );
                error.statusCode = 409;
                error.code = 'PENDING_VALIDATION_UNRESOLVED';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              const pendingCalls = await tx.callRequest.count({
                where: { tableSessionId: open.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
              });
              if (pendingCalls > 0) {
                const error: any = new Error(
                  `La mesa tiene ${pendingCalls} llamado(s) pendiente(s); resolvelos o cancelalos explícitamente antes de rotar.`
                );
                error.statusCode = 409;
                error.code = 'PENDING_CALLS';
                error.details = { tableSessionId: open.id, count: pendingCalls };
                throw error;
              }
            }
          }

          // Sólo AVAILABLE acepta rotación explícita. Nunca reabrir
          // EATING/PAID/TO_CLEAN (TO_CLEAN ya bloqueado arriba con código
          // accionable propio). Se valida ANTES de tocar o cerrar sesiones:
          // una mesa no disponible nunca muta ocupaciones, ni siquiera dentro
          // de una tx que luego haría rollback.
          if ((table.currentState as TableFSMState) !== TableFSMState.AVAILABLE) {
            const error: any = new Error(
              `La mesa en estado ${table.currentState} no admite rotación explícita; sólo AVAILABLE inicia una ocupación nueva.`
            );
            error.statusCode = 409;
            error.code = 'TABLE_NOT_AVAILABLE';
            error.details = { tableId, currentState: table.currentState };
            throw error;
          }

          const shift = await tx.shift.findFirst({
            where: { restaurantId: table.restaurantId, closedAt: null }
          });
          if (!shift) {
            const error: any = new Error('No hay un turno de servicio abierto para este restaurante.');
            error.statusCode = 400;
            throw error;
          }

          const seenSeqBySession = new Map<string, number>();
          if (openSessions.length > 0) {
            const { OrderService } = await import('./order.service');
            for (const open of openSessions) {
              await tx.tableSession.updateMany({
                where: { id: open.id },
                data: { mutationSeq: { increment: 1 } }
              });
              const touched = await tx.tableSession.findUnique({
                where: { id: open.id },
                select: { id: true, closedAt: true, mutationSeq: true }
              });
              if (!touched || touched.closedAt !== null) continue;
              seenSeqBySession.set(open.id, touched.mutationSeq);
              const account = await OrderService.getSessionAccountTx(tx, open.id);
              if (account.saldoMinor > 0) {
                const error: any = new Error(
                  `No se puede rotar la mesa con consumos pendientes ($${(account.saldoMinor / 100).toFixed(2)}).`
                );
                error.statusCode = 409;
                error.code = 'TABLE_HAS_UNPAID_BALANCE';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              if (account.draft) {
                const error: any = new Error(
                  'La mesa tiene un carrito sin enviar; descartalo o envialo explícitamente antes de rotar.'
                );
                error.statusCode = 409;
                error.code = 'DRAFT_UNRESOLVED';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              if (account.pendingValidation.length > 0) {
                const error: any = new Error(
                  'La mesa tiene tandas esperando confirmación; aceptalas o rechazalas explícitamente antes de rotar.'
                );
                error.statusCode = 409;
                error.code = 'PENDING_VALIDATION_UNRESOLVED';
                error.details = { tableSessionId: open.id };
                throw error;
              }
              const pendingCalls = await tx.callRequest.count({
                where: { tableSessionId: open.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
              });
              if (pendingCalls > 0) {
                const error: any = new Error(
                  `La mesa tiene ${pendingCalls} llamado(s) pendiente(s); resolvelos o cancelalos explícitamente antes de rotar.`
                );
                error.statusCode = 409;
                error.code = 'PENDING_CALLS';
                error.details = { tableSessionId: open.id, count: pendingCalls };
                throw error;
              }
            }
            // Revalidación condicional antes de revocar sesiones resueltas.
            for (const open of openSessions) {
              const seenSeq = seenSeqBySession.get(open.id);
              if (seenSeq === undefined) continue;
              const revoked = await tx.tableSession.updateMany({
                where: { id: open.id, closedAt: null, mutationSeq: seenSeq },
                data: { closedAt: now, activeKey: null }
              });
              if (revoked.count !== 1) {
                const error: any = new Error('La mesa cambió durante la rotación; releé el estado y reintentá');
                error.statusCode = 409;
                error.code = 'ROTATION_CONFLICT';
                error.details = { tableId, tableSessionId: open.id };
                throw error;
              }
            }
          }

          // Sanear claves residuales de la misma mesa para que la restricción única
          // vuelva a proteger una sola ocupación operativa.
          await tx.tableSession.updateMany({
            where: { tableId, activeKey: { not: null } },
            data: { activeKey: null }
          });

          return tx.tableSession.create({
            data: { tableId, shiftId: shift.id, activeKey: tableId, token, expiresAt, createdAt: now }
          });
        });
        return session.token;
      } catch (err: any) {
        if (err?.code !== 'P2002' || attempt === 1) throw err;
        // Carrera de alta: la clave única eligió un ganador; converger en él en vez
        // de cerrar la ocupación recién creada y abrir otra (una sola ocupación).
        const winner = await prisma.tableSession.findFirst({
          where: { tableId, closedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { token: true }
        });
        if (winner?.token) return winner.token;
      }
    }
    throw new Error('No se pudo confirmar la rotación de sesión');
  }
}
