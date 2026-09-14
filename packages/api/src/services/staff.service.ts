import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { StaffLoginDTO, StaffUserDTO, Sector, isValidPinFormat } from '@mesaya/shared';

export class StaffService {
  /**
   * Calcula una huella determinística indexable para garantizar unicidad
   * de PIN por restaurante a nivel motor de base de datos bajo concurrencia.
   */
  static calculatePinFingerprint(restaurantId: string, pin: string): string {
    const pepper = process.env.ENCRYPTION_SECRET_KEY || 'mesaya-pin-salt';
    return crypto.createHmac('sha256', pepper).update(`${restaurantId}:${pin}`).digest('hex');
  }

  static async login(dto: StaffLoginDTO): Promise<{ staffUser: StaffUserDTO; rawUser: any }> {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: dto.restaurantSlug }
    });

    if (!restaurant) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      throw error;
    }

    const pinFingerprint = StaffService.calculatePinFingerprint(restaurant.id, dto.pin);

    // Búsqueda directa O(1) indexada por huella determinística
    let matchedUser = await prisma.staffUser.findFirst({
      where: { restaurantId: restaurant.id, pinFingerprint }
    });

    // Fallback compatible para filas legadas sin pinFingerprint
    if (!matchedUser) {
      const legacyUsers = await prisma.staffUser.findMany({
        where: { restaurantId: restaurant.id, pinFingerprint: null }
      });
      for (const user of legacyUsers) {
        const isMatch = await bcrypt.compare(dto.pin, user.pinHash);
        if (isMatch) {
          matchedUser = user;
          // Backfill asíncrono seguro
          await prisma.staffUser.update({
            where: { id: user.id },
            data: { pinFingerprint }
          }).catch(() => undefined);
          break;
        }
      }
    } else {
      // Verificación de doble factor bcrypt para defensa en profundidad
      const isMatch = await bcrypt.compare(dto.pin, matchedUser.pinHash);
      if (!isMatch) {
        matchedUser = null;
      }
    }

    if (!matchedUser) {
      const error: any = new Error('PIN incorrecto o usuario no encontrado');
      error.statusCode = 401;
      throw error;
    }

    const staffUser: StaffUserDTO = {
      id: matchedUser.id,
      name: matchedUser.name,
      role: matchedUser.role,
      assignedSector: matchedUser.assignedSector as Sector | null,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name
    };

    return { staffUser, rawUser: matchedUser };
  }

  static async listStaff(restaurantId: string) {
    return prisma.staffUser.findMany({
      where: { restaurantId },
      select: {
        id: true,
        name: true,
        role: true,
        assignedSector: true,
        createdAt: true
      }
    });
  }

  static async createStaff(restaurantId: string, name: string, pin: string, role: string = 'WAITER', assignedSector?: string) {
    const cleanName = name?.trim();
    const cleanPin = pin?.trim();
    if (!cleanName || cleanName.length > 120) {
      const error: any = new Error('Nombre de personal inválido');
      error.statusCode = 400;
      throw error;
    }
    if (!isValidPinFormat(cleanPin)) {
      const error: any = new Error('El PIN debe contener entre 4 y 6 dígitos numéricos');
      error.statusCode = 400;
      error.code = 'PIN_INVALID';
      throw error;
    }
    if (!['WAITER', 'MANAGER'].includes(role)) {
      const error: any = new Error('Rol de personal inválido');
      error.statusCode = 400;
      throw error;
    }

    const pinFingerprint = StaffService.calculatePinFingerprint(restaurantId, cleanPin);

    // Prevención en lectura para mensajes amigables
    const existingWithFingerprint = await prisma.staffUser.findFirst({
      where: { restaurantId, pinFingerprint },
      select: { name: true }
    });
    if (existingWithFingerprint) {
      const error: any = new Error(`El PIN elegido ya está asignado a otro colaborador (${existingWithFingerprint.name}) de este restaurante`);
      error.statusCode = 409;
      error.code = 'PIN_ALREADY_IN_USE';
      throw error;
    }

    // Comprobación de registros legados sin fingerprint
    const legacyStaff = await prisma.staffUser.findMany({
      where: { restaurantId, pinFingerprint: null },
      select: { id: true, name: true, pinHash: true }
    });
    for (const existing of legacyStaff) {
      const isDuplicate = await bcrypt.compare(cleanPin, existing.pinHash);
      if (isDuplicate) {
        const error: any = new Error(`El PIN elegido ya está asignado a otro colaborador (${existing.name}) de este restaurante`);
        error.statusCode = 409;
        error.code = 'PIN_ALREADY_IN_USE';
        throw error;
      }
    }

    const pinHash = await bcrypt.hash(cleanPin, 10);
    try {
      return await prisma.staffUser.create({
        data: {
          restaurantId,
          name: cleanName,
          pinHash,
          pinFingerprint,
          role,
          assignedSector: assignedSector || null
        },
        select: {
          id: true,
          name: true,
          role: true,
          assignedSector: true,
          createdAt: true
        }
      });
    } catch (dbErr: any) {
      // Si dos solicitudes concurrentes intentan crear el mismo PIN simultáneamente,
      // la restricción única @@unique([restaurantId, pinFingerprint]) dispara P2002.
      if (dbErr?.code === 'P2002' || /unique constraint/i.test(dbErr?.message || '')) {
        const error: any = new Error('El PIN elegido ya está asignado a otro colaborador de este restaurante');
        error.statusCode = 409;
        error.code = 'PIN_ALREADY_IN_USE';
        throw error;
      }
      throw dbErr;
    }
  }
}
