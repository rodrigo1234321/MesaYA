import { CallEventData, CallStatus, StaffLoginDTO, StaffUserDTO } from '@mesaya/shared';

export const API_BASE = (
  (import.meta.env.VITE_API_URL as string) ||
  (typeof window !== 'undefined'
    ? (() => {
        const host = window.location.hostname || 'localhost';
        if (host.endsWith('.vercel.app')) return 'https://mesa-ya-api.vercel.app/v1';
        const protocol = window.location.protocol && window.location.protocol.startsWith('http') ? window.location.protocol : 'http:';
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
        return isLocal ? `${protocol}//${host}:3000/v1` : `${protocol}//${host}/v1`;
      })()
    : 'http://localhost:3000/v1')
).replace(/\/$/, '');

export class StaffApi {
  static getAuthToken(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('mesaya_staff_token');
    }
    return null;
  }

  static getAuthHeaders(): Record<string, string> {
    const token = this.getAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  static getSavedUser(): StaffUserDTO | null {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('mesaya_staff_user');
      return raw ? JSON.parse(raw) : null;
    }
    return null;
  }

  static async login(dto: StaffLoginDTO): Promise<{ token: string; staffUser: StaffUserDTO }> {
    const res = await fetch(`${API_BASE}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error de autenticación' }));
      throw new Error(err.error || 'PIN o restaurante incorrecto');
    }

    const data = await res.json();
    localStorage.setItem('mesaya_staff_token', data.token);
    localStorage.setItem('mesaya_staff_user', JSON.stringify(data.staffUser));
    return data;
  }

  static logout() {
    localStorage.removeItem('mesaya_staff_token');
    localStorage.removeItem('mesaya_staff_user');
  }

  static async getActiveCalls(restaurantId: string, signal?: AbortSignal): Promise<CallEventData[]> {
    const res = await fetch(`${API_BASE}/calls?restaurantId=${restaurantId}`, {
      headers: this.getAuthHeaders(),
      signal
    });
    if (res.status === 401) {
      const error: any = new Error('Sesión de staff expirada');
      error.statusCode = 401;
      error.code = 'STAFF_UNAUTHORIZED';
      throw error;
    }
    if (!res.ok) throw new Error('Error al cargar llamados');
    return res.json();
  }

  static async updateCallStatus(callId: string, status: CallStatus): Promise<CallEventData> {
    const res = await fetch(`${API_BASE}/calls/${callId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ status })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al actualizar estado' }));
      throw new Error(err.message || err.error || 'Error al actualizar estado');
    }
    return res.json();
  }

  static async closeTableSession(tableId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/tables/${tableId}/close-session`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al cerrar sesión de mesa' }));
      throw new Error(err.message || err.error || 'Error al cerrar sesión de mesa');
    }
    return res.json();
  }

  // --- FILA VIRTUAL (WAITLIST) & COMANDAS ---
  static async getWaitlist(restaurantId: string) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/waitlist`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar fila de espera');
    return res.json();
  }

  static async callWaitlistGuest(id: string) {
    const res = await fetch(`${API_BASE}/staff/waitlist/${id}/call`, {
      method: 'PATCH',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al llamar comensal');
    return res.json();
  }

  static async seatWaitlistGuest(id: string, tableId: string) {
    const res = await fetch(`${API_BASE}/staff/waitlist/${id}/seat`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ tableId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al sentar comensal');
    }
    return res.json();
  }

  static async validateOrder(orderId: string) {
    const res = await fetch(`${API_BASE}/staff/orders/${orderId}/validate`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al validar comanda');
    return res.json();
  }

  // --- RTMS SALÓN TABLET ---
  static async getFloorPlan(restaurantIdOrSlug: string): Promise<import('@mesaya/shared').FloorPlanResponseDTO> {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar plano de salón');
    return res.json();
  }

  static async tapTableState(
    tableId: string,
    request: import('@mesaya/shared').TapStateRequest
  ): Promise<import('@mesaya/shared').TapStateResponse> {
    const res = await fetch(`${API_BASE}/tables/${tableId}/state/tap`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(request)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Error al actualizar mesa');
    }
    return res.json();
  }

  // --- KITCHEN ORDERS / COMANDAS ---
  static async getKitchenOrders(restaurantId: string) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/kitchen-orders`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar comandas de cocina');
    return res.json();
  }

  static async addItemByStaff(tableId: string, menuItemId: string, quantity: number, notes?: string) {
    const res = await fetch(`${API_BASE}/staff/tables/${tableId}/orders/items`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ menuItemId, quantity, notes })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al cargar comanda');
    }
    return res.json();
  }

  static async updateOrderStatus(orderId: string, status: string, cancellationReason?: string) {
    const res = await fetch(`${API_BASE}/staff/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ status, ...(cancellationReason ? { cancellationReason } : {}) })
    });
    if (!res.ok) throw new Error('Error al actualizar estado');
    return res.json();
  }

  static async payOrder(orderId: string, paymentMethod?: string, tipAmount?: number) {
    const res = await fetch(`${API_BASE}/staff/orders/${orderId}/pay`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ paymentMethod, tipAmount })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al confirmar cobro');
    }
    return res.json();
  }

  static async getMenu(restaurantSlugOrId: string) {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantSlugOrId}/menu`);
    if (!res.ok) throw new Error('Error al cargar carta');
    return res.json();
  }

  static async getTables(restaurantId: string) {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/tables`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar mesas');
    return res.json();
  }

  static async updateMenuItemAvailability(restaurantId: string, itemId: string, isAvailable: boolean) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/menu/items/${itemId}/availability`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ isAvailable })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al actualizar disponibilidad del plato');
    }
    return res.json();
  }

  // --- CUENTAS Y COBROS PRESENCIALES (Etapa 08) ---
  static async getTableBill(tableId: string): Promise<import('@mesaya/shared').TableBillDTO> {
    const res = await fetch(`${API_BASE}/staff/tables/${tableId}/bill`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al obtener cuenta de la mesa');
    }
    return res.json();
  }

  static async settlePayment(dto: {
    tableId: string;
    amountCents: number;
    paymentMethod: string;
    tipCents?: number;
    idempotencyKey?: string;
    participantId?: string;
  }) {
    const res = await fetch(`${API_BASE}/staff/payments/settle`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(dto)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al registrar cobro');
    }
    return res.json();
  }

  static async revertPayment(paymentId: string, reason?: string) {
    const res = await fetch(`${API_BASE}/staff/payments/${paymentId}/revert`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al revertir cobro');
    }
    return res.json();
  }
}

