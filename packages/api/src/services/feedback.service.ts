import { prisma } from '../lib/prisma';
import { FeedbackDTO } from '@mesaya/shared';
import { isRestaurantInConfiguredInstance } from '../lib/environment';

export class FeedbackService {
  /**
   * Registra la valoración privada de un comensal para su sesión de mesa.
   *
   * Requisitos de seguridad:
   * - La sesión de mesa debe existir, pertenecer a la instancia configurada y a un turno abierto.
   * - El módulo de reseñas debe estar habilitado (enableReviews !== false).
   * - No se puede enviar feedback sobre sesiones expiradas o cerradas (410).
   *   Cualquier sesión con closedAt !== null queda invalidada inmediatamente sin ventana de gracia.
   * - Validación estricta de rating (entero 1 a 5) y longitud máxima de comentario (1000 chars).
   * - Reintentos normales no duplican feedback ni devuelven éxito sobre sesión inexistente (409 / 404).
   * - Minimización de datos: retorna únicamente datos necesarios sin exponer credenciales o PII.
   */
  static async submitFeedback(dto: FeedbackDTO) {
    if (!dto || typeof dto !== 'object') {
      const error: any = new Error('Cuerpo de petición requerido');
      error.statusCode = 400;
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (!dto.sessionToken || typeof dto.sessionToken !== 'string') {
      const error: any = new Error('sessionToken requerido');
      error.statusCode = 400;
      error.code = 'SESSION_TOKEN_REQUIRED';
      throw error;
    }

    if (
      dto.rating === undefined ||
      dto.rating === null ||
      typeof dto.rating !== 'number' ||
      !Number.isInteger(dto.rating) ||
      dto.rating < 1 ||
      dto.rating > 5
    ) {
      const error: any = new Error('La calificación debe ser un número entero entre 1 y 5');
      error.statusCode = 400;
      error.code = 'INVALID_RATING';
      throw error;
    }

    if (dto.comment !== undefined && dto.comment !== null) {
      if (typeof dto.comment !== 'string') {
        const error: any = new Error('El comentario debe ser una cadena de texto');
        error.statusCode = 400;
        error.code = 'INVALID_COMMENT';
        throw error;
      }
      if (dto.comment.length > 1000) {
        const error: any = new Error('El comentario no puede superar los 1000 caracteres');
        error.statusCode = 400;
        error.code = 'COMMENT_TOO_LONG';
        throw error;
      }
    }

    const session = await prisma.tableSession.findUnique({
      where: { token: dto.sessionToken },
      include: {
        feedback: true,
        shift: true,
        table: {
          select: { restaurantId: true }
        }
      }
    });

    if (!session || !isRestaurantInConfiguredInstance(session.table.restaurantId)) {
      const error: any = new Error('Sesión no encontrada');
      error.statusCode = 404;
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    // Verificar si el módulo de reseñas está habilitado
    const moduleConfig = await prisma.restaurantModuleConfig.findUnique({
      where: { restaurantId: session.table.restaurantId },
      select: { enableReviews: true }
    });
    if (moduleConfig && moduleConfig.enableReviews === false) {
      const error: any = new Error('El módulo de reseñas y feedback no está habilitado para este restaurante.');
      error.statusCode = 403;
      error.code = 'REVIEWS_DISABLED';
      throw error;
    }

    // 1. Validar expiración temporal (TTL 4 horas)
    if (new Date() > new Date(session.expiresAt)) {
      const error: any = new Error('La sesión de esta mesa ha expirado. No se puede enviar feedback con un token vencido.');
      error.statusCode = 410;
      error.code = 'SESSION_EXPIRED';
      throw error;
    }

    // 2. Validar turno del restaurante
    if (session.shift && session.shift.closedAt) {
      const error: any = new Error('El turno del restaurante ha finalizado.');
      error.statusCode = 410;
      error.code = 'SHIFT_CLOSED';
      throw error;
    }

    // 3. Validar si la sesión fue cerrada (estricto: sin ventana de gracia ni excepciones)
    if (session.closedAt !== null) {
      const error: any = new Error('Esta sesión de mesa ya finalizó. No se puede enviar feedback con un token cerrado.');
      error.statusCode = 410;
      error.code = 'SESSION_CLOSED';
      throw error;
    }

    // 4. Protección contra duplicados en reintentos
    if (session.feedback) {
      const error: any = new Error('Ya se ha enviado una valoración para esta visita');
      error.statusCode = 409;
      error.code = 'FEEDBACK_ALREADY_EXISTS';
      throw error;
    }

    try {
      const created = await prisma.feedback.create({
        data: {
          tableSessionId: session.id,
          rating: dto.rating,
          comment: dto.comment ? dto.comment.trim() : null
        },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true
        }
      });

      return created;
    } catch (err: any) {
      // Dos pestañas pueden enviar la valoración al mismo tiempo; la unicidad
      // de tableSessionId es la autoridad y se traduce a un 409 accionable.
      if (err?.code === 'P2002') {
        const duplicate: any = new Error('Ya se ha enviado una valoración para esta visita');
        duplicate.statusCode = 409;
        duplicate.code = 'FEEDBACK_ALREADY_EXISTS';
        throw duplicate;
      }
      throw err;
    }
  }
}
