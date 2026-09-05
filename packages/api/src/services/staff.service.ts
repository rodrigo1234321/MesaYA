import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { assertValidPin, duplicatePinError } from '../lib/pin-policy';
import { StaffLoginDTO, StaffUserDTO, Sector } from '@mesaya/shared';

export class StaffService {
  static async login(dto: StaffLoginDTO): Promise<{ staffUser: StaffUserDTO; rawUser: any }> {
    // Validación de formato antes de cualquier lectura costosa/comparación.
    assertValidPin(dto.pin);
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: dto.restaurantSlug }
    });

    if (!restaurant) {
      const error: any = new Error('Restaurante no encontrado');
      error.statusCode = 404;
      throw error;
    }

    const staffUsers = await prisma.staffUser.findMany({
      where: { restaurantId: restaurant.id }
    });

    let matchedUser = null;
    for (const user of staffUsers) {
      const isMatch = await bcrypt.compare(dto.pin, user.pinHash);
      if (isMatch) {
        matchedUser = user;
        break;
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
    if (!cleanName || cleanName.length > 120) {
      const error: any = new Error('Nombre de personal inválido');
      error.statusCode = 400;
      throw error;
    }
    // Sin trim/normalización: el PIN validado es el PIN hasheado.
    assertValidPin(pin);
    const cleanPin = pin;
    if (!['WAITER', 'MANAGER'].includes(role)) {
      const error: any = new Error('Rol de personal inválido');
      error.statusCode = 400;
      throw error;
    }
    // Unicidad de PIN por restaurante (comparación bcrypt porque el hash
    // con sal no admite constraint único). Secuencial y transaccional;
    // la carrera concurrente exacta queda pendiente de digest único (etapa 03).
    const existing = await prisma.staffUser.findMany({
      where: { restaurantId },
      select: { pinHash: true }
    });
    for (const user of existing) {
      if (await bcrypt.compare(cleanPin, user.pinHash)) {
        throw duplicatePinError();
      }
    }
    const pinHash = await bcrypt.hash(cleanPin, 10);
    return prisma.staffUser.create({
      data: {
        restaurantId,
        name: cleanName,
        pinHash,
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
  }
}
