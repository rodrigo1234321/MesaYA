import { FastifyInstance } from 'fastify';
import { FeedbackService } from '../services/feedback.service';
import { FeedbackDTO } from '@mesaya/shared';
import { sendSanitizedError } from '../lib/errorHandler';

export async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.post('/feedback', async (request, reply) => {
    try {
      const body = request.body as FeedbackDTO;
      if (!body || typeof body !== 'object') {
        const error: any = new Error('Cuerpo de petición requerido');
        error.statusCode = 400;
        error.code = 'BAD_REQUEST';
        throw error;
      }

      if (!body.sessionToken || typeof body.sessionToken !== 'string') {
        const error: any = new Error('sessionToken y rating (1-5) son requeridos');
        error.statusCode = 400;
        error.code = 'SESSION_TOKEN_REQUIRED';
        throw error;
      }

      const result = await FeedbackService.submitFeedback(body);
      return reply.status(201).send(result);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });
}
