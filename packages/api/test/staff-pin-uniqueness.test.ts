import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { StaffService } from '../src/services/staff.service';

describe('Staff PIN Uniqueness and Validation (P0-04)', () => {
  const restaurantId = 'rest-pin-test';

  beforeEach(async () => {
    await prisma.staffUser.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.upsert({
      where: { id: restaurantId },
      update: { name: 'Restaurant Test PIN', slug: 'restaurant-test-pin' },
      create: {
        id: restaurantId,
        name: 'Restaurant Test PIN',
        slug: 'restaurant-test-pin'
      }
    });
  });

  it('permite crear colaboradores con PIN valido de 4, 5 y 6 digitos', async () => {
    const s1 = await StaffService.createStaff(restaurantId, 'Mozo Cuatro', '1234', 'WAITER');
    expect(s1.id).toBeDefined();
    expect(s1.name).toBe('Mozo Cuatro');

    const s2 = await StaffService.createStaff(restaurantId, 'Mozo Cinco', '12345', 'WAITER');
    expect(s2.id).toBeDefined();
    expect(s2.name).toBe('Mozo Cinco');

    const s3 = await StaffService.createStaff(restaurantId, 'Mozo Seis', '123456', 'MANAGER');
    expect(s3.id).toBeDefined();
    expect(s3.name).toBe('Mozo Seis');
  });

  it('rechaza PINs con menos de 4 o mas de 6 digitos o caracteres no numericos', async () => {
    await expect(StaffService.createStaff(restaurantId, 'Invalido Corto', '123', 'WAITER'))
      .rejects.toThrow(/PIN debe contener entre 4 y 6/);

    await expect(StaffService.createStaff(restaurantId, 'Invalido Largo', '1234567', 'WAITER'))
      .rejects.toThrow(/PIN debe contener entre 4 y 6/);

    await expect(StaffService.createStaff(restaurantId, 'Invalido Letras', '12ab', 'WAITER'))
      .rejects.toThrow(/PIN debe contener entre 4 y 6/);
  });

  it('rechaza la creacion de un colaborador con un PIN duplicado en el mismo restaurante (409 PIN_ALREADY_IN_USE)', async () => {
    await StaffService.createStaff(restaurantId, 'Mozo Principal', '4444', 'WAITER');

    await expect(
      StaffService.createStaff(restaurantId, 'Mozo Duplicado', '4444', 'WAITER')
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PIN_ALREADY_IN_USE',
      message: expect.stringContaining('El PIN elegido ya está asignado a otro colaborador')
    });
  });

  it('permite el mismo PIN en restaurantes distintos (aislamiento multitenant)', async () => {
    const otherRestaurantId = 'rest-pin-test-2';
    await prisma.restaurant.upsert({
      where: { id: otherRestaurantId },
      update: { name: 'Restaurant Test PIN 2', slug: 'restaurant-test-pin-2' },
      create: {
        id: otherRestaurantId,
        name: 'Restaurant Test PIN 2',
        slug: 'restaurant-test-pin-2'
      }
    });

    await StaffService.createStaff(restaurantId, 'Mozo Rest 1', '7777', 'WAITER');
    const sOther = await StaffService.createStaff(otherRestaurantId, 'Mozo Rest 2', '7777', 'WAITER');

    expect(sOther.id).toBeDefined();
    expect(sOther.name).toBe('Mozo Rest 2');
  });
});
