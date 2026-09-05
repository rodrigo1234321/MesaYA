import { Sector, MetricsDTO, RestaurantMenuResponse, MenuCategoryDTO, MenuItemDTO, BatchMenuImportDTO } from '@mesaya/shared';

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

export interface TableItem {
  id: string;
  label: string;
  sector: Sector;
  isOutdoor: boolean;
  activeToken: string | null;
  expiresAt: string | null;
}

export interface RestaurantItem {
  id: string;
  name: string;
  slug: string;
  templateId: string;
  themeColor: string;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  createdAt: string;
}

export class AdminApi {
  static async requireAuthorized(response: Response, fallback: string) {
    if (response.ok) return;
    const error = await response.json().catch(() => ({ error: fallback }));
    if (response.status === 401 || response.status === 403) {
      this.logout();
      // 403 debe mostrar el message descriptivo de la API, no sólo FORBIDDEN.
      throw new Error((error as any).message || (error as any).error || fallback);
    }
    throw new Error((error as any).message || (error as any).error || fallback);
  }
  static getAuthToken(): string | null {
    return localStorage.getItem('mesaya_admin_token');
  }

  static getAuthHeaders(): Record<string, string> {
    const token = this.getAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  static getSavedRestaurant(): RestaurantItem | null {
    const raw = localStorage.getItem('mesaya_active_restaurant');
    return raw ? JSON.parse(raw) : null;
  }

  static setSavedRestaurant(restaurant: Partial<RestaurantItem>) {
    localStorage.setItem('mesaya_active_restaurant', JSON.stringify(restaurant));
  }

  static logout() {
    localStorage.removeItem('mesaya_admin_token');
    localStorage.removeItem('mesaya_active_restaurant');
    localStorage.removeItem('mesaya_staff_user');
  }

  static async getRestaurants(): Promise<RestaurantItem[]> {
    const res = await fetch(`${API_BASE}/restaurants`);
    if (!res.ok) throw new Error('Error al listar restaurantes');
    return res.json();
  }

  static async registerRestaurant(data: {
    name: string;
    slug: string;
    managerName?: string;
    pin: string;
    templateId?: string;
    themeColor?: string;
    tablesCount?: number;
    coverImageUrl?: string;
  }) {
    const res = await fetch(`${API_BASE}/auth/register-restaurant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al registrar local' }));
      throw new Error((err as any).message || (err as any).error || 'Error al registrar restaurante');
    }

    const resData = await res.json();
    localStorage.setItem('mesaya_admin_token', resData.token);
    this.setSavedRestaurant(resData.restaurant);
    return resData;
  }

  static async loginAdmin(restaurantSlug: string, pin: string) {
    const res = await fetch(`${API_BASE}/auth/login-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantSlug, pin })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error de autenticación' }));
      throw new Error((err as any).message || (err as any).error || 'PIN o restaurante incorrecto');
    }

