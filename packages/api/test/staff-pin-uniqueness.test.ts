import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('garantiza unicidad de PIN bajo carreras concurrentes simultáneas (Promise.allSettled)', async () => {
    const results = await Promise.allSettled([
      StaffService.createStaff(restaurantId, 'Mozo Concurrente 1', '8888', 'WAITER'),
      StaffService.createStaff(restaurantId, 'Mozo Concurrente 2', '8888', 'WAITER')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason?.statusCode).toBe(409);
    expect(rejectionReason?.code).toBe('PIN_ALREADY_IN_USE');

    const inDb = await prisma.staffUser.count({
      where: {
        restaurantId,
        pinFingerprint: StaffService.calculatePinFingerprint(restaurantId, '8888')
      }
    });
    expect(inDb).toBe(1);
  });

  describe('E04 — Rotación de huella de PIN y legado (S24)', () => {
    const originalPepper = process.env.STAFF_PIN_PEPPER;
    const originalPrevPepper = process.env.STAFF_PIN_PEPPER_PREVIOUS;

    afterEach(() => {
      if (originalPepper !== undefined) {
        process.env.STAFF_PIN_PEPPER = originalPepper;
      } else {
        delete process.env.STAFF_PIN_PEPPER;
      }
      if (originalPrevPepper !== undefined) {
        process.env.STAFF_PIN_PEPPER_PREVIOUS = originalPrevPepper;
      } else {
        delete process.env.STAFF_PIN_PEPPER_PREVIOUS;
      }
    });

    it('soporta login exitoso y rollover automatico de huella cuando se rota la clave con clave anterior configurada', async () => {
      // 1. Configurar pepper inicial (v1) y crear colaborador
      process.env.STAFF_PIN_PEPPER = 'pepper-version-1';
      delete process.env.STAFF_PIN_PEPPER_PREVIOUS;

      const user = await StaffService.createStaff(restaurantId, 'Mozo Rotacion', '5555', 'WAITER');
      const initialFingerprint = StaffService.calculatePinFingerprint(restaurantId, '5555', 'pepper-version-1');

      const inDbBefore = await prisma.staffUser.findUnique({ where: { id: user.id } });
      expect(inDbBefore?.pinFingerprint).toBe(initialFingerprint);

      // 2. Rotar claves: nueva = v2, previa = v1
      process.env.STAFF_PIN_PEPPER = 'pepper-version-2';
      process.env.STAFF_PIN_PEPPER_PREVIOUS = 'pepper-version-1';

      const expectedNewFingerprint = StaffService.calculatePinFingerprint(restaurantId, '5555', 'pepper-version-2');

      // 3. Mozo hace login con su PIN '5555'
      const loginResult = await StaffService.login({
        restaurantSlug: 'restaurant-test-pin',
        pin: '5555'
      });

      expect(loginResult.staffUser.id).toBe(user.id);
      expect(loginResult.staffUser.name).toBe('Mozo Rotacion');

      // 4. Verificar que se produjo el rollover automático en DB a la nueva huella
      const inDbAfter = await prisma.staffUser.findUnique({ where: { id: user.id } });
      expect(inDbAfter?.pinFingerprint).toBe(expectedNewFingerprint);
    });

    it('impide crear colaboradores con un PIN que colisiona con una huella previa pendiente de rollover', async () => {
      process.env.STAFF_PIN_PEPPER = 'pepper-v1';
      delete process.env.STAFF_PIN_PEPPER_PREVIOUS;

      await StaffService.createStaff(restaurantId, 'Mozo Antiguo', '9999', 'WAITER');

      // Rotar pepper
      process.env.STAFF_PIN_PEPPER = 'pepper-v2';
      process.env.STAFF_PIN_PEPPER_PREVIOUS = 'pepper-v1';

      // Intentar crear otro colaborador con el mismo PIN '9999' bajo el nuevo pepper
      await expect(
        StaffService.createStaff(restaurantId, 'Mozo Nuevo Duplicado', '9999', 'WAITER')
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PIN_ALREADY_IN_USE',
        message: expect.stringContaining('El PIN elegido ya está asignado a otro colaborador')
      });
    });

    it('soporta login y backfill seguro para filas legadas con pinFingerprint null', async () => {
      process.env.STAFF_PIN_PEPPER = 'pepper-modern';
      delete process.env.STAFF_PIN_PEPPER_PREVIOUS;

      // Insertar usuario legado directamente sin pinFingerprint
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('3333', 10);
      const legacyUser = await prisma.staffUser.create({
        data: {
          restaurantId,
          name: 'Mozo Legado',
          role: 'WAITER',
          pinHash: hash,
          pinFingerprint: null
        }
      });

      expect(legacyUser.pinFingerprint).toBeNull();

      // Login del usuario legado
      const loginResult = await StaffService.login({
        restaurantSlug: 'restaurant-test-pin',
        pin: '3333'
      });

      expect(loginResult.staffUser.id).toBe(legacyUser.id);

      // Verificar que se hizo backfill de la huella moderna
      const inDbAfter = await prisma.staffUser.findUnique({ where: { id: legacyUser.id } });
      const expectedFingerprint = StaffService.calculatePinFingerprint(restaurantId, '3333', 'pepper-modern');
      expect(inDbAfter?.pinFingerprint).toBe(expectedFingerprint);
    });
  });
});
