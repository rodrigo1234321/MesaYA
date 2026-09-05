import { FastifyInstance } from 'fastify';
import { FeedbackService } from '../services/feedback.service';
import { FeedbackDTO } from '@mesaya/shared';

export async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.post('/feedback', async (request, reply) => {
    try {
      const body = request.body as FeedbackDTO;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Cuerpo de petición requerido' });
      }

      if (!body.sessionToken || typeof body.sessionToken !== 'string') {
        return reply.status(400).send({ error: 'sessionToken y rating (1-5) son requeridos' });
      }

      const result = await FeedbackService.submitFeedback(body);
      return reply.status(201).send(result);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message, code: err.code });
    }
  });
}
