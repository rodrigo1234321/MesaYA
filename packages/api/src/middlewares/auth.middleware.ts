import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';

export interface StaffJwtPayload {
  sub: string;
  role: string;
  restaurantId: string;
  assignedSector?: string | null;
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
 * mediante token Bearer JWT firmado con @fastify/jwt
 */
export async function verifyStaffToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await request.jwtVerify<StaffJwtPayload>();
    if (!decoded?.sub || !decoded.restaurantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token de personal inválido.' });
    }

    // El JWT sólo identifica; rol y tenant vigentes se resuelven desde la DB.
    // Así un usuario eliminado, movido de restaurante o con rol cambiado deja
    // de poder actuar aunque conserve un token no vencido.
    const currentUser = await prisma.staffUser.findUnique({
      where: { id: decoded.sub },
      select: { id: true, name: true, role: true, restaurantId: true, assignedSector: true }
    });
    if (!currentUser || currentUser.restaurantId !== decoded.restaurantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'La identidad de personal ya no está vigente.' });
    }

    request.staffUser = {
      sub: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      restaurantId: currentUser.restaurantId,
      assignedSector: currentUser.assignedSector
    } as CurrentStaffIdentity;
  } catch (err: any) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Token de personal inválido, expirado o ausente. Inicia sesión con tu PIN.'
    });
  }
}

/**
 * Middleware para verificar que el usuario sea Encargado / Manager
 */
export async function verifyManagerRole(request: FastifyRequest, reply: FastifyReply) {
  await verifyStaffToken(request, reply);
  if (reply.sent) return;
  if (!request.staffUser || request.staffUser.role !== 'MANAGER') {
    return reply.status(403).send({
      error: 'FORBIDDEN',
      message: 'Esta acción requiere permisos de Encargado o Administrador.'
    });
  }
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
    if (!restaurantId || request.staffUser?.restaurantId !== restaurantId) {
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
    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado.' });
    }
    request.managedRestaurantId = restaurant.id;
  };
}
