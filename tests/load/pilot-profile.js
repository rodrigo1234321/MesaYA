import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';

/**
 * MesaYA E22 — Perfil de carga funcional fail-closed (S08/S28).
 *
 * Unico perfil canonico: tests/load/pilot-profile.js
 *
 * Fail-closed: sin API_URL/RESTAURANT_SLUG/WAITER_PIN/MANAGER_PIN aborta en
 * setup(). Sin listas de mesas explicitas aborta. 404/health nunca es PASS de
 * negocio. Toda mutacion ambigua detiene la iteracion sin reintento ciego.
 *
 * Metas de prueba (NO capacidad certificada): los umbrales de abajo son metas
 * previas para decidir si la corrida merece analisis, no una certificacion de
 * mesas soportadas. La corrida real queda PENDING_CLOUD/PENDING_HUMAN (k6 no
 * instalado en el host supervisor; destino aislado + operador pendientes).
 *
 * Variables:
 *   Obligatorias: API_URL, RESTAURANT_SLUG, WAITER_PIN, MANAGER_PIN
 *   Listas: K6_GUEST_TABLE_LABELS (coma, lectoras), K6_FLOW_TABLE_LABELS (coma, mutantes)
 *   Opt-in mutante: K6_BUSINESS_FLOW=true
 *   Limites visibles: K6_GUEST_VUS, K6_SALON_VUS, K6_KITCHEN_VUS, K6_CASH_VUS,
 *     K6_FLOW_VUS, K6_DURATION_S
 *   Techo seguro: K6_MAX_VUS=30, K6_MAX_DURATION_S=300 (setup aborta si se supera)
 */

// ---------------------------------------------------------------------------
// Limites visibles por entorno + techo seguro (evaluados en init, antes de setup)
// ---------------------------------------------------------------------------
function parseNonNegativeInt(raw, name, def) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`E22 fail-closed: ${name} debe ser entero >= 0 (recibido: ${text.slice(0, 40)})`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`E22 fail-closed: ${name} debe ser entero >= 0 (recibido: ${String(raw).slice(0, 40)})`);
  }
  return n;
}

function parsePositiveInt(raw, name, def) {
  const n = parseNonNegativeInt(raw, name, def);
  if (n < 1) throw new Error(`E22 fail-closed: ${name} debe ser entero > 0.`);
  return n;
}

const K6_MAX_VUS = 30;
const K6_MAX_DURATION_S = 300;

const GUEST_VUS = parseNonNegativeInt(__ENV.K6_GUEST_VUS, 'K6_GUEST_VUS', 4);
const SALON_VUS = parseNonNegativeInt(__ENV.K6_SALON_VUS, 'K6_SALON_VUS', 2);
const KITCHEN_VUS = parseNonNegativeInt(__ENV.K6_KITCHEN_VUS, 'K6_KITCHEN_VUS', 1);
const CASH_VUS = parseNonNegativeInt(__ENV.K6_CASH_VUS, 'K6_CASH_VUS', 1);
const FLOW_VUS = parseNonNegativeInt(__ENV.K6_FLOW_VUS, 'K6_FLOW_VUS', 1);
const DURATION_S = parsePositiveInt(__ENV.K6_DURATION_S, 'K6_DURATION_S', 95);
const FLOW_ITERATIONS = parsePositiveInt(__ENV.K6_FLOW_ITERATIONS, 'K6_FLOW_ITERATIONS', 1);

const FLOW_ENABLED = String(__ENV.K6_BUSINESS_FLOW || '').toLowerCase() === 'true';
const EFFECTIVE_FLOW_VUS = FLOW_ENABLED ? FLOW_VUS : 0;
const TOTAL_VUS = GUEST_VUS + SALON_VUS + KITCHEN_VUS + CASH_VUS + EFFECTIVE_FLOW_VUS;

// El techo se verifica de nuevo en setup() (defensa en profundidad); aqui se
// deja registrado en options.title para auditoria. No se recorta en silencio:
// si el entorno pide mas, setup() aborta con mensaje accionable.
function scenarioFor(vus, execName) {
  if (vus <= 0) return null;
  return {
    executor: 'constant-vus',
    exec: execName,
    vus,
    duration: `${DURATION_S}s`,
  };
}

function flowScenarioFor(vus, execName) {
  if (vus <= 0) return null;
  return {
    executor: 'per-vu-iterations',
    exec: execName,
    vus,
    iterations: FLOW_ITERATIONS,
    maxDuration: `${DURATION_S}s`,
  };
}

const scenarios = {};
const _g = scenarioFor(GUEST_VUS, 'guestRead');
if (_g) scenarios.guest_readers = _g;
const _s = scenarioFor(SALON_VUS, 'salonRead');
if (_s) scenarios.salon_poll = _s;
const _k = scenarioFor(KITCHEN_VUS, 'kitchenRead');
if (_k) scenarios.kitchen_poll = _k;
const _c = scenarioFor(CASH_VUS, 'cashRead');
if (_c) scenarios.cash_poll = _c;
const _f = flowScenarioFor(EFFECTIVE_FLOW_VUS, 'businessFlow');
if (_f) scenarios.business_flow = _f;

// ---------------------------------------------------------------------------
// Metricas explicitas de negocio
// ---------------------------------------------------------------------------
const businessCheckPass = new Rate('business_check_pass');
const businessErrorRate = new Rate('business_error_rate');
const businessLatency = new Trend('business_latency_ms');
const pollingRequests = new Counter('polling_requests');
const flowCompleted = new Counter('business_flow_completed');
const flowFailed = new Counter('business_flow_failed');
const reconciledOk = new Counter('business_reconciliation_ok');

