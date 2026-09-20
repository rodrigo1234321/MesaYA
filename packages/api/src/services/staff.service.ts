import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { StaffLoginDTO, StaffUserDTO, Sector, isValidPinFormat } from '@mesaya/shared';

export class StaffService {
  static getPinPeppers(): { current: string; previous?: string } {
    const current = process.env.STAFF_PIN_PEPPER || process.env.ENCRYPTION_SECRET_KEY || 'mesaya-pin-salt';
    const previous = process.env.STAFF_PIN_PEPPER_PREVIOUS || undefined;
    return { current, previous };
  }

  /**
   * Calcula una huella determinística indexable para garantizar unicidad
   * de PIN por restaurante a nivel motor de base de datos bajo concurrencia.
   */
  static calculatePinFingerprint(restaurantId: string, pin: string, customPepper?: string): string {
    const pepper = customPepper || StaffService.getPinPeppers().current;
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

    const currentFingerprint = StaffService.calculatePinFingerprint(restaurant.id, dto.pin);

    // 1. Búsqueda directa O(1) indexada por huella determinística actual
    let matchedUser = await prisma.staffUser.findFirst({
      where: { restaurantId: restaurant.id, pinFingerprint: currentFingerprint }
    });

    if (matchedUser) {
      // Verificación de doble factor bcrypt para defensa en profundidad
      const isMatch = await bcrypt.compare(dto.pin, matchedUser.pinHash);
      if (!isMatch) {
        matchedUser = null;
      }
    }

    // 2. Si no coincide y existe clave previa de rotación (STAFF_PIN_PEPPER_PREVIOUS), buscar con clave anterior
    const { previous } = StaffService.getPinPeppers();
    if (!matchedUser && previous) {
      const prevFingerprint = StaffService.calculatePinFingerprint(restaurant.id, dto.pin, previous);
      const prevUser = await prisma.staffUser.findFirst({
        where: { restaurantId: restaurant.id, pinFingerprint: prevFingerprint }
      });
      if (prevUser) {
        const isMatch = await bcrypt.compare(dto.pin, prevUser.pinHash);
        if (isMatch) {
          matchedUser = prevUser;
          // Rollover automático: actualiza la huella al pepper actual
          await prisma.staffUser.update({
            where: { id: prevUser.id },
            data: { pinFingerprint: currentFingerprint }
          }).catch(() => undefined);
        }
      }
    }

    // 3. Fallback acotado compatible para filas legadas sin pinFingerprint (máx 50 registros)
    if (!matchedUser) {
      const legacyUsers = await prisma.staffUser.findMany({
        where: { restaurantId: restaurant.id, pinFingerprint: null },
        take: 50
      });
      for (const user of legacyUsers) {
        const isMatch = await bcrypt.compare(dto.pin, user.pinHash);
        if (isMatch) {
          matchedUser = user;
          // Backfill asíncrono seguro con huella actual
          await prisma.staffUser.update({
            where: { id: user.id },
            data: { pinFingerprint: currentFingerprint }
          }).catch(() => undefined);
          break;
        }
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

    const { current, previous } = StaffService.getPinPeppers();
    const pinFingerprint = StaffService.calculatePinFingerprint(restaurantId, cleanPin, current);

    // Prevención en lectura para mensajes amigables con clave actual
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

    // Si hay rotación activa, comprobar también contra la huella previa
    if (previous) {
      const prevFingerprint = StaffService.calculatePinFingerprint(restaurantId, cleanPin, previous);
      const existingWithPrevFingerprint = await prisma.staffUser.findFirst({
        where: { restaurantId, pinFingerprint: prevFingerprint },
        select: { name: true }
      });
      if (existingWithPrevFingerprint) {
        const error: any = new Error(`El PIN elegido ya está asignado a otro colaborador (${existingWithPrevFingerprint.name}) de este restaurante`);
        error.statusCode = 409;
        error.code = 'PIN_ALREADY_IN_USE';
        throw error;
      }
    }

    // Comprobación acotada de registros legados sin fingerprint (máx 50)
    const legacyStaff = await prisma.staffUser.findMany({
      where: { restaurantId, pinFingerprint: null },
      select: { id: true, name: true, pinHash: true },
      take: 50
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
