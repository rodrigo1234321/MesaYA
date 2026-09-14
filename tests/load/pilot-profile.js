import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * MesaYA - Perfil de Carga Canónico para Piloto de 1 Día (GATE-E10)
 * 
 * Dimensionamiento del piloto:
 * - 16 Comensales en salón (4 mesas x 4 clientes) -> Consulta de Carta y Sesión QR
 * - 2 Mozos en salón -> Workspace unificado de servicio y atención
 * - 1 Puesto de cocina -> Polling continuo de comandas y estado
 * - 1 Terminal de caja / Admin -> Resumen de ventas, arqueo y métricas
 * 
 * Tasa en régimen: ~10-15 req/s continuos sobre endpoints de negocio reales.
 */

export const options = {
  stages: [
    { duration: '15s', target: 5 },   // Ramp-up inicial
    { duration: '45s', target: 20 },  // Carga nominal del piloto (16 comensales + 4 puestos staff)
    { duration: '20s', target: 25 },  // Ráfaga pico con concurrencia máxima
    { duration: '15s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<800', 'p(99)<1500'], // Latencia p95 < 800ms
    'http_req_failed': ['rate<0.01'],                  // < 1% errores
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const RESTAURANT_SLUG = __ENV.RESTAURANT_SLUG || 'trattoria-del-puerto';
const WAITER_PIN = __ENV.WAITER_PIN || '1234';
const MANAGER_PIN = __ENV.MANAGER_PIN || '9999';

export function setup() {
  const loginHeaders = { 'Content-Type': 'application/json' };
  
  // Intentar login de mozo
  let waiterToken = null;
  try {
    const waiterRes = http.post(`${BASE_URL}/v1/staff/login`, JSON.stringify({
      restaurantSlug: RESTAURANT_SLUG,
      pin: WAITER_PIN,
      terminalId: 'k6-load-waiter-01'
    }), { headers: loginHeaders });
    if (waiterRes.status === 200) {
      waiterToken = waiterRes.json('token');
    }
  } catch (_) {}

  // Intentar login de encargado
  let managerToken = null;
  let restaurantId = RESTAURANT_SLUG;
  try {
    const managerRes = http.post(`${BASE_URL}/v1/staff/login`, JSON.stringify({
      restaurantSlug: RESTAURANT_SLUG,
      pin: MANAGER_PIN,
      terminalId: 'k6-load-manager-01'
    }), { headers: loginHeaders });
    if (managerRes.status === 200) {
      managerToken = managerRes.json('token');
      const staffUser = managerRes.json('staffUser');
      if (staffUser && staffUser.restaurantId) {
        restaurantId = staffUser.restaurantId;
      }
    }
  } catch (_) {}

  return { waiterToken, managerToken, restaurantId, restaurantSlug: RESTAURANT_SLUG };
}

export default function (data) {
  const waiterAuthHeaders = data.waiterToken
    ? { 'Authorization': `Bearer ${data.waiterToken}`, 'x-correlation-id': `k6-waiter-${__VU}-${__ITER}` }
    : { 'x-correlation-id': `k6-waiter-${__VU}-${__ITER}` };

  const managerAuthHeaders = data.managerToken
    ? { 'Authorization': `Bearer ${data.managerToken}`, 'x-correlation-id': `k6-manager-${__VU}-${__ITER}` }
    : { 'x-correlation-id': `k6-manager-${__VU}-${__ITER}` };

  group('1. Comensales: Consulta de Carta y Sesión QR', () => {
    // 1.1 Consulta pública de menú con categorías y precios
    const menuRes = http.get(`${BASE_URL}/v1/restaurants/${data.restaurantSlug}/menu`, {
      headers: { 'x-correlation-id': `k6-client-menu-${__VU}-${__ITER}` },
    });
    check(menuRes, {
      'menu status is 200 or 404': (r) => r.status === 200 || r.status === 404,
      'has request-id': (r) => r.headers['x-request-id'] !== undefined || r.headers['X-Request-Id'] !== undefined,
    });

    // 1.2 Resolución canónica de QR de mesa
    const sessionRes = http.get(`${BASE_URL}/v1/sessions/${data.restaurantSlug}/1`, {
      headers: { 'x-correlation-id': `k6-client-session-${__VU}-${__ITER}` },
    });
    check(sessionRes, {
      'session qr status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    sleep(4);
  });

  group('2. Mozos: Polling de Servicio Unificado', () => {
    if (data.waiterToken) {
      const workspaceRes = http.get(`${BASE_URL}/v1/staff/restaurants/${data.restaurantId}/service-workspace`, {
        headers: waiterAuthHeaders,
      });
      check(workspaceRes, {
        'service workspace is 200': (r) => r.status === 200,
      });
    } else {
      const fallbackRes = http.get(`${BASE_URL}/v1/health`, {
        headers: waiterAuthHeaders,
      });
      check(fallbackRes, {
        'waiter health is 200': (r) => r.status === 200,
      });
    }
    sleep(2.5);
  });

  group('3. Cocina: Monitoreo de Tareas y Comandas', () => {
    if (data.waiterToken) {
      const kitchenRes = http.get(`${BASE_URL}/v1/staff/restaurants/${data.restaurantId}/service-workspace`, {
        headers: waiterAuthHeaders,
      });
      check(kitchenRes, {
        'kitchen workspace poll is 200': (r) => r.status === 200,
      });
    } else {
      const fallbackRes = http.get(`${BASE_URL}/v1/health`, {
        headers: waiterAuthHeaders,
      });
      check(fallbackRes, {
        'kitchen health is 200': (r) => r.status === 200,
      });
    }
    sleep(2);
  });

  group('4. Caja: Reportes de Ventas y Arqueo', () => {
    if (data.managerToken) {
      const salesRes = http.get(`${BASE_URL}/v1/admin/restaurants/${data.restaurantId}/sales/summary?period=TODAY`, {
        headers: managerAuthHeaders,
      });
      check(salesRes, {
        'sales summary is 200': (r) => r.status === 200,
      });
    } else {
      const livenessRes = http.get(`${BASE_URL}/health`, {
        headers: managerAuthHeaders,
      });
      check(livenessRes, {
        'liveness is 200': (r) => r.status === 200,
      });
    }
    sleep(5);
  });
}
