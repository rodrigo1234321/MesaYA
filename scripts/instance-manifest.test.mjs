import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import example from '../deploy/instance.example.json' with { type: 'json' };
import faunoOlavarria from '../deploy/instance.fauno-olavarria.plan.json' with { type: 'json' };
import { validateInstanceManifest } from './instance-manifest.mjs';

test('instance manifest example is valid', () => {
  assert.deepEqual(validateInstanceManifest(example), { ok: true, errors: [] });
});

test('production requires HTTPS domains', () => {
  const candidate = structuredClone(example);
  candidate.domains.client = 'http://mesa.example.com';
  const result = validateInstanceManifest(candidate, { production: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('domains.client')));
});

test('manifest rejects embedded secrets', () => {
  const candidate = structuredClone(example);
  candidate.deployment.databaseUrl = 'postgresql://user:password@host/db';
  const result = validateInstanceManifest(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('databaseUrl')));
});

test('pre-order requires waitlist and every Vercel project is declared', () => {
  const candidate = structuredClone(example);
  candidate.modules.preOrder = true;
  candidate.modules.waitlist = false;
  candidate.deployment.vercelProjects.admin = '';
  const result = validateInstanceManifest(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('modules.preOrder')));
  assert.ok(result.errors.some((error) => error.includes('vercelProjects.admin')));
});

test('local override requires an isolated branch and commit', () => {
  const candidate = structuredClone(example);
  candidate.customization.mode = 'LOCAL_OVERRIDE';
  candidate.customization.overrideBranch = '';
  candidate.customization.overrideCommit = '';
  const result = validateInstanceManifest(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('overrideBranch')));
  assert.ok(result.errors.some((error) => error.includes('overrideCommit')));
});

test('provision plan with splitBill:true requires no Mercado Pago (E05 presencial)', () => {
  assert.equal(faunoOlavarria.modules.splitBill, true);
  const scriptPath = fileURLToPath(new URL('./provision-instance-plan.mjs', import.meta.url));
  const manifestPath = fileURLToPath(new URL('../deploy/instance.fauno-olavarria.plan.json', import.meta.url));
  const output = execFileSync(process.execPath, [scriptPath, manifestPath], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.remoteMutationPerformed, false);
  assert.match(plan.externalDependencies.mercadoPago, /no requerido/i);
  assert.equal(/sandbox|webhook|credencial/i.test(plan.externalDependencies.mercadoPago), false);
  assert.equal(plan.steps.some((step) => /mercado\s?pago|mercadopago|sandbox|webhook/i.test(step)), false);
  assert.equal(plan.steps.some((step) => /presencial/i.test(step) && /E05/i.test(step)), true);
});

test('base manifest is instance-neutral and carries no Fauno/demo URL by accident', () => {
  const serialized = JSON.stringify(example).toLowerCase();
  assert.equal(example.customization.mode, 'BASE_RELEASE');
  assert.equal(example.customization.overrideBranch, '');
  assert.equal(example.customization.overrideCommit, '');
  assert.equal(serialized.includes('fauno'), false);
  assert.equal(serialized.includes('olavarria'), false);
  for (const domain of Object.values(example.domains)) {
    assert.match(domain, /^https:\/\//);
    assert.equal(domain.includes('fauno'), false);
  }
});
