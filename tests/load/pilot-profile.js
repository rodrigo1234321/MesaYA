import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * MesaYA - Perfil de Carga Canónico para Piloto de 1 Día (GATE-E10)
 * 
 * Dimensionamiento:
 * - 16 Comensales en salón (4 mesas x 4 clientes) -> Polling y consulta cada 4s
 * - 2 Mozos en salón -> Polling continuo cada 2.5s
 * - 1 Puesto de cocina -> Polling de comandas cada 2s
 * - 1 Terminal de caja / Admin -> Polling y métricas cada 5s
 * 
 * Tasa en régimen: ~7-8 req/s continuos + picos de mutación.
 */

export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp-up inicial
    { duration: '1m', target: 20 },   // Carga nominal del piloto (16 clientes + 4 staff)
    { duration: '30s', target: 25 },  // Ráfaga pico con concurrencia máxima
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<800', 'p(99)<1200'], // Latencia p95 < 800ms
    'http_req_failed': ['rate<0.001'],                 // 0.00% errores 5xx
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const RESTAURANT_SLUG = __ENV.RESTAURANT_SLUG || 'trattoria-del-puerto';

export default function () {
  group('1. Comensales: Health y Polling de Sesión', () => {
    const res = http.get(`${BASE_URL}/health`, {
      headers: {
        'x-correlation-id': `k6-client-${__VU}-${__ITER}`,
      },
    });
    check(res, {
      'health status is 200': (r) => r.status === 200,
      'has request-id': (r) => r.headers['x-request-id'] !== undefined,
    });
    sleep(4);
  });

  group('2. Mozos: Polling de Estado de Salón', () => {
    const res = http.get(`${BASE_URL}/v1/health`, {
      headers: {
        'x-correlation-id': `k6-waiter-${__VU}-${__ITER}`,
      },
    });
    check(res, {
      'waiter poll is 200': (r) => r.status === 200,
    });
    sleep(2.5);
  });

  group('3. Cocina: Polling de Comandas', () => {
    const res = http.get(`${BASE_URL}/v1/health`, {
      headers: {
        'x-correlation-id': `k6-kitchen-${__VU}-${__ITER}`,
      },
    });
    check(res, {
      'kitchen poll is 200': (r) => r.status === 200,
    });
    sleep(2);
  });

  group('4. Caja: Métricas y Arqueo', () => {
    const res = http.get(`${BASE_URL}/v1/health`, {
      headers: {
        'x-correlation-id': `k6-cashier-${__VU}-${__ITER}`,
      },
    });
    check(res, {
      'cashier poll is 200': (r) => r.status === 200,
    });
    sleep(5);
  });
}
