import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { StaffLoginDTO, StaffUserDTO, Sector } from '@mesaya/shared';

export class StaffService {
  static async login(dto: StaffLoginDTO): Promise<{ staffUser: StaffUserDTO; rawUser: any }> {
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
    const cleanPin = pin?.trim();
    if (!cleanName || cleanName.length > 120) {
      const error: any = new Error('Nombre de personal inválido');
      error.statusCode = 400;
      throw error;
    }
    if (!/^\d{4,6}$/.test(cleanPin || '')) {
      const error: any = new Error('El PIN debe tener entre 4 y 6 dígitos');
      error.statusCode = 400;
      throw error;
    }
    if (!['WAITER', 'MANAGER'].includes(role)) {
      const error: any = new Error('Rol de personal inválido');
      error.statusCode = 400;
      throw error;
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