const thresholds = {
  // Latencia de negocio (metas de prueba, no capacidad certificada).
  business_latency_ms: ['p(50)<500', 'p(95)<800', 'p(99)<1500'],
  // Checks semanticos y errores de negocio.
  business_check_pass: ['rate>0.99'],
  business_error_rate: ['rate<0.01'],
  checks: ['rate>0.99'],
  http_req_failed: ['rate<0.01'],
};
  if (FLOW_ENABLED && EFFECTIVE_FLOW_VUS > 0) {
  // Si el escenario mutante esta habilitado, exigir al menos una finalizacion
  // y una conciliacion exitosa; si no ocurren, la corrida reprueba.
  thresholds.business_flow_completed = ['count>0'];
  thresholds.business_reconciliation_ok = ['count>0'];
}

export const options = {
  scenarios,
  thresholds,
};

// Duracion registrada para auditoria (visible en summary).
const PROFILE_DURATION_S = DURATION_S;
const PROFILE_MAX_VUS = K6_MAX_VUS;

// ---------------------------------------------------------------------------
// Helpers fail-closed (sin try/catch que convierta fallo en null)
// ---------------------------------------------------------------------------
function requiredEnv(name) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error(
      `E22 fail-closed: falta ${name}. Exporte ${name} por entorno; no hay defaults de demo.`
    );
  }
  return String(raw).trim();
}

function parseLabelList(raw, name) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function failClosed(msg) {
  // En setup(): aborta la corrida. En VU: aborta la iteracion con error.
  throw new Error(`E22 fail-closed: ${msg}`);
}

function parseJsonOrFail(res, label) {
  // No tragar JSON invalido: abortar con contexto sin volcar cuerpo sensible.
  let body;
  try {
    body = res.json();
  } catch (e) {
    failClosed(`${label}: respuesta no es JSON valido (status ${res.status})`);
  }
  if (body === null || body === undefined || typeof body !== 'object') {
    failClosed(`${label}: JSON inesperado (status ${res.status})`);
  }
  return body;
}

function expectStatus(res, expected, label) {
  if (res.status !== expected) {
    failClosed(`${label}: status inesperado ${res.status} (esperado ${expected})`);
  }
}

function observeBusiness(res, endpoint) {
  try {
    businessLatency.add(res.timings.duration, { endpoint });
  } catch (_) {
    // La observacion nunca convierte un fallo en PASS; si la metrica falla,
    // la semantica ya quedo registrada por los checks.
  }
}

// Registro semantico: ok=true suma pass y error 0; ok=false suma pass 0 y error 1.
function recordSemantic(ok, endpoint) {
  businessCheckPass.add(ok, { endpoint });
  businessErrorRate.add(!ok, { endpoint });
}

// Llamada de polling con tags + metrica explicita. No valida semantica: el
// llamador debe hacer check() + recordSemantic().
function pollGet(url, headers, endpointTag) {
  const res = http.get(url, {
    headers,
    tags: { kind: 'poll', endpoint: endpointTag },
  });
  pollingRequests.add(1, { endpoint: endpointTag });
  observeBusiness(res, endpointTag);
  return res;
}

function loginOrFail(baseUrl, slug, pin, terminalId, role) {
  const res = http.post(
    `${baseUrl}/v1/staff/login`,
    JSON.stringify({ restaurantSlug: slug, pin, terminalId }),
    { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'preflight', endpoint: 'staff-login' } }
  );
  if (res.status !== 200) {
    failClosed(`preflight login ${role}: status ${res.status} (esperado 200)`);
  }
  const body = parseJsonOrFail(res, `preflight login ${role}`);
  const token = body.token;
  if (typeof token !== 'string' || token.trim() === '') {
    failClosed(`preflight login ${role}: token vacio`);
  }
  const restaurantId = body?.staffUser?.restaurantId;
  if (typeof restaurantId !== 'string' || restaurantId.trim() === '') {
    failClosed(`preflight login ${role}: staffUser.restaurantId vacio`);
  }
  return { token: token.trim(), restaurantId: restaurantId.trim() };
}

