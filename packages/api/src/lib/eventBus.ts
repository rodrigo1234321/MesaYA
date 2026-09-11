import { FastifyReply } from 'fastify';
import { CallEventData } from '@mesaya/shared';

interface SSEClient {
  id: string;
  restaurantId: string;
  reply: FastifyReply;
}

class EventBus {
  private clients: Map<string, SSEClient> = new Map();

  /**
   * Deshabilitado en la release base: /stream no acepta suscripciones SSE abiertas.
   */
  addClient(_id: string, _restaurantId: string, _reply: FastifyReply) {
    // No-op: el transporte autoritativo de la release base es polling autenticado.
  }

  removeClient(id: string) {
    this.clients.delete(id);
  }

  broadcast(restaurantId: string, eventName: string, data: unknown) {
    if (this.clients.size === 0) return;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [_, client] of this.clients) {
      if (client.restaurantId === restaurantId) {
        try {
          client.reply.raw.write(payload);
        } catch {
          this.removeClient(client.id);
        }
      }
    }
  }

  broadcastCall(call: CallEventData, eventType: 'call.created' | 'call.updated' | 'call.cancelled') {
    this.broadcast(call.restaurantId, eventType, call);
  }

  broadcastTableState(event: import('@mesaya/shared').TableStateChangedEvent) {
    this.broadcast(event.restaurantId, 'table.state_changed', event);
  }

  broadcastOccupancyCompleted(event: import('@mesaya/shared').OccupancyCompletedEvent) {
    this.broadcast(event.restaurantId, 'occupancy.completed', event);
  }
}

export const eventBus = new EventBus();
