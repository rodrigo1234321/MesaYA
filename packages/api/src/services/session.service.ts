import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { SessionValidationResponse, Sector, CallType, PaymentMethod, CallStatus, TableFSMState, SignalSource } from '@mesaya/shared';
import { randomUUID } from 'crypto';

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
   * Contrato de piloto:
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

    const now = new Date();

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
          include: {
            table: { include: { restaurant: true } },
            calls: {
              where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              orderBy: { createdAt: 'desc' },
              take: 1
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

    const activeCall = session.calls[0] ? {
      id: session.calls[0].id,
      type: session.calls[0].type as CallType,
      paymentMethod: session.calls[0].paymentMethod as PaymentMethod,
      status: session.calls[0].status as CallStatus,
      createdAt: session.calls[0].createdAt.toISOString()
    } : null;

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
          where: {
            status: { in: ['PENDING', 'IN_PROGRESS'] }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!session) {
      return {
        valid: false,
        error: 'Sesión no encontrada o código QR no válido.'
      };
    }

    const now = new Date();

    // 1. Validar si el turno fue cerrado
    if (session.shift && session.shift.closedAt !== null) {
      return {
        valid: false,
        isClosed: true,
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
    if (
      session.closedAt !== null ||
      session.table.currentState === TableFSMState.TO_CLEAN
    ) {
      return {
        valid: false,
        isClosed: true,
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
    if (now > new Date(session.expiresAt)) {
      return {
        valid: false,
        isExpired: true,
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

    const activeCall = session.calls[0] ? {
      id: session.calls[0].id,
      type: session.calls[0].type as CallType,
      paymentMethod: session.calls[0].paymentMethod as PaymentMethod,
      status: session.calls[0].status as CallStatus,
      createdAt: session.calls[0].createdAt.toISOString()
    } : null;

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
      expiresAt: session.expiresAt.toISOString()
    };
  }

  static async closeTableSession(
    tableId: string,
    options?: { force?: boolean }
  ): Promise<{ success: boolean; message: string; alreadyClosed?: boolean }> {
    const activeSession = await prisma.tableSession.findFirst({
      where: { tableId, closedAt: null },
      include: { table: true }
    });

    if (!activeSession) {
      return {
        success: true,
        message: 'La mesa ya se encontraba cerrada y disponible.',
        alreadyClosed: true
      };
    }

    if (!options?.force) {
      const { OrderService } = await import('./order.service');
      const unpaid = await OrderService.hasUnpaidBalance(tableId);
      if (unpaid.hasUnpaid) {
        const error: any = new Error(
          `No se puede cerrar la mesa con consumos pendientes ($${unpaid.remainingAmount.toFixed(2)}) o llamados de cuenta sin resolver.`
        );
        error.statusCode = 409;
        error.code = 'TABLE_HAS_UNPAID_BALANCE';
        throw error;
      }
    }

    const now = new Date();
    // 1. Revocar sesiones activas e invalidar activeKey
    await prisma.tableSession.updateMany({
      where: { tableId, closedAt: null },
      data: { closedAt: now, activeKey: null }
    });

    // 2. Resolución de llamados pendientes
    const pendingCalls = await prisma.callRequest.findMany({
      where: {
        tableSessionId: activeSession.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] }
      },
      include: { tableSession: { include: { table: true } } }
    });

    await prisma.callRequest.updateMany({
      where: {
        tableSessionId: activeSession.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] }
      },
      data: { status: 'RESOLVED', resolvedAt: now }
    });

    // 3. Broadcast de resolución de llamados vía SSE
    for (const call of pendingCalls) {
      eventBus.broadcastCall({
        id: call.id,
        restaurantId: call.tableSession.table.restaurantId,
        tableId: call.tableSession.table.id,
        tableLabel: call.tableSession.table.label,
        sector: call.tableSession.table.sector as any,
        type: call.type as any,
        paymentMethod: call.paymentMethod as any,
        note: call.note,
        origin: call.origin as any,
        status: 'RESOLVED' as any,
        createdAt: call.createdAt.toISOString(),
        resolvedAt: now.toISOString()
      }, 'call.updated');
    }

    // 4. Transición FSM a TO_CLEAN usando fsmService con isOverride
    try {
      const { fsmService } = await import('./fsm.service');
      await fsmService.attemptTransition({
        tableId,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'STAFF_CLOSE_SESSION',
        isOverride: true
      });
    } catch (err) {
      console.warn('FSM transition to TO_CLEAN non-blocking warning on closeSession:', err);
    }

    return {
      success: true,
      message: 'Sesión de mesa finalizada y mesa lista para limpieza (TO_CLEAN).'
    };
  }

  static async createNewSessionForTable(tableId: string): Promise<string> {
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

          const shift = await tx.shift.findFirst({
            where: { restaurantId: table.restaurantId, closedAt: null }
          });
          if (!shift) {
            const error: any = new Error('No hay un turno de servicio abierto para este restaurante.');
            error.statusCode = 400;
            throw error;
          }

          await tx.tableSession.updateMany({
            where: { tableId, closedAt: null },
            data: { closedAt: now, activeKey: null }
          });

          return tx.tableSession.create({
            data: { tableId, shiftId: shift.id, activeKey: tableId, token, expiresAt, createdAt: now }
          });
        });
        return session.token;
      } catch (err: any) {
        if (err?.code !== 'P2002' || attempt === 1) throw err;
      }
    }
    throw new Error('No se pudo confirmar la rotación de sesión');
  }
}