// ---------------------------------------------------------------------------
// setup(): preflight obligatorio. Cualquier desvio aborta (sin nulls).
// ---------------------------------------------------------------------------
export function setup() {
  const API_URL = requiredEnv('API_URL');
  const RESTAURANT_SLUG = requiredEnv('RESTAURANT_SLUG');
  const WAITER_PIN = requiredEnv('WAITER_PIN');
  const MANAGER_PIN = requiredEnv('MANAGER_PIN');
  // Nunca imprimir PINs/tokens/headers Authorization.

  if (TOTAL_VUS > K6_MAX_VUS) {
    failClosed(
      `techo seguro superado: total VUs ${TOTAL_VUS} > K6_MAX_VUS ${K6_MAX_VUS} ` +
        `(guest=${GUEST_VUS} salon=${SALON_VUS} kitchen=${KITCHEN_VUS} cash=${CASH_VUS} flow=${EFFECTIVE_FLOW_VUS}). ` +
        `Baje VUs o ejecute en destino aislado con techo revisado.`
    );
  }
  if (DURATION_S > K6_MAX_DURATION_S) {
    failClosed(
      `techo de duracion superado: ${DURATION_S}s > ${K6_MAX_DURATION_S}s. Reduzca K6_DURATION_S.`
    );
  }
  if (Object.keys(scenarios).length === 0) {
    failClosed('sin escenarios con VUs>0: configure al menos un K6_*_VUS > 0.');
  }

  const guestLabels = parseLabelList(__ENV.K6_GUEST_TABLE_LABELS, 'K6_GUEST_TABLE_LABELS');
  const flowLabels = parseLabelList(__ENV.K6_FLOW_TABLE_LABELS, 'K6_FLOW_TABLE_LABELS');
  if (GUEST_VUS > 0 && guestLabels.length === 0) {
    failClosed('K6_GUEST_TABLE_LABELS requerida (coma) cuando hay guest VUs>0; no se asume "Mesa 1".');
  }
  if (FLOW_ENABLED) {
    if (EFFECTIVE_FLOW_VUS <= 0) {
      failClosed('K6_FLOW_VUS debe ser > 0 con K6_BUSINESS_FLOW=true.');
    }
    if (flowLabels.length === 0) {
      failClosed('K6_FLOW_TABLE_LABELS requerida (coma) con K6_BUSINESS_FLOW=true.');
    }
    if (flowLabels.length < EFFECTIVE_FLOW_VUS) {
      failClosed(
        `mesas de flujo insuficientes: ${flowLabels.length} < VUs de flujo ${EFFECTIVE_FLOW_VUS}. ` +
          `Provea una mesa por VU de flujo.`
      );
    }
    if (GUEST_VUS > 0) {
      const guestSet = new Set(guestLabels.map((l) => l.toLowerCase()));
      const overlap = flowLabels.filter((l) => guestSet.has(l.toLowerCase()));
      if (overlap.length > 0) {
        failClosed(`listas lectoras/mutantes no disjuntas: ${overlap.join(', ')}. Separe mesas de lectura y flujo.`);
      }
    }
  }

  // 1. Conectividad: /v1/health solo como conectividad, nunca como sustituto
  // de comprobacion de negocio.
  const healthRes = http.get(`${API_URL}/v1/health`, { tags: { kind: 'preflight', endpoint: 'health' } });
  expectStatus(healthRes, 200, 'preflight health');
  parseJsonOrFail(healthRes, 'preflight health');

  // 2. Auth real de mozo y manager; mismo restaurantId; abortar ante desvio.
  const waiter = loginOrFail(API_URL, RESTAURANT_SLUG, WAITER_PIN, 'k6-e22-waiter-01', 'mozo');
  const manager = loginOrFail(API_URL, RESTAURANT_SLUG, MANAGER_PIN, 'k6-e22-manager-01', 'manager');
  if (waiter.restaurantId !== manager.restaurantId) {
    failClosed('preflight: mozo y manager resolvieron distinto restaurantId.');
  }
  const restaurantId = waiter.restaurantId;

  const waiterHeaders = { Authorization: `Bearer ${waiter.token}` };
  const managerHeaders = { Authorization: `Bearer ${manager.token}` };

  // 3. Menu publico con estructura real.
  const menuRes = http.get(`${API_URL}/v1/restaurants/${encodeURIComponent(RESTAURANT_SLUG)}/menu`, {
    tags: { kind: 'preflight', endpoint: 'menu' },
  });
  expectStatus(menuRes, 200, 'preflight menu');
  const menu = parseJsonOrFail(menuRes, 'preflight menu');
  if (!menu.restaurant || typeof menu.restaurant !== 'object') {
    failClosed('preflight menu: falta objeto restaurant.');
  }
  if (!Array.isArray(menu.categories) || menu.categories.length === 0) {
    failClosed('preflight menu: categories vacia.');
  }
  let menuItemId = null;
  let menuItemPrice = 0;
  for (const cat of menu.categories) {
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    for (const it of items) {
      if (it && it.isAvailable === true && typeof it.id === 'string' && it.id.trim() !== '') {
        const price = Number(it.price);
        if (Number.isFinite(price) && price > 0) {
          menuItemId = it.id;
          menuItemPrice = price;
          break;
        }
      }
    }
    if (menuItemId) break;
  }
  if (!menuItemId) {
    failClosed('preflight menu: sin item disponible con id/precio>0.');
  }

  // 4. Mesas con token de staff y estructura real.
  const tablesRes = http.get(
    `${API_URL}/v1/restaurants/${encodeURIComponent(restaurantId)}/tables`,
    { headers: waiterHeaders, tags: { kind: 'preflight', endpoint: 'tables' } }
  );
  expectStatus(tablesRes, 200, 'preflight tables');
  const tablesBody = parseJsonOrFail(tablesRes, 'preflight tables');
  const tables = Array.isArray(tablesBody) ? tablesBody : tablesBody.tables;
  if (!Array.isArray(tables) || tables.length === 0) {
    failClosed('preflight tables: lista vacia o sin estructura real.');
  }
  const byLabel = new Map();
  const byId = new Map();
  for (const t of tables) {
    if (!t || typeof t.id !== 'string' || typeof t.label !== 'string' || typeof t.currentState !== 'string') {
      failClosed('preflight tables: fila sin id/label/currentState.');
    }
    byLabel.set(t.label, t);
    byLabel.set(t.label.toLowerCase(), t);
    byId.set(t.id, t);
  }
  for (const label of guestLabels) {
    if (!byLabel.has(label) && !byLabel.has(label.toLowerCase())) {
      failClosed(`preflight: mesa lectora no existe: "${label}".`);
    }
  }
  const flowTables = [];
  for (const label of flowLabels) {
    const row = byLabel.get(label) || byLabel.get(label.toLowerCase());
    if (!row) failClosed(`preflight: mesa de flujo no existe: "${label}".`);
    if (row.currentState !== 'AVAILABLE') {
      failClosed(`preflight: mesa de flujo "${label}" no esta AVAILABLE (esta ${row.currentState}).`);
    }
    flowTables.push({ label: row.label, id: row.id });
  }

  // 5. Resolucion QR canonica por mesa lectora: 200, valid===true, token y
  // pertenencia. Nunca 404 ni ruta legacy.
  const guestQr = [];
  for (const label of guestLabels) {
    const res = http.get(
      `${API_URL}/v1/sessions/${encodeURIComponent(RESTAURANT_SLUG)}/${encodeURIComponent(label)}`,
      { tags: { kind: 'preflight', endpoint: 'session-qr' } }
    );
    expectStatus(res, 200, `preflight QR "${label}"`);
    const body = parseJsonOrFail(res, `preflight QR "${label}"`);
    if (body.valid !== true) {
      failClosed(`preflight QR "${label}": valid !== true.`);
    }
    if (typeof body.token !== 'string' || body.token.trim() === '') {
      failClosed(`preflight QR "${label}": token vacio.`);
    }
    const bodyRestaurantId = body?.restaurant?.id;
    const bodyTableId = body?.table?.id;
    const bodyTableLabel = body?.table?.label;
    if (bodyRestaurantId !== restaurantId) {
      failClosed(`preflight QR "${label}": restaurant mismatch.`);
    }
    const expectedRow = byLabel.get(label) || byLabel.get(label.toLowerCase());
    if (bodyTableId !== expectedRow.id) {
      failClosed(`preflight QR "${label}": table mismatch.`);
    }
    if (typeof bodyTableLabel !== 'string' || bodyTableLabel.trim() === '') {
      failClosed(`preflight QR "${label}": table.label vacio.`);
    }
    guestQr.push({ label: expectedRow.label, tableId: expectedRow.id, token: body.token.trim() });
  }

  // 6. Endpoints de negocio una vez (fail-fast): workspace, kitchen, cash, ventas.
  const wsRes = http.get(`${API_URL}/v1/staff/restaurants/${encodeURIComponent(restaurantId)}/service-workspace`, {
    headers: waiterHeaders,
    tags: { kind: 'preflight', endpoint: 'service-workspace' },
  });
  expectStatus(wsRes, 200, 'preflight workspace');
  const ws = parseJsonOrFail(wsRes, 'preflight workspace');
  if (!Array.isArray(ws.tasks) || !Array.isArray(ws.accounts) || typeof ws.restaurantId !== 'string') {
    failClosed('preflight workspace: faltan tasks/accounts/restaurantId.');
  }
  if (ws.restaurantId !== restaurantId) {
    failClosed('preflight workspace: restaurantId mismatch.');
  }

  const kitchenRes = http.get(
    `${API_URL}/v1/staff/restaurants/${encodeURIComponent(restaurantId)}/kitchen-orders`,
    { headers: waiterHeaders, tags: { kind: 'preflight', endpoint: 'kitchen-orders' } }
  );
  expectStatus(kitchenRes, 200, 'preflight kitchen');
  const kitchen = parseJsonOrFail(kitchenRes, 'preflight kitchen');
  if (!Array.isArray(kitchen.orders)) {
    failClosed('preflight kitchen: falta orders[].');
  }

  const cashRes = http.get(
    `${API_URL}/v1/staff/restaurants/${encodeURIComponent(restaurantId)}/cash-orders`,
    { headers: waiterHeaders, tags: { kind: 'preflight', endpoint: 'cash-orders' } }
  );
  expectStatus(cashRes, 200, 'preflight cash');
  const cash = parseJsonOrFail(cashRes, 'preflight cash');
  if (!Array.isArray(cash.orders) || !Array.isArray(cash.accounts)) {
    failClosed('preflight cash: faltan orders[]/accounts[].');
  }

  const salesRes = http.get(
    `${API_URL}/v1/admin/restaurants/${encodeURIComponent(restaurantId)}/sales/summary?period=TODAY`,
    { headers: managerHeaders, tags: { kind: 'preflight', endpoint: 'sales-summary' } }
  );
  expectStatus(salesRes, 200, 'preflight sales');
  const sales = parseJsonOrFail(salesRes, 'preflight sales');
  if (sales.restaurantId !== restaurantId || typeof sales.period !== 'string' || sales.unit !== 'ARS_MINOR') {
    failClosed('preflight sales: resumen sin restaurantId/period/unit ARS_MINOR.');
  }

  const runId = `e22-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

  return {
    apiUrl: API_URL,
    restaurantSlug: RESTAURANT_SLUG,
    restaurantId,
    waiterToken: waiter.token,
    managerToken: manager.token,
    menuItemId,
    menuItemPrice,
    guestLabels: guestLabels.map((l) => {
      const row = byLabel.get(l) || byLabel.get(l.toLowerCase());
      return row.label;
    }),
    guestQr,
    flowTables,
    flowEnabled: FLOW_ENABLED,
    durationS: PROFILE_DURATION_S,
    runId,
  };
}

// ---------------------------------------------------------------------------
// Lectores: endpoints de negocio reales con validacion semantica (no solo status)
// ---------------------------------------------------------------------------
function authHeaders(token, vu, iter, prefix) {
  return {
    Authorization: `Bearer ${token}`,
    'x-correlation-id': `k6-${prefix}-${vu}-${iter}`,
  };
}

function checkJsonArray(res, field) {
  let body = null;
  try {
    body = res.json();
  } catch (_) {
    return { ok: false, body: null };
  }
  const val = body ? body[field] : undefined;
  return { ok: Array.isArray(val), body };
}

export function guestRead(data) {
  const vu = __VU;
  const iter = __ITER;
  const labels = data.guestLabels || [];
  if (labels.length === 0) {
    fail(`E22 fail-closed: sin mesas lectoras en data (escenario ${exec.scenario.name}).`);
  }
  const label = labels[(vu - 1 + iter) % labels.length];
  const qrEntry = (data.guestQr || []).find((e) => e.label === label);
  if (!qrEntry) {
    fail(`E22 fail-closed: mesa lectora sin token de preflight: "${label}".`);
  }

  group('lectura comensal: menu + sesion QR', () => {
    const menuRes = pollGet(
      `${data.apiUrl}/v1/restaurants/${encodeURIComponent(data.restaurantSlug)}/menu`,
      { 'x-correlation-id': `k6-guest-menu-${vu}-${iter}` },
      'menu'
    );
    let menuOk = menuRes.status === 200;
    let menuBody = null;
    if (menuOk) {
      try {
        menuBody = menuRes.json();
        menuOk =
          !!menuBody.restaurant &&
          Array.isArray(menuBody.categories) &&
          menuBody.categories.some((c) => Array.isArray(c.items) && c.items.some((i) => i && i.isAvailable === true));
      } catch (_) {
        menuOk = false;
      }
    }
    const c1 = check(menuRes, { 'menu 200 + estructura real': () => menuOk });
    recordSemantic(c1 && menuOk, 'menu');
    if (!menuOk) {
      return;
    }

    const qrRes = pollGet(
      `${data.apiUrl}/v1/sessions/${encodeURIComponent(data.restaurantSlug)}/${encodeURIComponent(label)}`,
      { 'x-correlation-id': `k6-guest-qr-${vu}-${iter}` },
      'session-qr'
    );
    let qrOk = qrRes.status === 200;
    let currentGuestToken = qrEntry ? qrEntry.token : null;
    if (qrOk) {
      try {
        const b = qrRes.json();
        qrOk =
          b.valid === true &&
          typeof b.token === 'string' &&
          b.token.length > 0 &&
          b.restaurant?.id === data.restaurantId &&
          b.table?.id === qrEntry?.tableId &&
          b.table?.label === label;
        if (qrOk) currentGuestToken = b.token;
      } catch (_) {
        qrOk = false;
      }
    }
    // 404 nunca es PASS.
    const c2 = check(qrRes, {
      'qr 200 + valid===true + token': () => qrOk,
      'qr nunca 404': (r) => r.status !== 404,
    });
    recordSemantic(c2 && qrOk, 'session-qr');
    if (!qrOk) return;

    // Orden activa del comensal (token QR del preflight, round-robin).
    const guestToken = currentGuestToken;
    if (!guestToken) {
      recordSemantic(false, 'guest-order');
      return;
    }
    const orderRes = pollGet(`${data.apiUrl}/v1/orders/session/${encodeURIComponent(guestToken)}`, {
      'x-correlation-id': `k6-guest-order-${vu}-${iter}`,
    }, 'guest-order');
    // La sesión puede no tener comanda aún, pero el endpoint devuelve 200 con
    // `order: null` y la cuenta/historial de la sesión. Un 404 no es una
    // ausencia válida de pedido: es un fallo de sesión/tenant y no se acepta.
    let orderOk = orderRes.status === 200;
    if (orderOk) {
      try {
        const b = orderRes.json();
        const order = b.order;
        orderOk =
          b.account &&
          typeof b.account.tableSessionId === 'string' &&
          b.account.tableSessionId.length > 0 &&
          Array.isArray(b.history) &&
          typeof b.allowOrdering === 'boolean' &&
          typeof b.requireWaiterValidation === 'boolean' &&
          (order === null ||
            (typeof order?.id === 'string' &&
              typeof order?.tableSessionId === 'string' &&
              order.tableSessionId === b.account.tableSessionId &&
              typeof order?.status === 'string' &&
              Array.isArray(order?.items)));
      } catch (_) {
        orderOk = false;
      }
    }
    const c3 = check(orderRes, { 'orden activa: 200 + cuenta/historial coherentes': () => orderOk });
    recordSemantic(c3 && orderOk, 'guest-order');
  });

  sleep(4); // pacing de lectura, no sincronizacion
}

export function salonRead(data) {
  const vu = __VU;
  const iter = __ITER;
  group('salon: workspace unificado', () => {
    const res = pollGet(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/service-workspace`,
      authHeaders(data.waiterToken, vu, iter, 'salon'),
      'service-workspace'
    );
    let ok = res.status === 200;
    if (ok) {
      try {
        const b = res.json();
        ok = b.restaurantId === data.restaurantId && Array.isArray(b.tasks) && Array.isArray(b.accounts);
      } catch (_) {
        ok = false;
      }
    }
    const c = check(res, { 'workspace 200 + tasks/accounts + tenant': () => ok });
    recordSemantic(c && ok, 'service-workspace');
  });
  sleep(2.5); // pacing de polling
}

