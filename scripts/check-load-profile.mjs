#!/usr/bin/env node
/**
 * E22 — chequeo estatico del perfil k6 (sin k6 instalado).
 *
 * Falla si vuelven los falsos PASS: defaults de PIN/URL, fallback a health,
 * aceptacion de 404, falta de metricas/umbrales/flujo/preflight.
 * Salida breve y accionable; exit 0 = contrato estatico OK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = path.join(root, 'tests', 'load', 'pilot-profile.js');

const failures = [];
function fail(msg) {
  failures.push(msg);
}
function ok(cond, msg) {
  if (!cond) fail(msg);
}

let src = '';
try {
  src = fs.readFileSync(profilePath, 'utf8');
} catch (e) {
  console.error(`check-load-profile: FAIL — no se lee ${profilePath}: ${e.message}`);
  process.exit(1);
}

// 1. Sin defaults de demo para URL/PIN/slug.
ok(!/\|\|\s*['"]http:\/\/localhost:3000['"]/.test(src), 'tiene default API_URL localhost (fail-closed exige API_URL por entorno)');
ok(!/RESTAURANT_SLUG\s*\|\|\s*['"]/.test(src), 'tiene default RESTAURANT_SLUG (fail-closed exige entorno)');
ok(!/WAITER_PIN\s*\|\|\s*['"]/.test(src), 'tiene default WAITER_PIN (fail-closed exige entorno)');
ok(!/MANAGER_PIN\s*\|\|\s*['"]/.test(src), 'tiene default MANAGER_PIN (fail-closed exige entorno)');
ok(/requiredEnv\('API_URL'\)/.test(src), 'no exige API_URL por entorno');
ok(/requiredEnv\('RESTAURANT_SLUG'\)/.test(src), 'no exige RESTAURANT_SLUG por entorno');
ok(/requiredEnv\('WAITER_PIN'\)/.test(src), 'no exige WAITER_PIN por entorno');
ok(/requiredEnv\('MANAGER_PIN'\)/.test(src), 'no exige MANAGER_PIN por entorno');

// 2. Sin try/catch que convierta login en null; preflight exige 200 + token.
ok(!/catch\s*\(_?\)\s*\{\s*\}/.test(src), 'traga errores con catch vacio (convierte fallo en null)');
ok(/preflight login/.test(src) || /loginOrFail/.test(src), 'falta preflight de login mozo/manager');
ok(/restaurantId/.test(src) && /mismo|distinto/.test(src), 'no verifica mismo restaurantId mozo/manager');

// 2b. Frontera preflight/lectores: setup() y loginOrFail() no deben contener
// catches silenciosos que conviertan un fallo de preflight en PASS. Los catches
// de los lectores que convierten respuestas inválidas en ok:false siguen
// permitidos; esta regla protege explícitamente esa frontera.
function extractFunctionBody(source, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const m = re.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}
for (const fn of ['setup', 'loginOrFail']) {
  const body = extractFunctionBody(src, fn);
  ok(body !== null, `no se encontro funcion de preflight ${fn}() para auditar catches`);
  if (body) {
    ok(
      !/catch\s*\(/.test(body),
      `preflight ${fn}() contiene catch: el preflight no debe atrapar fallos (los lectores si pueden convertir respuestas invalidas en ok:false)`
    );
  }
}

// 3. Health solo conectividad, nunca sustituto de negocio.
ok(/\/v1\/health/.test(src), 'falta preflight de conectividad /v1/health');
ok(!/waiter health is 200|liveness is 200|kitchen health is 200/.test(src), 'usa /health como fallback de negocio');
const healthFallback = /if\s*\(\s*data\.waiterToken\s*\)[\s\S]{0,400}?\/v1\/health/.test(src);
ok(!healthFallback, 'rama sin token cae a /health en vez de abortar');

// 4. Sin aceptacion de 404; QR canonica; sin legacy ni Mesa 1 asumida.
ok(!/200 or 404/.test(src), 'acepta 404 como PASS (debe exigir 200 semantico)');
ok(!/orderRes\.status\s*===\s*200\s*\|\|\s*orderRes\.status\s*===\s*404/.test(src), 'acepta 404 para orden activa (debe exigir 200)');
ok(/\/v1\/sessions\//.test(src), 'falta resolucion QR canonica /v1/sessions/:slug/:tableLabel');
ok(!/sessions\/table|getOrCreateActiveDemoSession|ALLOW_LEGACY/.test(src), 'usa ruta legacy de sesion');
ok(/K6_GUEST_TABLE_LABELS/.test(src), 'falta lista lectora K6_GUEST_TABLE_LABELS');
ok(/K6_FLOW_TABLE_LABELS/.test(src), 'falta lista mutante K6_FLOW_TABLE_LABELS');
ok(!/sessions\/\$\{[^}]*\}\/1['"`]/.test(src), 'asume mesa "1" en QR');

// 5. Negocio real con semantica: menu, workspace, kitchen, cash, ventas.
for (const ep of ['/menu', 'service-workspace', 'kitchen-orders', 'cash-orders', 'sales/summary']) {
  ok(src.includes(ep), `falta endpoint de negocio ${ep}`);
}
ok(/categories/.test(src) && /isAvailable/.test(src), 'menu sin validacion de categories/item disponible');
ok(/valid\s*===\s*true/.test(src), 'QR sin exigir valid === true');

// 6. Escenarios parametrizados, VUs visibles, techo, duracion.
ok(/scenarios/.test(src), 'falta scenarios parametrizados');
ok(/K6_GUEST_VUS|K6_SALON_VUS|K6_KITCHEN_VUS|K6_CASH_VUS/.test(src), 'falta VUs visibles por entorno');
ok(/K6_MAX_VUS|techo seguro/.test(src), 'falta techo seguro de VUs');
ok(/K6_DURATION_S|duration/.test(src), 'falta duracion visible/registrada');
ok(/K6_FLOW_ITERATIONS/.test(src) && /per-vu-iterations/.test(src), 'flujo mutante sin limite explicito de iteraciones');
ok(/VUs cero|vus\s*<=\s*0|omit/.test(src), 'no omite explicitamente escenarios con VUs cero');

// 7. Metricas y umbrales p50/p95/p99 + errores.
ok(/business_latency/.test(src), 'falta metrica de latencia de negocio');
ok(/business_check_pass|business_errors|business_error_rate/.test(src), 'falta metrica de checks/errores de negocio');
ok(/polling_requests/.test(src), 'falta metrica explicita de polling');
ok(/p\(50\)|p\(95\)|p\(99\)/.test(src), 'faltan umbrales p50/p95/p99');
ok(/business_flow_completed/.test(src), 'falta exigir finalizacion del flujo mutante');
ok(/business_reconciliation_ok|reconciliation/.test(src), 'falta metrica/umbral de conciliacion');

// 8. Flujo mutante opt-in, aislado e idempotente.
ok(/K6_BUSINESS_FLOW/.test(src), 'falta opt-in K6_BUSINESS_FLOW');
ok(/ORDER_PREPARATION/.test(src) && /ORDER_DELIVERY/.test(src), 'flujo sin preparar/entregar por tasks/act');
ok(/settle-and-close/.test(src), 'flujo sin settle-and-close');
ok(/state\/tap/.test(src) && /AVAILABLE/.test(src) && /TO_CLEAN/.test(src), 'flujo sin limpieza skip_to AVAILABLE con TO_CLEAN esperado');
ok(/idempotencyKey/.test(src), 'flujo sin claves de idempotencia');
ok(/idempotentReplay/.test(src), 'flujo sin verificar replay idempotente');
ok(/disjuntas|disjoint|overlap/.test(src), 'flujo sin exigir listas disjuntas con lectores');

// 9. Seguridad: no imprime secretos.
ok(!/console\.log\([^)]*token[^)]*\)/i.test(src), 'registra tokens en consola');
ok(!/console\.log\([^)]*PIN[^)]*\)/i.test(src), 'registra PINs en consola');
ok(!/Authorization[^`]*\$\{[^}]*token/i.test(src.replace(/authHeaders|Bearer \$\{token\}/g, '')), 'interpola Authorization fuera de headers');

if (failures.length > 0) {
  console.error('check-load-profile: FAIL');
  for (const m of failures) console.error(` - ${m}`);
  process.exit(1);
}
console.log('check-load-profile: OK — perfil fail-closed (env exigido, QR canonica, negocio semantico, flujo opt-in, metricas/umbrales).');
