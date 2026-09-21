import {
  CallEventData,
  CallStatus,
  StaffLoginDTO,
  StaffUserDTO,
  ServiceTaskClaimDTO,
  ServiceTaskKind,
  ServiceWorkspaceDTO,
  RestaurantMenuResponse,
  TableFSMState,
  Sector
} from '@mesaya/shared';

export interface StaffTableItemDTO {
  id: string;
  label: string;
  sector: Sector | string;
  isOutdoor?: boolean;
  capacity?: number;
  currentState?: TableFSMState;
  activeToken?: string | null;
  expiresAt?: string | null;
}

export const API_BASE = (
  (import.meta.env.VITE_API_URL as string) ||
  (typeof window !== 'undefined'
    ? (() => {
        const protocol = window.location.protocol && window.location.protocol.startsWith('http') ? window.location.protocol : 'http:';
        const host = window.location.hostname || 'localhost';
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
        return isLocal ? `${protocol}//${host}:3000/v1` : `${protocol}//${host}/v1`;
      })()
    : 'http://localhost:3000/v1')
).replace(/\/$/, '');

export class StaffApi {
  static getTerminalId(): string {
    const storageKey = 'mesaya_staff_terminal_id';
    if (typeof localStorage === 'undefined') return 'terminal-server';
    const saved = localStorage.getItem(storageKey);
    if (saved && /^[a-zA-Z0-9_-]{8,100}$/.test(saved)) return saved;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, random);
    return random;
  }

  static getSavedRestaurant(): { id: string; name: string; slug: string } | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('mesaya_staff_restaurant');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem('mesaya_staff_restaurant');
      return null;
    }
  }

  static saveRestaurant(rest: { id: string; name: string; slug: string }): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('mesaya_staff_restaurant', JSON.stringify(rest));
    }
  }

  static getAuthToken(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('mesaya_staff_token');
    }
    return null;
  }

  static getAuthHeaders(options?: { isJson?: boolean; token?: string | null }): Record<string, string> {
    const token = options?.token ?? this.getAuthToken();
    const headers: Record<string, string> = {};
    if (options?.isJson !== false) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  static getSavedUser(): StaffUserDTO | null {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('mesaya_staff_user');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && typeof parsed.restaurantId === 'string' ? parsed : null;
      } catch {
        localStorage.removeItem('mesaya_staff_user');
        localStorage.removeItem('mesaya_staff_token');
        return null;
      }
    }
    return null;
  }

  static async login(dto: StaffLoginDTO & { terminalId?: string }): Promise<{ token: string; staffUser: StaffUserDTO }> {
    const requestDto = { ...dto, terminalId: dto.terminalId || this.getTerminalId() };
    const res = await fetch(`${API_BASE}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestDto)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error de autenticación' }));
      throw new Error(err.error || 'PIN o restaurante incorrecto');
    }

    const data = await res.json();
    localStorage.setItem('mesaya_staff_token', data.token);
    localStorage.setItem('mesaya_staff_user', JSON.stringify(data.staffUser));
    if (data.staffUser?.restaurantId) {
      this.saveRestaurant({
        id: data.staffUser.restaurantId,
        name: data.staffUser.restaurantName || data.staffUser.restaurantId,
        slug: dto.restaurantSlug
      });
    }
    return data;
  }

  /**
   * Reautorización puntual: autentica a un encargado sin reemplazar la
   * identidad persistida del operador que sigue trabajando en Servicio.
   * Emite un token acotado a 300 segundos (5 minutos) con claim temp: true.
   */
  static async loginTemporary(dto: StaffLoginDTO & { terminalId?: string }): Promise<{ token: string; staffUser: StaffUserDTO; isTemporary?: boolean; expiresInSeconds?: number }> {
    const requestDto = { ...dto, terminalId: dto.terminalId || this.getTerminalId(), isTemporary: true };
    const res = await fetch(`${API_BASE}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestDto)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'PIN de encargado inválido');
    return data;
  }

  /** Bloquea el operador personal pero conserva el puesto/terminal y el restaurante en pantalla */
  static lockOperator() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('mesaya_staff_token');
      localStorage.removeItem('mesaya_staff_user');
    }
  }

  static logout() {
    this.lockOperator();
  }

  /** Desvincula el terminal de hardware por completo */
  static logoutAll() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('mesaya_staff_token');
      localStorage.removeItem('mesaya_staff_user');
      localStorage.removeItem('mesaya_staff_restaurant');
    }
  }

  static async getActiveCalls(restaurantId: string, signal?: AbortSignal): Promise<CallEventData[]> {
    const res = await fetch(`${API_BASE}/calls?restaurantId=${restaurantId}`, {
      headers: this.getAuthHeaders({ isJson: false }),
      signal
    });
    if (res.status === 401) {
      this.logout();
      const error: any = new Error('Sesión de staff expirada');
      error.statusCode = 401;
      error.code = 'STAFF_UNAUTHORIZED';
      throw error;
    }
    if (!res.ok) throw new Error('Error al cargar llamados');
    return res.json();
  }

  static async getServiceWorkspace(restaurantId: string, signal?: AbortSignal): Promise<ServiceWorkspaceDTO> {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/service-workspace`, {
      headers: this.getAuthHeaders({ isJson: false }),
      signal
    });
    if (res.status === 401) {
      this.logout();
      const error: any = new Error('Sesión de staff expirada');
      error.statusCode = 401;
      error.code = 'STAFF_UNAUTHORIZED';
      throw error;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al cargar Servicio');
    }
    return res.json();
  }

  static async claimServiceTask(taskType: ServiceTaskKind, targetId: string): Promise<ServiceTaskClaimDTO> {
    const res = await fetch(`${API_BASE}/staff/service/tasks/${encodeURIComponent(taskType)}/${encodeURIComponent(targetId)}/claim`, {
      method: 'POST',
      headers: this.getAuthHeaders({ isJson: false })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error: any = new Error(err.message || err.error || 'No se pudo tomar la tarea');
      error.statusCode = res.status;
      error.code = err.code;
      throw error;
    }
    return res.json();
  }

  static async releaseServiceTask(taskType: ServiceTaskKind, targetId: string) {
    const res = await fetch(`${API_BASE}/staff/service/tasks/${encodeURIComponent(taskType)}/${encodeURIComponent(targetId)}/release`, {
      method: 'POST',
      headers: this.getAuthHeaders({ isJson: false })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'No se pudo reasignar la tarea');
    }
    return res.json();
  }

  static async resolveServiceTask(taskType: ServiceTaskKind, targetId: string) {
    const res = await fetch(`${API_BASE}/staff/service/tasks/${encodeURIComponent(taskType)}/${encodeURIComponent(targetId)}/resolve`, {
      method: 'POST',
      headers: this.getAuthHeaders({ isJson: false })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'No se pudo cerrar la tarea');
    }
    return res.json();
  }

  static async actServiceTask(taskType: ServiceTaskKind, targetId: string, body?: { action?: 'COMPLETE' | 'REJECT' | 'UNDO'; reason?: string }) {
    const res = await fetch(`${API_BASE}/staff/service/tasks/${encodeURIComponent(taskType)}/${encodeURIComponent(targetId)}/act`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error: any = new Error(data.message || data.error || 'No se pudo completar la tarea');
      error.statusCode = res.status;
      error.code = data.code;
      error.details = data.details;
      throw error;
    }
    return data;
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
      headers: this.getAuthHeaders(),
      body: JSON.stringify({})
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
      headers: this.getAuthHeaders({ isJson: false })
    });
    if (!res.ok) throw new Error('Error al cargar fila de espera');
    return res.json();
  }

  static async callWaitlistGuest(id: string) {
    const res = await fetch(`${API_BASE}/staff/waitlist/${id}/call`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({})
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
      headers: this.getAuthHeaders(),
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('Error al validar comanda');
    return res.json();
  }

  static async rejectOrder(orderId: string, reason: string) {
    const res = await fetch(`${API_BASE}/staff/orders/${orderId}/reject`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      const message = error.error || error.message || 'Error al rechazar comanda';
      const failure: any = new Error(message);
      failure.code = error.code;
      failure.details = error.details;
      throw failure;
    }
    return res.json();
  }

  // --- RTMS SALÓN TABLET ---
  static async getFloorPlan(restaurantIdOrSlug: string): Promise<import('@mesaya/shared').FloorPlanResponseDTO> {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}`, {
      headers: this.getAuthHeaders({ isJson: false })
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
      const error: any = new Error(err.message || err.error || 'Error al actualizar mesa');
      error.statusCode = res.status;
      error.code = err.code;
      error.details = err.details;
      throw error;
    }
    return res.json();
  }

  // --- KITCHEN ORDERS / COMANDAS ---
  static async getKitchenOrders(restaurantId: string, signal?: AbortSignal) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/kitchen-orders`, {
      headers: this.getAuthHeaders(),
      signal
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

  static async addManualOrderByStaff(tableId: string, lines: Array<{ menuItemId: string; quantity: number; notes?: string }>) {
    const res = await fetch(`${API_BASE}/staff/tables/${encodeURIComponent(tableId)}/orders`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ lines })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Error al cargar pedido presencial');
    return data;
  }

  static async updateOrderStatus(orderId: string, status: string, options?: { reason?: string }) {
    const res = await fetch(`${API_BASE}/staff/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ status, ...options })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.message || data.error || 'Error al actualizar estado');
      err.code = data.code;
      err.statusCode = res.status;
      throw err;
    }
    return data;
  }

  static async settleSessionAccount(sessionId: string, payload: {
    idempotencyKey: string;
    expectedAccountVersion: string;
    method: string;
    amountMinor?: number;
    tipMinor?: number;
    responsibleStaffUserId?: string;
    allocations?: Array<{ orderId: string; amountMinor: number }>;
  }, authToken?: string) {
    const res = await fetch(`${API_BASE}/staff/sessions/${encodeURIComponent(sessionId)}/settle`, {
      method: 'POST',
      headers: this.getAuthHeaders({ token: authToken }),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error: any = new Error(data.message || data.error || 'No se pudo registrar el cobro');
      error.statusCode = res.status;
      error.code = data.code;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  /**
   * Comando atómico E03 — cobrar y cerrar por cuenta de sesión.
   * Reintento idempotente: conservar exactamente el mismo body/version
   * (`idempotencyKey`, `expectedAccountVersion`, `method`, `amountMinor`,
   * `tipMinor`, `allocations`). Cambiar cualquier campo crea otra intención
   * y responde 409 IDEMPOTENCY_KEY_REUSED en vez de replay.
   */
  static async settleAndCloseSessionAccount(sessionId: string, payload: {
    idempotencyKey: string;
    expectedAccountVersion: string;
    method: string;
    amountMinor?: number;
    tipMinor?: number;
    responsibleStaffUserId?: string;
    allocations?: Array<{ orderId: string; amountMinor: number }>;
  }, authToken?: string) {
    const res = await fetch(`${API_BASE}/staff/sessions/${encodeURIComponent(sessionId)}/settle-and-close`, {
      method: 'POST',
      headers: this.getAuthHeaders({ token: authToken }),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error: any = new Error(data.message || data.error || 'No se pudo cobrar y cerrar');
      error.statusCode = res.status;
      error.code = data.code;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  /**
   * @deprecated E01 — cobro por comanda fuera del camino normal. Usar
   * `settleSessionAccount` / `settleAndCloseSessionAccount` (cuenta por sesión).
   * Reintento idempotente: conservar exactamente el mismo body/version;
   * cualquier reintento debe repetir el mismo payload sin cambios.
   */
  static async payOrder(orderId: string, paymentMethod?: string, tipAmount?: number, idempotencyKey?: string, customerPhone?: string) {
    // eslint-disable-next-line no-console
    console.warn('E01: StaffApi.payOrder deprecado; usar cuenta por sesión (settle / settle-and-close).');
    const res = await fetch(`${API_BASE}/staff/orders/${orderId}/pay`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ paymentMethod, tipAmount, idempotencyKey, customerPhone })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al confirmar cobro');
    }
    return res.json();
  }

  static async getCashOrders(restaurantId: string, signal?: AbortSignal) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/cash-orders`, {
      headers: this.getAuthHeaders({ isJson: false }),
      signal
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Error al cargar caja');
    }
    return res.json();
  }

  static async getRewardsCustomer(restaurantId: string, phone: string) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/rewards/customer?phone=${encodeURIComponent(phone)}`, {
      headers: this.getAuthHeaders({ isJson: false })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'No se pudo consultar Rewards');
    return data;
  }

  static async getRewardItems(restaurantId: string) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/rewards/items`, {
      headers: this.getAuthHeaders({ isJson: false })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'No se pudieron cargar los premios');
    return data;
  }

  static async redeemReward(restaurantId: string, phone: string, rewardItemId: string, idempotencyKey: string) {
    const res = await fetch(`${API_BASE}/staff/restaurants/${restaurantId}/rewards/redeem`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ phone, rewardItemId, idempotencyKey })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'No se pudo canjear el premio');
    return data;
  }

  static async getMenu(restaurantSlugOrId: string): Promise<RestaurantMenuResponse> {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantSlugOrId}/menu`);
    if (!res.ok) throw new Error('Error al cargar carta');
    return res.json();
  }

  static async getTables(restaurantId: string): Promise<StaffTableItemDTO[]> {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/tables`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar mesas');
    return res.json();
  }
}
