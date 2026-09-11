import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { getEnvironmentConfig, STAFF_JWT_EXPIRES_IN } from '../lib/environment';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';

export async function authRoutes(fastify: FastifyInstance) {
  // 1. List all restaurants for admin selector / platform directory
  fastify.get('/restaurants', async (request, reply) => {
    try {
      const environment = getEnvironmentConfig();
      const restaurants = await prisma.restaurant.findMany({
        where: environment.instanceRestaurantId ? { id: environment.instanceRestaurantId } : undefined,
        select: {
          id: true,
          name: true,
          slug: true,
          templateId: true,
          themeColor: true,
          logoUrl: true,
          coverImageUrl: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });
      return reply.send(restaurants);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. SaaS Onboarding: Register a brand new restaurant
  fastify.post('/auth/register-restaurant', async (request, reply) => {
    try {
      if (!getEnvironmentConfig().publicOnboardingEnabled) {
        return reply.status(403).send({ error: 'PUBLIC_ONBOARDING_DISABLED', message: 'El alta pública de restaurantes no está habilitada en esta instalación.' });
      }
      const environment = getEnvironmentConfig();
      if (environment.instanceMode === 'SINGLE_RESTAURANT') {
        return reply.status(409).send({
          error: 'SINGLE_RESTAURANT_INSTANCE',
          message: 'Esta instalación está vinculada a un restaurante; la provisión se realiza mediante bootstrap administrativo.'
        });
      }
      const {
        name,
        slug,
        managerName = 'Administrador',
        pin = '1234',
        templateId = 'GOURMET_OBSIDIAN',
        themeColor = '#f59e0b',
        tablesCount = 5,
        coverImageUrl
      } = request.body as {
        name: string;
        slug: string;
        managerName?: string;
        pin: string;
        templateId?: string;
        themeColor?: string;
        tablesCount?: number;
        coverImageUrl?: string;
      };

      if (!name || !name.trim() || !slug || !slug.trim()) {
        return reply.status(400).send({ error: 'El nombre y el slug del restaurante son requeridos' });
      }

      const cleanSlug = slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-');

      // Check if slug already exists
      const existing = await prisma.restaurant.findUnique({
        where: { slug: cleanSlug }
      });

      if (existing) {
        return reply.status(400).send({ error: `El slug '${cleanSlug}' ya se encuentra en uso. Por favor elige otro.` });
      }

      const pinHash = await bcrypt.hash(pin.trim(), 10);
      const count = Math.max(1, Math.min(Number(tablesCount) || 5, 50));

      const result = await prisma.$transaction(async (tx) => {
        // 1. Create Restaurant
        const restaurant = await tx.restaurant.create({
          data: {
            name: name.trim(),
            slug: cleanSlug,
            templateId,
            themeColor,
            coverImageUrl: coverImageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80'
          }
        });

        // 2. Create Initial Manager
        const manager = await tx.staffUser.create({
          data: {
            restaurantId: restaurant.id,
            name: managerName.trim(),
            pinHash,
            role: 'MANAGER',
            assignedSector: 'SALON_PRINCIPAL'
          }
        });

        // 3. Open First Shift
        const shift = await tx.shift.create({
          data: {
            restaurantId: restaurant.id,
            openedAt: new Date()
          }
        });

        // 4. Create Tables
        for (let i = 1; i <= count; i++) {
          await tx.table.create({
            data: {
              restaurantId: restaurant.id,
              label: `Mesa ${i}`,
              sector: i <= 3 ? 'SALON_PRINCIPAL' : 'TERRAZA'
            }
          });
        }

        // 5. Create Initial Sample Menu Categories
        const cat1 = await tx.menuCategory.create({
          data: {
            restaurantId: restaurant.id,
            name: 'Especialidades de la Casa',
            icon: '⭐',
            orderIndex: 0
          }
        });

        await tx.menuItem.create({
          data: {
            categoryId: cat1.id,
            name: `Plato Estrella ${name.trim()}`,
            description: 'Elaborado artesanalmente en el momento con ingredientes frescos de primera calidad.',
            price: 12500,
            priceMinor: 1250000, // C3: dual-write
            imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
            isAvailable: true,
            isFeatured: true,
            tags: JSON.stringify(['CHEF_PICK', 'POPULAR']),
            orderIndex: 0
          }
        });

        const cat2 = await tx.menuCategory.create({
          data: {
            restaurantId: restaurant.id,
            name: 'Bebidas & Vinos',
            icon: '🍷',
            orderIndex: 1
          }
        });

        await tx.menuItem.create({
          data: {
            categoryId: cat2.id,
            name: 'Vino de Autor Reserva',
            description: 'Copa o botella seleccionada por el sommelier.',
            price: 6500,
            priceMinor: 650000, // C3: dual-write
            imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=800&q=80',
            isAvailable: true,
            isFeatured: false,
            tags: JSON.stringify([]),
            orderIndex: 0
          }
        });

        return { restaurant, manager, shift };
      });

      const token = fastify.jwt.sign({
        sub: result.manager.id,
        role: result.manager.role,
        restaurantId: result.restaurant.id,
        assignedSector: result.manager.assignedSector
      }, { expiresIn: STAFF_JWT_EXPIRES_IN });

      return reply.status(201).send({
        success: true,
        message: '¡Restaurante registrado con éxito en MesaYA!',
        token,
        restaurant: result.restaurant,
        manager: {
          id: result.manager.id,
          name: result.manager.name,
          role: result.manager.role,
          restaurantId: result.manager.restaurantId
        }
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 3. Manager/Admin Login
  fastify.post('/auth/login-admin', async (request, reply) => {
    try {
      const { restaurantSlug, pin } = request.body as { restaurantSlug: string; pin: string };

      if (!restaurantSlug || !pin) {
        return reply.status(400).send({ error: 'restaurantSlug y pin son requeridos' });
      }

      const rest = await prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantSlug }, { slug: restaurantSlug }] },
        include: { staffUsers: true }
      });

      if (!rest) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }
      const instanceRestaurantId = getEnvironmentConfig().instanceRestaurantId;
      if (instanceRestaurantId && rest.id !== instanceRestaurantId) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      // Fastify request.ip es la dirección observada por el servidor. No se
      // confía en X-Forwarded-For porque esta app no configura un proxy de
      // confianza.
      const loginDecision = await AbuseControlService.consume(
        `login:tenant:${rest.id}:ip:${request.ip || 'unknown'}`,
        AbusePolicies.LOGIN_BY_IP_TENANT
      );
      if (!loginDecision.allowed) {
        reply.header('Retry-After', String(loginDecision.retryAfterSeconds));
        return reply.status(429).send({
          error: 'Demasiados intentos de acceso. Por favor aguardá unos minutos.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Check PIN against managers or staff
      let authenticatedUser = null;
      for (const user of rest.staffUsers) {
        const isMatch = await bcrypt.compare(pin.trim(), user.pinHash);
        if (isMatch) {
          authenticatedUser = user;
          break;
        }
      }

      if (!authenticatedUser) {
        return reply.status(401).send({ error: 'PIN incorrecto para este restaurante' });
      }
      if (authenticatedUser.role !== 'MANAGER') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'El acceso administrativo requiere rol MANAGER.' });
      }

      const token = fastify.jwt.sign({
        sub: authenticatedUser.id,
        role: authenticatedUser.role,
        restaurantId: rest.id,
        assignedSector: authenticatedUser.assignedSector
      }, { expiresIn: STAFF_JWT_EXPIRES_IN });

      return reply.send({
        token,
        restaurant: {
          id: rest.id,
          name: rest.name,
          slug: rest.slug,
          templateId: rest.templateId,
          themeColor: rest.themeColor
        },
        staffUser: {
          id: authenticatedUser.id,
          name: authenticatedUser.name,
          role: authenticatedUser.role,
          restaurantId: rest.id,
          restaurantName: rest.name
        }
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