    const resData = await res.json();
    localStorage.setItem('mesaya_admin_token', resData.token);
    this.setSavedRestaurant(resData.restaurant);
    return resData;
  }

  static async getTables(restaurantId: string): Promise<TableItem[]> {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/tables`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al cargar mesas');
    return res.json();
  }

  static async createTable(restaurantId: string, label: string, sector: Sector, isOutdoor: boolean): Promise<TableItem> {
    const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/tables`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ label, sector, isOutdoor })
    });
    await this.requireAuthorized(res, 'Error al crear mesa');
    return res.json();
  }

  static async getCurrentShift(restaurantId: string) {
    const res = await fetch(`${API_BASE}/shifts/current?restaurantId=${restaurantId}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar turno');
    return res.json();
  }

  static async openShift(restaurantId: string) {
    const res = await fetch(`${API_BASE}/shifts/open`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ restaurantId })
    });
    await this.requireAuthorized(res, 'Error al abrir turno');
    return res.json();
  }

  static async closeShift(shiftId: string, restaurantId: string) {
    const res = await fetch(`${API_BASE}/shifts/${shiftId}/close`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ restaurantId })
    });
    await this.requireAuthorized(res, 'Error al cerrar turno');
    return res.json();
  }

  static async getMetrics(restaurantId: string): Promise<MetricsDTO> {
    const res = await fetch(`${API_BASE}/metrics?restaurantId=${restaurantId}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al cargar métricas');
    return res.json();
  }

  static async getStaff(restaurantId: string) {
    const res = await fetch(`${API_BASE}/staff?restaurantId=${restaurantId}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al cargar personal');
    return res.json();
  }

  static async createStaff(restaurantId: string, name: string, pin: string, role: string, assignedSector?: Sector) {
    const res = await fetch(`${API_BASE}/staff`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ restaurantId, name, pin, role, assignedSector })
    });
    await this.requireAuthorized(res, 'Error al registrar personal');
    return res.json();
  }

  // --- CARTA DIGITAL & MENÚ MULTI-TENANT ---
  static async getMenu(slugOrId: string): Promise<RestaurantMenuResponse> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al cargar menú');
    return res.json();
  }

  static async createCategory(slugOrId: string, name: string, icon?: string): Promise<MenuCategoryDTO> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/categories`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ name, icon })
    });
    if (!res.ok) throw new Error('Error al crear categoría');
    return res.json();
  }

  static async deleteCategory(slugOrId: string, categoryId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/categories/${categoryId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar categoría');
    return res.json();
  }

  static async createMenuItem(slugOrId: string, data: any): Promise<MenuItemDTO> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/items`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al crear plato');
    return res.json();
  }

  static async updateMenuItem(slugOrId: string, itemId: string, data: any): Promise<MenuItemDTO> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/items/${itemId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar plato');
    return res.json();
  }

  static async deleteMenuItem(slugOrId: string, itemId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/items/${itemId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar plato');
    return res.json();
  }

  static async importMenuBatch(slugOrId: string, data: BatchMenuImportDTO): Promise<{ success: boolean; message: string; categoriesCount: number; itemsCount: number }> {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/import`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al importar' }));
      throw new Error(err.error || 'Error al importar carta');
    }
    return res.json();
  }

  static async updateBranding(slugOrId: string, data: { themeColor?: string; logoUrl?: string; coverImageUrl?: string; name?: string; whatsappPhone?: string }) {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/branding`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar imagen de marca');
    return res.json();
  }

  static async updateTemplate(slugOrId: string, data: { templateId?: string; customFont?: string; themeColor?: string }) {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/template`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar template visual');
    return res.json();
  }

  static async generateMenuWithAI(slugOrId: string, data: { concept: string; autoApply?: boolean; gastronomyType?: string }) {
    const res = await fetch(`${API_BASE}/restaurants/${slugOrId}/menu/ai-generate`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al generar con IA' }));
      throw new Error(err.error || 'Error al generar carta con IA');
    }
    return res.json();
  }

  // --- CONFIGURACIÓN MODULAR & FEATURE FLAGS ---
  static async getModuleConfig(restaurantId: string) {
    const res = await fetch(`${API_BASE}/admin/restaurants/${restaurantId}/config`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al cargar configuración de módulos');
    return res.json();
  }

  static async updateModuleConfig(restaurantId: string, data: any) {
    const res = await fetch(`${API_BASE}/admin/restaurants/${restaurantId}/config`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    await this.requireAuthorized(res, 'Error al actualizar configuración modular');
    return res.json();
  }

  static async getModuleConfigAudit(restaurantId: string) {
    const res = await fetch(`${API_BASE}/admin/restaurants/${restaurantId}/config/audit`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar logs de auditoría');
    return res.json();
  }

  // --- RTMS: GESTIÓN DE PLANO Y SALÓN EN VIVO ---
  static async getFloorPlan(restaurantIdOrSlug: string, signal?: AbortSignal): Promise<import('@mesaya/shared').FloorPlanResponseDTO> {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}`, {
      headers: this.getAuthHeaders(),
      signal
    });
    if (res.status === 401) {
      const error: any = new Error('Sesión de administrador expirada');
      error.statusCode = 401;
      error.code = 'ADMIN_UNAUTHORIZED';
      throw error;
    }
    if (!res.ok) throw new Error('Error al cargar plano de mesas');
    return res.json();
  }

  static async updateFloorPlan(restaurantIdOrSlug: string, data: import('@mesaya/shared').FloorPlanUpdateDTO) {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const err: any = new Error(errData.message || 'Error al guardar plano de mesas');
      err.statusCode = res.status;
      err.code = errData.error;
      err.details = errData.details;
      throw err;
    }
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
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Error al ejecutar acción de mesa');
    }
    return res.json();
  }

  static async overrideTableState(tableId: string, targetState: string, reason?: string) {
    const res = await fetch(`${API_BASE}/tables/${tableId}/state/override`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ targetState, reason })
    });
    if (!res.ok) throw new Error('Error en override de estado');
    return res.json();
  }

  static async updateTablePosition(tableId: string, data: import('@mesaya/shared').TablePositionUpdateDTO) {
    const res = await fetch(`${API_BASE}/tables/${tableId}/position`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const err: any = new Error(errData.message || 'Error al actualizar posición de mesa');
      err.statusCode = res.status;
      err.code = errData.error;
      err.details = errData.details;
      throw err;
    }
    return res.json();
  }

  static async createZone(restaurantIdOrSlug: string, data: import('@mesaya/shared').ZoneCreateDTO) {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}/zones`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al crear zona');
    return res.json();
  }

  static async deleteZone(restaurantIdOrSlug: string, zoneId: string) {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}/zones/${zoneId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar zona');
    return res.json();
  }

  static async deleteTable(restaurantIdOrSlug: string, tableId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/floor-plan/${restaurantIdOrSlug}/tables/${tableId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Error al eliminar mesa');
    }
    return res.json();
  }

  // --- RTMS: ANALYTICS & REVPASH ---
  static async getRTMSAnalyticsSummary(
    restaurantSlug: string,
    from?: string,
    to?: string
  ): Promise<import('@mesaya/shared').RTMSAnalyticsSummaryDTO> {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${API_BASE}/analytics/${restaurantSlug}/summary?${params.toString()}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar resumen de analytics');
    return res.json();
  }

  static async getRTMSPhaseMetrics(
    restaurantSlug: string,
    from?: string,
    to?: string
  ): Promise<import('@mesaya/shared').PhaseMetricsDTO> {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${API_BASE}/analytics/${restaurantSlug}/phases?${params.toString()}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar métricas de fases');
    return res.json();
  }

  static async getRTMSHeatmap(
    restaurantSlug: string,
    from?: string,
    to?: string
  ): Promise<import('@mesaya/shared').HeatmapHourCellDTO[]> {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${API_BASE}/analytics/${restaurantSlug}/heatmap?${params.toString()}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar mapa de calor');
    return res.json();
  }

  static async getRTMSTablePerformance(
    restaurantSlug: string,
    from?: string,
    to?: string
  ): Promise<import('@mesaya/shared').TablePerformanceDTO[]> {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const res = await fetch(`${API_BASE}/analytics/${restaurantSlug}/table-performance?${params.toString()}`, {
      headers: this.getAuthHeaders()
    });
    await this.requireAuthorized(res, 'Error al consultar rendimiento de mesas');
    return res.json();
  }
}

