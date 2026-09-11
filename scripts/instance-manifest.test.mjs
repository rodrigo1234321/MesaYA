import test from 'node:test';
import assert from 'node:assert/strict';
import example from '../deploy/instance.example.json' with { type: 'json' };
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