export function kitchenRead(data) {
  const vu = __VU;
  const iter = __ITER;
  group('cocina: kitchen-orders', () => {
    const res = pollGet(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/kitchen-orders`,
      authHeaders(data.waiterToken, vu, iter, 'kitchen'),
      'kitchen-orders'
    );
    let ok = res.status === 200;
    if (ok) {
      const parsed = checkJsonArray(res, 'orders');
      ok = parsed.ok;
      if (ok) {
        // Estructura por fila cuando hay comandas (id/tableId/status/items).
        for (const o of parsed.body.orders.slice(0, 5)) {
          if (typeof o.id !== 'string' || typeof o.status !== 'string' || !Array.isArray(o.items)) {
            ok = false;
            break;
          }
        }
      }
    }
    const c = check(res, { 'kitchen 200 + orders[] con identidad': () => ok });
    recordSemantic(c && ok, 'kitchen-orders');
  });
  sleep(2); // pacing de polling
}

export function cashRead(data) {
  const vu = __VU;
  const iter = __ITER;
  group('caja: cash-orders + resumen ventas', () => {
    const cashRes = pollGet(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/cash-orders`,
      authHeaders(data.waiterToken, vu, iter, 'cash'),
      'cash-orders'
    );
    let cashOk = cashRes.status === 200;
    if (cashOk) {
      try {
        const b = cashRes.json();
        cashOk = Array.isArray(b.orders) && Array.isArray(b.accounts);
      } catch (_) {
        cashOk = false;
      }
    }
    const c1 = check(cashRes, { 'cash 200 + orders[]/accounts[]': () => cashOk });
    recordSemantic(c1 && cashOk, 'cash-orders');
    if (!cashOk) return;

    const salesRes = pollGet(
      `${data.apiUrl}/v1/admin/restaurants/${encodeURIComponent(data.restaurantId)}/sales/summary?period=TODAY`,
      authHeaders(data.managerToken, vu, iter, 'sales'),
      'sales-summary'
    );
    let salesOk = salesRes.status === 200;
    if (salesOk) {
      try {
        const b = salesRes.json();
        salesOk =
          b.restaurantId === data.restaurantId &&
          typeof b.period === 'string' &&
          b.unit === 'ARS_MINOR' &&
          Number.isFinite(b.consumoConfirmadoMinor);
      } catch (_) {
        salesOk = false;
      }
    }
    const c2 = check(salesRes, { 'ventas 200 + resumen ARS_MINOR': () => salesOk });
    recordSemantic(c2 && salesOk, 'sales-summary');
  });
  sleep(5); // pacing de lectura
}

