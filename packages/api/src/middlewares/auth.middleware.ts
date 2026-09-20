import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { getEnvironmentConfig } from '../lib/environment';

export interface StaffJwtPayload {
  sub: string;
  name?: string;
  role: string;
  restaurantId: string;
  assignedSector?: string | null;
  terminalId?: string;
  temp?: boolean;
  purpose?: string;
  tableId?: string;
  sessionId?: string;
  isTerminalOnly?: boolean;
}

type CurrentStaffIdentity = StaffJwtPayload & { name?: string };

declare module 'fastify' {
  interface FastifyRequest {
    staffUser?: StaffJwtPayload;
    managedRestaurantId?: string;
  }
}

/**
 * Middleware para validar que la petición proviene de un miembro del personal (Mozo / Encargado)
 * o de un Puesto/Terminal de Salón debidamente autenticado mediante token Bearer JWT.
 */
export async function verifyStaffToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await request.jwtVerify<StaffJwtPayload>();
    if (!decoded?.sub || !decoded.restaurantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token de personal inválido.' });
    }

    const environment = getEnvironmentConfig();

    // 1. Caso Puesto/Terminal de Salón de Hardware (isTerminalOnly o role === 'TERMINAL')
    if (decoded.isTerminalOnly || decoded.role === 'TERMINAL') {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: decoded.restaurantId },
        select: { id: true }
      });
      if (!restaurant || (environment.instanceMode === 'SINGLE_RESTAURANT' && restaurant.id !== environment.instanceRestaurantId)) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'La terminal no pertenece a un restaurante vigente.' });
      }

      // La credencial de hardware de puesto sólo permite lectura del estado operativo del salón.
      // Toda mutación de negocio exige un operador mozo/encargado autenticado con PIN.
      if (request.method !== 'GET') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          code: 'OPERATOR_PIN_REQUIRED',
          message: 'El puesto requiere un operador autenticado con PIN para realizar acciones.'
        });
      }

      request.staffUser = {
        sub: decoded.sub,
        name: decoded.name || 'Terminal Salón',
        role: 'TERMINAL',
        restaurantId: decoded.restaurantId,
        assignedSector: decoded.assignedSector || null,
        terminalId: decoded.terminalId || decoded.sub.replace('term:', ''),
        isTerminalOnly: true
      } as CurrentStaffIdentity;
      return;
    }

    // 2. Caso Operador Humano (Mozo, Encargado, etc.)
    // El JWT sólo identifica; rol y tenant vigentes se resuelven desde la DB.
    // Así un usuario eliminado, movido de restaurante o con rol cambiado deja
    // de poder actuar aunque conserve un token no vencido.
    const currentUser = await prisma.staffUser.findUnique({
      where: { id: decoded.sub },
      select: { id: true, name: true, role: true, restaurantId: true, assignedSector: true }
    });
    if (!currentUser || currentUser.restaurantId !== decoded.restaurantId ||
      (environment.instanceMode === 'SINGLE_RESTAURANT' && currentUser.restaurantId !== environment.instanceRestaurantId)) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'La identidad de personal ya no está vigente.' });
    }

    // 3. Control de alcance para token temporal restringido por mesa (S13)
    const requestTableId = (request.params as any)?.tableId || (request.body as any)?.tableId;
    if (decoded.temp && decoded.tableId && requestTableId && decoded.tableId !== requestTableId) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        code: 'TOKEN_SCOPE_MISMATCH',
        message: 'El token temporal no es válido para esta mesa.'
      });
    }

    request.staffUser = {
      sub: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      restaurantId: currentUser.restaurantId,
      assignedSector: currentUser.assignedSector,
      terminalId: decoded.terminalId,
      temp: Boolean(decoded.temp),
      purpose: decoded.purpose,
      tableId: decoded.tableId,
      sessionId: decoded.sessionId,
      isTerminalOnly: false
    } as CurrentStaffIdentity;
  } catch (err: any) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Token de personal inválido, expirado o ausente. Inicia sesión con tu PIN.'
    });
  }
}

/**
 * Middleware para verificar que el usuario sea Encargado / Manager.
 * Bloquea estrictamente tokens temporales de reautorización (S13).
 */
export async function verifyManagerRole(request: FastifyRequest, reply: FastifyReply) {
  await verifyStaffToken(request, reply);
  if (reply.sent) return;

  if (request.staffUser?.temp) {
    return reply.status(403).send({
      error: 'FORBIDDEN',
      code: 'TEMPORARY_TOKEN_NOT_ALLOWED',
      message: 'Los tokens temporales de reautorización no tienen acceso a funciones administrativas generales.'
    });
  }

  if (!request.staffUser || request.staffUser.role !== 'MANAGER') {
    return reply.status(403).send({
      error: 'FORBIDDEN',
      message: 'Esta acción requiere permisos de Encargado o Administrador.'
    });
  }
}

