import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { CallService } from '../src/services/call.service';
import { CallStatus, CallType } from '@mesaya/shared';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MESAYA_INSTANCE_MODE;
  delete process.env.MESAYA_INSTANCE_RESTAURANT_ID;
});

describe('Etapa 07 — política de llamados y transiciones', () => {
  it('rechaza crear un llamado si la sesión no tiene turno operativo', async () => {
    vi.spyOn(prisma.tableSession, 'findUnique').mockResolvedValue({
      id: 'session-1',
      closedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      table: { restaurantId: 'restaurant-1', restaurant: { id: 'restaurant-1' }, calls: [] },
      shift: null,
      calls: []
    } as any);

    await expect(CallService.createCall({
      sessionToken: 'token-1',
      type: CallType.WAITER
    })).rejects.toMatchObject({ statusCode: 410, code: 'SHIFT_INACTIVE' });
  });

  it('rechaza volver de en camino a pendiente', async () => {
    const updateSpy = vi.spyOn(prisma.callRequest, 'update');
    vi.spyOn(prisma.callRequest, 'findUnique').mockResolvedValue({
      id: 'call-1',
      status: CallStatus.IN_PROGRESS,
      tableSession: {
        table: {
          id: 'table-1',
          label: 'Mesa 1',
          sector: 'SALON_PRINCIPAL',
          restaurant: { id: 'restaurant-1' }
        }
      }
    } as any);

    await expect(CallService.updateCallStatus('call-1', CallStatus.PENDING, 'restaurant-1', 'staff-1'))
      .rejects.toMatchObject({ statusCode: 409, code: 'CALL_INVALID_TRANSITION' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('oculta llamados de otro tenant en una instancia single-restaurante', async () => {
    process.env.MESAYA_INSTANCE_MODE = 'SINGLE_RESTAURANT';
    process.env.MESAYA_INSTANCE_RESTAURANT_ID = 'restaurant-root';
    vi.spyOn(prisma.tableSession, 'findUnique').mockResolvedValue({
      id: 'session-foreign',
      closedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      table: { restaurantId: 'restaurant-foreign', restaurant: { id: 'restaurant-foreign' } },
      shift: { restaurantId: 'restaurant-foreign', closedAt: null },
      calls: []
    } as any);

    await expect(CallService.createCall({
      sessionToken: 'token-foreign',
      type: CallType.WAITER
    })).rejects.toMatchObject({ statusCode: 404, code: 'SESSION_NOT_FOUND' });
  });
});