// ---------------------------------------------------------------------------
// Flujo mutante opt-in: crear -> listo -> entregado -> cobro/cierre ->
// limpieza -> conciliacion. Falla una accion => check fallido + return.
// ---------------------------------------------------------------------------
function failIteration(endpoint, label) {
  flowFailed.add(1, { endpoint, label });
}

export function businessFlow(data) {
  const vu = __VU;
  const iter = __ITER;
  if (!data.flowEnabled) {
    fail('E22 fail-closed: businessFlow invocado sin K6_BUSINESS_FLOW=true.');
  }
  const flowTables = data.flowTables || [];
  if (flowTables.length === 0) {
    fail('E22 fail-closed: sin mesas de flujo en data.');
  }
  // Una mesa por VU (round-robin estable por VU, no por iteracion, para no
  // mezclar ocupaciones entre VUs concurrentes).
  const slot = flowTables[(vu - 1) % flowTables.length];
  const tableId = slot.id;
  const runId = data.runId || 'e22-norun';
  const idemBase = `${runId}-vu${vu}-iter${iter}`;
  const waiterH = authHeaders(data.waiterToken, vu, iter, 'flow-waiter');
  const managerH = authHeaders(data.managerToken, vu, iter, 'flow-manager');
  const jsonH = (h) => ({ ...h, 'Content-Type': 'application/json' });

  let orderId = null;
  let tableSessionId = null;

  group('flujo negocio: crear pedido presencial', () => {
    const res = http.post(
      `${data.apiUrl}/v1/staff/tables/${encodeURIComponent(tableId)}/orders`,
      JSON.stringify({ lines: [{ menuItemId: data.menuItemId, quantity: 1 }] }),
      { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'create-order' } }
    );
    observeBusiness(res, 'create-order');
    let ok = res.status === 201;
    if (ok) {
      try {
        const b = res.json();
        ok =
          typeof b.id === 'string' &&
          b.id.length > 0 &&
          typeof b.tableSessionId === 'string' &&
          b.tableSessionId.length > 0 &&
          Number(b.totalAmount) > 0 &&
          b.status === 'IN_KITCHEN';
        if (ok) {
          orderId = b.id;
          tableSessionId = b.tableSessionId;
        }
      } catch (_) {
        ok = false;
      }
    }
    const c = check(res, { 'pedido 201 + id/sesion/importe/IN_KITCHEN': () => ok });
    recordSemantic(c && ok, 'create-order');
    if (!ok || !orderId) {
      failIteration('create-order', 'crear pedido');
      return;
    }
  });
  if (!orderId) return;

  group('flujo negocio: preparar + replay idempotente', () => {
    const url = `${data.apiUrl}/v1/staff/service/tasks/ORDER_PREPARATION/${encodeURIComponent(orderId)}/act`;
    const payload = JSON.stringify({ action: 'COMPLETE' });
    const first = http.post(url, payload, { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'order-preparation' } });
    observeBusiness(first, 'order-preparation');
    let ok1 = first.status === 200;
    if (ok1) {
      try {
        ok1 = first.json().status === 'READY_TO_SERVE';
      } catch (_) {
        ok1 = false;
      }
    }
    const c1 = check(first, { 'preparacion -> READY_TO_SERVE': () => ok1 });
    recordSemantic(c1 && ok1, 'order-preparation');
    if (!ok1) {
      failIteration('order-preparation', 'preparar');
      orderId = null;
      return;
    }
    const replay = http.post(url, payload, { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'order-preparation-replay' } });
    observeBusiness(replay, 'order-preparation-replay');
    let ok2 = replay.status === 200;
    if (ok2) {
      try {
        const b = replay.json();
        ok2 = b.status === 'READY_TO_SERVE' && b.idempotentReplay === true;
      } catch (_) {
        ok2 = false;
      }
    }
    const c2 = check(replay, { 'preparacion replay idempotente': () => ok2 });
    recordSemantic(c2 && ok2, 'order-preparation-replay');
    if (!ok2) {
      failIteration('order-preparation-replay', 'replay preparar');
      orderId = null;
      return;
    }
  });
  if (!orderId) return;

  group('flujo negocio: entregar + replay idempotente', () => {
    const url = `${data.apiUrl}/v1/staff/service/tasks/ORDER_DELIVERY/${encodeURIComponent(orderId)}/act`;
    const payload = JSON.stringify({ action: 'COMPLETE' });
    const first = http.post(url, payload, { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'order-delivery' } });
    observeBusiness(first, 'order-delivery');
    let ok1 = first.status === 200;
    if (ok1) {
      try {
        ok1 = first.json().status === 'SERVED';
      } catch (_) {
        ok1 = false;
      }
    }
    const c1 = check(first, { 'entrega -> SERVED': () => ok1 });
    recordSemantic(c1 && ok1, 'order-delivery');
    if (!ok1) {
      failIteration('order-delivery', 'entregar');
      orderId = null;
      return;
    }
    const replay = http.post(url, payload, { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'order-delivery-replay' } });
    observeBusiness(replay, 'order-delivery-replay');
    let ok2 = replay.status === 200;
    if (ok2) {
      try {
        const b = replay.json();
        ok2 = b.status === 'SERVED' && b.idempotentReplay === true;
      } catch (_) {
        ok2 = false;
      }
    }
    const c2 = check(replay, { 'entrega replay idempotente': () => ok2 });
    recordSemantic(c2 && ok2, 'order-delivery-replay');
    if (!ok2) {
      failIteration('order-delivery-replay', 'replay entregar');
      orderId = null;
      return;
    }
  });
  if (!orderId) return;

  let accountVersion = null;
  let saldoMinor = 0;

  group('flujo negocio: cuenta servida coherente', () => {
    const wsRes = http.get(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/service-workspace`,
      { headers: waiterH, tags: { kind: 'flow', endpoint: 'flow-workspace' } }
    );
    observeBusiness(wsRes, 'flow-workspace');
    let ok = wsRes.status === 200;
    if (ok) {
      try {
        const b = wsRes.json();
        const acc = (b.accounts || []).find((a) => a.tableSessionId === tableSessionId);
        ok =
          !!acc &&
          typeof acc.account.version === 'string' &&
          acc.account.version.length > 0 &&
          acc.account.saldoMinor > 0 &&
          acc.account.consumoMinor > 0 &&
          Array.isArray(acc.account.tandas) &&
          acc.account.tandas.some((t) => t.orderId === orderId && t.status === 'SERVED') &&
          acc.account.tandas.reduce((s, t) => s + (t.totalMinor || 0), 0) === acc.account.consumoMinor;
        if (ok) {
          accountVersion = acc.account.version;
          saldoMinor = acc.account.saldoMinor;
        }
      } catch (_) {
        ok = false;
      }
    }
    const c = check(wsRes, { 'cuenta servida + version + saldo + coherencia': () => ok });
    recordSemantic(c && ok, 'flow-workspace');
    if (!ok) {
      failIteration('flow-workspace', 'cuenta');
      orderId = null;
      return;
    }
    // Contrapartida caja: misma version/saldo para la sesion.
    const cashRes = http.get(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/cash-orders`,
      { headers: waiterH, tags: { kind: 'flow', endpoint: 'flow-cash' } }
    );
    observeBusiness(cashRes, 'flow-cash');
    let cashOk = cashRes.status === 200;
    if (cashOk) {
      try {
        const b = cashRes.json();
        const acc = (b.accounts || []).find((a) => a.tableSessionId === tableSessionId);
        cashOk = !!acc && acc.version === accountVersion && acc.saldoMinor === saldoMinor;
      } catch (_) {
        cashOk = false;
      }
    }
    const c2 = check(cashRes, { 'caja coincide version/saldo': () => cashOk });
    recordSemantic(c2 && cashOk, 'flow-cash');
    if (!cashOk) {
      failIteration('flow-cash', 'caja');
      orderId = null;
      return;
    }
  });
  if (!orderId || !accountVersion || !(saldoMinor > 0)) return;

  const settleKey = `e22-settle-${idemBase}`;
  const settlePayload = {
    method: 'WAITER_CASH',
    amountMinor: saldoMinor,
    expectedAccountVersion: accountVersion,
    idempotencyKey: settleKey,
  };

  group('flujo negocio: settle-and-close + replay', () => {
    const url = `${data.apiUrl}/v1/staff/sessions/${encodeURIComponent(tableSessionId)}/settle-and-close`;
    const first = http.post(url, JSON.stringify(settlePayload), {
      headers: jsonH(managerH),
      tags: { kind: 'flow', endpoint: 'settle-and-close' },
    });
    observeBusiness(first, 'settle-and-close');
    let ok1 = first.status === 201;
    let firstSettlementId = null;
    if (ok1) {
      try {
        const b = first.json();
        ok1 =
          b.closed === true &&
          b.account &&
          b.account.saldoMinor === 0 &&
          b.settlement &&
          typeof b.settlement.id === 'string';
        if (ok1) firstSettlementId = b.settlement.id;
      } catch (_) {
        ok1 = false;
      }
    }
    const c1 = check(first, { 'cierre 201 + saldo 0 + settlement': () => ok1 });
    recordSemantic(c1 && ok1, 'settle-and-close');
    if (!ok1) {
      failIteration('settle-and-close', 'cobro/cierre');
      orderId = null;
      return;
    }
    const replay = http.post(url, JSON.stringify(settlePayload), {
      headers: jsonH(managerH),
      tags: { kind: 'flow', endpoint: 'settle-replay' },
    });
    observeBusiness(replay, 'settle-replay');
    let ok2 = replay.status === 200;
    if (ok2) {
      try {
        const b = replay.json();
        ok2 = b.idempotentReplay === true && b.closed === true && b.settlement && b.settlement.id === firstSettlementId;
      } catch (_) {
        ok2 = false;
      }
    }
    const c2 = check(replay, { 'cierre replay sin duplicar': () => ok2 });
    recordSemantic(c2 && ok2, 'settle-replay');
    if (!ok2) {
      failIteration('settle-replay', 'replay cierre');
      orderId = null;
      return;
    }
  });
  if (!orderId) return;

  group('flujo negocio: limpieza a AVAILABLE', () => {
    const res = http.post(
      `${data.apiUrl}/v1/tables/${encodeURIComponent(tableId)}/state/tap`,
      JSON.stringify({ action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'TO_CLEAN' }),
      { headers: jsonH(waiterH), tags: { kind: 'flow', endpoint: 'table-clean' } }
    );
    observeBusiness(res, 'table-clean');
    let ok = res.status === 200;
    if (ok) {
      try {
        const b = res.json();
        ok = b.success === true && (b.newState === 'AVAILABLE' || b.currentState === 'AVAILABLE');
      } catch (_) {
        ok = false;
      }
    }
    const c = check(res, { 'mesa AVAILABLE tras TO_CLEAN': () => ok });
    recordSemantic(c && ok, 'table-clean');
    if (!ok) {
      failIteration('table-clean', 'limpieza');
      orderId = null;
      return;
    }
  });
  if (!orderId) return;

  group('flujo negocio: conciliacion final', () => {
    const cashRes = http.get(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/cash-orders`,
      { headers: waiterH, tags: { kind: 'flow', endpoint: 'reconcile-cash' } }
    );
    observeBusiness(cashRes, 'reconcile-cash');
    let cashGone = cashRes.status === 200;
    if (cashGone) {
      try {
        const b = cashRes.json();
        const inOrders = (b.orders || []).some((o) => o.id === orderId || o.tableSessionId === tableSessionId);
        const inAccounts = (b.accounts || []).some((a) => a.tableSessionId === tableSessionId);
        cashGone = !inOrders && !inAccounts;
      } catch (_) {
        cashGone = false;
      }
    }
    const kitchenRes = http.get(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/kitchen-orders`,
      { headers: waiterH, tags: { kind: 'flow', endpoint: 'reconcile-kitchen' } }
    );
    observeBusiness(kitchenRes, 'reconcile-kitchen');
    let kitchenGone = kitchenRes.status === 200;
    if (kitchenGone) {
      try {
        kitchenGone = !kitchenRes.json().orders.some((o) => o.id === orderId);
      } catch (_) {
        kitchenGone = false;
      }
    }
    const tablesRes = http.get(`${data.apiUrl}/v1/restaurants/${encodeURIComponent(data.restaurantId)}/tables`, {
      headers: waiterH,
      tags: { kind: 'flow', endpoint: 'reconcile-tables' },
    });
    observeBusiness(tablesRes, 'reconcile-tables');
    let tableFree = tablesRes.status === 200;
    if (tableFree) {
      try {
        const list = Array.isArray(tablesRes.json()) ? tablesRes.json() : tablesRes.json().tables;
        const row = list.find((t) => t.id === tableId);
        tableFree = !!row && row.currentState === 'AVAILABLE';
      } catch (_) {
        tableFree = false;
      }
    }
    const wsRes = http.get(
      `${data.apiUrl}/v1/staff/restaurants/${encodeURIComponent(data.restaurantId)}/service-workspace`,
      { headers: waiterH, tags: { kind: 'flow', endpoint: 'reconcile-workspace' } }
    );
    observeBusiness(wsRes, 'reconcile-workspace');
    let wsGone = wsRes.status === 200;
    if (wsGone) {
      try {
        const b = wsRes.json();
        wsGone =
          !(b.accounts || []).some((a) => a.tableSessionId === tableSessionId) &&
          !(b.tasks || []).some((t) => t.targetId === orderId);
      } catch (_) {
        wsGone = false;
      }
    }
    const allOk = cashGone && kitchenGone && tableFree && wsGone;
    const c = check({ cashGone, kitchenGone, tableFree, wsGone }, {
      'conciliacion: sesion fuera de caja/cocina/workspace + mesa libre': () => allOk,
    });
    recordSemantic(c && allOk, 'reconciliation');
    if (allOk) {
      flowCompleted.add(1, { scenario: 'business_flow' });
      reconciledOk.add(1, { scenario: 'business_flow' });
    } else {
      failIteration('reconciliation', 'conciliacion');
    }
  });
}

// Dispatcher de seguridad: si una corrida usa el default sin exec explicito,
// enruta por nombre de escenario; escenario desconocido aborta (fail-closed).
export default function (data) {
  const name = exec.scenario.name;
  if (name === 'guest_readers') return guestRead(data);
  if (name === 'salon_poll') return salonRead(data);
  if (name === 'kitchen_poll') return kitchenRead(data);
  if (name === 'cash_poll') return cashRead(data);
  if (name === 'business_flow') return businessFlow(data);
  fail(`E22 fail-closed: escenario desconocido "${name}".`);
}
