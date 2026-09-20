import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';
import { StaffService } from '../src/services/staff.service';

describe('E05 — Login fluido y límite de abuso correcto (H04 / S08)', () => {
  let app: FastifyInstance;
  const restaurantSlug = `rest-e05-${Date.now()}`;
  let restaurantId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E05 Test',
        slug: restaurantSlug,
        themeColor: '#000000',
        templateId: 'MODERN_DARK'
      }
    });
    restaurantId = restaurant.id;

    // Crear mozo legítimo con PIN 1234
    await StaffService.createStaff(restaurantId, 'Mozo Legítimo', '1234', 'WAITER');
    // Crear otro mozo legítimo con PIN 5678
    await StaffService.createStaff(restaurantId, 'Mozo Compañero', '5678', 'WAITER');
  });

  beforeEach(async () => {
    // Limpiar buckets de rate limit entre tests para aislamiento
    await prisma.rateLimitBucket.deleteMany({
      where: { key: { contains: restaurantId } }
    }).catch(() => undefined);
  });

  afterAll(async () => {
    if (restaurantId) {
      await prisma.staffUser.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: restaurantId } } }).catch(() => undefined);
      await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('permite accesos exitosos frecuentes (> 5) sin bloquear la tablet compartida (H04 resuelto)', async () => {
    const terminalId = 'terminal-tablet-salon-1';

    // 10 logins exitosos seguidos simulando el uso intenso de un puesto compartido
    for (let i = 0; i < 10; i++) {
      const pin = i % 2 === 0 ? '1234' : '5678';
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug,
          pin,
          terminalId
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.token).toBeDefined();
      expect(data.staffUser).toBeDefined();
    }
  });

  it('bloquea con 429 tras 5 intentos fallidos y no congela otros terminales del salón (S08)', async () => {
    const maliciousTerminal = 'terminal-tablet-hacker-1';
    const legitimateTerminal = 'terminal-tablet-camarero-2';

    // 5 intentos fallidos desde el terminal atacante
    for (let i = 0; i < 5; i++) {
      const failRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug,
          pin: '0000', // PIN erróneo
          terminalId: maliciousTerminal
        }
      });
      // Primeros 5 fallos son 401 Unauthorized
      expect(failRes.statusCode).toBe(401);
    }

    // El 6º intento desde el terminal atacante debe ser bloqueado con 429
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '1234', // Incluso si ahora pone el PIN correcto
        terminalId: maliciousTerminal
      }
    });

    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.json()).toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      error: expect.stringContaining('Demasiados intentos de acceso desde este terminal')
    });

    // Sin embargo, el terminal legítimo en el mismo salón y red puede operar normalmente (200 OK)
    const legitimateRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '1234',
        terminalId: legitimateTerminal
      }
    });

    expect(legitimateRes.statusCode).toBe(200);
    expect(legitimateRes.json().token).toBeDefined();
  });

  it('limita ataques que rotan terminalId maliciosamente tras acumular fallos agregados en la IP', async () => {
    // Simular atacante que cambia de terminalId en cada intento fallido
    for (let i = 0; i < 25; i++) {
      const fakeTerm = `terminal-rotator-${i}`;
      const failRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug,
          pin: '9999', // Incorrecto
          terminalId: fakeTerm
        }
      });
      expect([401, 429]).toContain(failRes.statusCode);
    }

    // El intento posterior con otro terminalId inventado debe recibir 429 por límite agregado de IP
    const blockedRotator = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: {
        restaurantSlug,
        pin: '1234',
        terminalId: 'terminal-rotator-new'
      }
    });

    expect(blockedRotator.statusCode).toBe(429);
    expect(blockedRotator.headers['retry-after']).toBeDefined();
    expect(blockedRotator.json().code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
