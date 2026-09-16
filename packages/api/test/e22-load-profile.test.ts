import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * E22 — perfil k6 fail-closed y contrato estatico (S08/S28).
 *
 * Cubre invariantes de seguridad y semantica del unico perfil canonico
 * tests/load/pilot-profile.js + scripts/check-load-profile.mjs, sin levantar
 * carga real ni depender de secretos. No ejecuta k6.
 */
describe('E22 — perfil de carga fail-closed (S28)', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const profile = readFileSync(resolve(repoRoot, 'tests/load/pilot-profile.js'), 'utf8');
  const checker = readFileSync(resolve(repoRoot, 'scripts/check-load-profile.mjs'), 'utf8');
  const readme = readFileSync(resolve(repoRoot, 'tests/load/README.md'), 'utf8');

  describe('preflight fail-closed, sin defaults ni secretos', () => {
    it('exige API_URL, RESTAURANT_SLUG y PINs por entorno', () => {
      for (const name of ['API_URL', 'RESTAURANT_SLUG', 'WAITER_PIN', 'MANAGER_PIN']) {
        expect(profile).toContain(`requiredEnv('${name}')`);
      }
    });

    it('no deja PINs ni URL de demo por defecto', () => {
      expect(profile).not.toMatch(/\|\|\s*['"]http:\/\/localhost:3000['"]/);
      expect(profile).not.toMatch(/WAITER_PIN\s*\|\|\s*['"]/);
      expect(profile).not.toMatch(/MANAGER_PIN\s*\|\|\s*['"]/);
      expect(profile).not.toMatch(/RESTAURANT_SLUG\s*\|\|\s*['"]/);
      expect(profile).not.toContain("'1234'");
      expect(profile).not.toContain("'9999'");
      expect(profile).not.toContain("'trattoria-del-puerto'");
    });

    it('no traga errores de login ni imprime secretos', () => {
      expect(profile).not.toMatch(/catch\s*\(_?\)\s*\{\s*\}/);
      expect(profile).not.toMatch(/console\.log\([^)]*token[^)]*\)/i);
      expect(profile).not.toMatch(/console\.log\([^)]*PIN[^)]*\)/i);
      expect(profile).toContain('loginOrFail');
    });

    it('preflight setup/loginOrFail sin catches silenciosos; lectores a ok:false permitidos', () => {
      expect(checker).toMatch(/setup.*loginOrFail/s);
      expect(checker).toMatch(/catch/);
      expect(checker).toMatch(/ok:false/);
      expect(checker).toMatch(/preflight.*catch|catch.*preflight/i);
    });

    it('autentica mozo y manager y exige mismo restaurantId', () => {
      expect(profile).toContain('/v1/staff/login');
      expect(profile).toContain('restaurantId');
      expect(profile).toMatch(/mismo|distinto/);
    });
  });

  describe('negocio real, sin health/404 como PASS', () => {
    it('usa health solo como conectividad y exige 200 de negocio', () => {
      expect(profile).toContain('/v1/health');
      expect(profile).not.toContain('waiter health is 200');
      expect(profile).not.toContain('liveness is 200');
      expect(profile).not.toContain('kitchen health is 200');
      expect(profile).not.toMatch(/200 or 404/);
      expect(profile).not.toMatch(/orderRes\.status\s*===\s*200\s*\|\|\s*orderRes\.status\s*===\s*404/);
    });

    it('consulta menu con estructura y mesas con token de staff', () => {
      expect(profile).toContain('/menu');
      expect(profile).toContain('categories');
      expect(profile).toContain('isAvailable');
      expect(profile).toContain('/tables');
    });

    it('resuelve QR por ruta canonica y exige valid/token/pertenencia', () => {
      expect(profile).toContain('/v1/sessions/');
      expect(profile).toContain('valid === true');
      expect(profile).not.toMatch(/sessions\/\$\{[^}]*\}\/1['"`]/);
    });

    it('listas de mesas explicitas, sin asumir Mesa 1', () => {
      expect(profile).toContain('K6_GUEST_TABLE_LABELS');
      expect(profile).toContain('K6_FLOW_TABLE_LABELS');
    });

    it('carga de lectura con semantica: workspace, cocina, caja y ventas', () => {
      for (const ep of ['service-workspace', 'kitchen-orders', 'cash-orders', 'sales/summary']) {
        expect(profile).toContain(ep);
      }
      expect(profile).toContain('polling_requests');
      expect(profile).toContain("tags: { kind: 'poll'");
    });
  });

  describe('escenarios, metricas y umbrales como metas de prueba', () => {
    it('escenarios parametrizados con techo y duracion visible', () => {
      expect(profile).toContain('scenarios');
      expect(profile).toContain('K6_GUEST_VUS');
      expect(profile).toContain('K6_MAX_VUS');
      expect(profile).toContain('K6_DURATION_S');
      expect(profile).toContain('K6_FLOW_ITERATIONS');
      expect(profile).toContain('per-vu-iterations');
    });

    it('metricas de negocio y umbrales p50/p95/p99', () => {
      expect(profile).toContain('business_latency');
      expect(profile).toContain('business_check_pass');
      expect(profile).toContain('business_error_rate');
      expect(profile).toContain('p(50)');
      expect(profile).toContain('p(95)');
      expect(profile).toContain('p(99)');
      expect(profile).toContain('business_flow_completed');
      expect(profile).toContain('business_reconciliation_ok');
    });

    it('no declara capacidad certificada', () => {
      expect(profile).toMatch(/NO capacidad certificada|no una certificacion|metas de prueba/i);
    });
  });

  describe('flujo mutante opt-in, aislado e idempotente', () => {
    it('solo con K6_BUSINESS_FLOW=true y mesas disjuntas suficientes', () => {
      expect(profile).toContain('K6_BUSINESS_FLOW');
      expect(profile).toMatch(/disjuntas|overlap/);
      expect(profile).toMatch(/AVAILABLE/);
    });

    it('sigue rutas reales en orden con replay verificado', () => {
      expect(profile).toContain('/v1/staff/tables/');
      expect(profile).toContain('ORDER_PREPARATION');
      expect(profile).toContain('ORDER_DELIVERY');
      expect(profile).toContain('READY_TO_SERVE');
      expect(profile).toContain('SERVED');
      expect(profile).toContain('settle-and-close');
      expect(profile).toContain('state/tap');
      expect(profile).toContain('TO_CLEAN');
      expect(profile).toContain('idempotencyKey');
      expect(profile).toContain('idempotentReplay');
    });

    it('detiene la iteracion ante fallo sin reintento ciego', () => {
      expect(profile).toContain('if (!orderId) return;');
      expect(profile).toContain('failIteration');
      expect(profile).not.toMatch(/for\s*\(\s*let\s+attempt/);
      expect(profile).not.toMatch(/while\s*\(.*retry/i);
    });
  });

  describe('contrato estatico y documentacion operativa', () => {
    it('el checker cubre falsos PASS sin depender de k6', () => {
      expect(checker).toContain('pilot-profile.js');
      expect(checker).toContain('200 or 404');
      expect(checker).toContain('K6_BUSINESS_FLOW');
      expect(checker).toContain('polling_requests');
      expect(checker).not.toContain("from 'k6");
    });

    it('el README documenta variables, techo, comando y lectura', () => {
      for (const token of [
        'API_URL',
        'K6_GUEST_TABLE_LABELS',
        'K6_FLOW_TABLE_LABELS',
        'K6_BUSINESS_FLOW',
        '--summary-export',
        'p(95)',
        'polling_requests',
        'http_reqs.count',
        'cost_estimate',
        'tariff_per_1000_requests',
        'espera o atención humana',
        'aislado',
      ]) {
        expect(readme).toContain(token);
      }
      expect(readme).toMatch(/mutante cambia datos|cambia datos/i);
    });
  });
});