/**
 * Middleware para autorizar liquidación de cuentas presenciales (E12 - S12/S13).
 * Valida:
 * 1. Actor autenticado (staffToken). Terminal sin operador es bloqueado (403 OPERATOR_PIN_REQUIRED).
 * 2. Si el rol es MANAGER:
 *    - Si es token temporal de reautorización (temp === true):
 *      - Verifica propósito (purpose === 'CASH_COLLECT' o 'SETTLE').
 *      - S13: si el token tiene restricción de mesa/sesión (tableId o sessionId), valida contra la sesión de la ruta.
 * 3. Si el rol es WAITER:
 *    - Tokens temporales de reautorización no aplican a mozos (403).
 *    - Método debe ser efectivo (WAITER_CASH). Cualquier método digital o tarjeta requiere MANAGER (403 SETTLE_REQUIRES_MANAGER).
 *    - Valida que el restaurante tenga allowWaitersToCollectCash === true (403 SETTLE_REQUIRES_MANAGER si está apagado).
 * 4. Otros roles: 403 FORBIDDEN.
 */
export async function verifySettlementAuthorization(request: FastifyRequest, reply: FastifyReply) {
  await verifyStaffToken(request, reply);
  if (reply.sent) return;

  const staff = request.staffUser;
  if (!staff) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Token de personal requerido.'
    });
  }

  if (staff.isTerminalOnly) {
    return reply.status(403).send({
      error: 'FORBIDDEN',
      code: 'OPERATOR_PIN_REQUIRED',
      message: 'Cobrar requiere un operador autenticado con PIN.'
    });
  }

  const params = (request.params || {}) as { sessionId?: string };
  const sessionId = params.sessionId;
  const body = (request.body || {}) as any;
  const method = typeof body.method === 'string' ? body.method.toUpperCase() : '';
  const isCash = method === 'WAITER_CASH' || method === 'CASH';

  if (staff.role === 'MANAGER') {
    if (staff.temp) {
      if (staff.purpose && staff.purpose !== 'CASH_COLLECT' && staff.purpose !== 'SETTLE') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          code: 'TOKEN_PURPOSE_MISMATCH',
          message: 'El token temporal no está autorizado para cobro.'
        });
      }
      if (sessionId && (staff.tableId || staff.sessionId)) {
        const session = await prisma.tableSession.findUnique({
          where: { id: sessionId },
          select: { id: true, tableId: true, table: { select: { restaurantId: true } } }
        });
        if (session) {
          if (session.table.restaurantId !== staff.restaurantId) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              code: 'STAFF_TENANT_MISMATCH',
              message: 'No autorizado para cobrar otra cuenta/restaurante'
            });
          }
          if (staff.sessionId && staff.sessionId !== session.id) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              code: 'TOKEN_SCOPE_MISMATCH',
              message: 'El token temporal no es válido para esta sesión de mesa.'
            });
          }
          if (staff.tableId && staff.tableId !== session.tableId) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              code: 'TOKEN_SCOPE_MISMATCH',
              message: 'El token temporal no es válido para esta mesa.'
            });
          }
        }
      }
    }
    return;
  }

  if (staff.role === 'WAITER') {
    if (staff.temp) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        code: 'TEMPORARY_TOKEN_NOT_ALLOWED',
        message: 'Tokens temporales de reautorización no aplican a mozos.'
      });
    }

    if (!isCash) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        code: 'SETTLE_REQUIRES_MANAGER',
        message: 'Cobrar con medios no-efectivo requiere autorización de Encargado.'
      });
    }

    const config = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: staff.restaurantId },
      select: { allowWaitersToCollectCash: true }
    });

    if (!config?.allowWaitersToCollectCash) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        code: 'SETTLE_REQUIRES_MANAGER',
        message: 'El cobro en efectivo por mozos está deshabilitado en este local; requiere PIN de Encargado.'
      });
    }

    return;
  }

  return reply.status(403).send({
    error: 'FORBIDDEN',
    code: 'ROLE_NOT_AUTHORIZED',
    message: 'Esta acción requiere rol de Mozo autorizado o Encargado.'
  });
}

/**
 * Hook reusable para recursos tenant-scoped. No toma el tenant desde body ni
 * query: quien lo use debe extraerlo del parámetro/ruta ya resuelto. El 404
 * evita enumerar recursos pertenecientes a otro restaurante.
 */
export function requireRestaurantAccess(getRestaurantId: (request: FastifyRequest) => string | undefined) {
  return async function verifyRestaurantAccess(request: FastifyRequest, reply: FastifyReply) {
    await verifyStaffToken(request, reply);
    if (reply.sent) return;
    const restaurantId = getRestaurantId(request);
    const instanceRestaurantId = getEnvironmentConfig().instanceRestaurantId;
    if (!restaurantId || request.staffUser?.restaurantId !== restaurantId ||
      (instanceRestaurantId && restaurantId !== instanceRestaurantId)) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Recurso no encontrado.'
      });
    }
  };
}

/** Resolves an id/slug and confirms the manager owns that restaurant. */
export function requireManagedRestaurant(getIdentifier: (request: FastifyRequest) => string | undefined) {
  return async function verifyManagedRestaurant(request: FastifyRequest, reply: FastifyReply) {
    await verifyManagerRole(request, reply);
    if (reply.sent) return;
    const identifier = getIdentifier(request);
    const restaurant = identifier && await prisma.restaurant.findFirst({
      where: { OR: [{ id: identifier }, { slug: identifier }] },
      select: { id: true }
    });
    const instanceRestaurantId = getEnvironmentConfig().instanceRestaurantId;
    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId ||
      (instanceRestaurantId && restaurant.id !== instanceRestaurantId)) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado.' });
    }
    request.managedRestaurantId = restaurant.id;
  };
}
