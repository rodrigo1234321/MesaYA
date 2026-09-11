import fs from 'node:fs';

const SECRET_KEY_PATTERN = /(secret|password|token|access.?key|private.?key|database.?url|direct.?url)/i;
const SECRET_VALUE_PATTERN = /(postgres(?:ql)?(:|%3A)|bearer\s|sk_live_|access_token|BEGIN [A-Z ]+ PRIVATE KEY)/i;

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function walkForSecrets(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForSecrets(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
      errors.push(`${path} contiene un valor que parece secreto o una URL de base de datos`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(key)) errors.push(`${childPath} no puede estar en el manifiesto versionado`);
    walkForSecrets(child, childPath, errors);
  }
}

function isUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateInstanceManifest(manifest, { production = false } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['El manifiesto debe ser un objeto JSON.'] };
  }

  assert(manifest.schemaVersion === 1, 'schemaVersion debe ser 1.', errors);
  assert(typeof manifest.instanceKey === 'string' && /^[a-z0-9][a-z0-9-]{2,49}$/.test(manifest.instanceKey), 'instanceKey debe usar minúsculas, números y guiones (3–50 caracteres).', errors);
  assert(manifest.restaurant && typeof manifest.restaurant === 'object', 'Falta restaurant.', errors);
  assert(typeof manifest.restaurant?.slug === 'string' && /^[a-z0-9][a-z0-9-]{2,49}$/.test(manifest.restaurant.slug), 'restaurant.slug no es válido.', errors);
  assert(typeof manifest.restaurant?.name === 'string' && manifest.restaurant.name.trim().length >= 2, 'restaurant.name es obligatorio.', errors);
  assert(typeof manifest.restaurant?.timezone === 'string' && manifest.restaurant.timezone.includes('/'), 'restaurant.timezone debe ser una zona IANA.', errors);
  assert(typeof manifest.restaurant?.currency === 'string' && /^[A-Z]{3}$/.test(manifest.restaurant.currency), 'restaurant.currency debe ser ISO-4217 en mayúsculas.', errors);
  assert(manifest.domains && typeof manifest.domains === 'object', 'Falta domains.', errors);
  for (const domain of ['api', 'client', 'staff', 'admin']) {
    assert(isUrl(manifest.domains?.[domain]), `domains.${domain} debe ser una URL HTTP(S) sin credenciales.`, errors);
    if (production) assert(manifest.domains?.[domain]?.startsWith('https://'), `domains.${domain} debe usar HTTPS en producción.`, errors);
  }
  assert(manifest.modules && typeof manifest.modules === 'object' && !Array.isArray(manifest.modules), 'Falta modules como objeto.', errors);
  const requiredModules = ['ordering', 'waiterValidation', 'manualPayment', 'digitalPayment', 'splitBill', 'waitlist', 'preOrder', 'rewards', 'sommelier', 'upsell', 'reviews', 'whatsappFallback'];
  for (const moduleKey of requiredModules) {
    assert(typeof manifest.modules?.[moduleKey] === 'boolean', `modules.${moduleKey} debe ser booleano.`, errors);
  }
  if (manifest.modules?.preOrder === true) {
    assert(manifest.modules?.waitlist === true, 'modules.preOrder requiere modules.waitlist=true.', errors);
  }
  assert(manifest.deployment && typeof manifest.deployment === 'object', 'Falta deployment.', errors);
  assert(typeof manifest.deployment?.release === 'string' && manifest.deployment.release.trim().length > 0, 'deployment.release es obligatorio.', errors);
  assert(typeof manifest.deployment?.schema === 'string' && manifest.deployment.schema.trim().length > 0, 'deployment.schema es obligatorio.', errors);
  assert(manifest.deployment?.vercelProjects && typeof manifest.deployment.vercelProjects === 'object', 'deployment.vercelProjects es obligatorio.', errors);
  for (const projectKey of ['api', 'client', 'staff', 'admin']) {
    assert(typeof manifest.deployment?.vercelProjects?.[projectKey] === 'string' && manifest.deployment.vercelProjects[projectKey].trim().length > 0, `deployment.vercelProjects.${projectKey} es obligatorio.`, errors);
  }
  assert(manifest.customization && typeof manifest.customization === 'object' && !Array.isArray(manifest.customization), 'Falta customization como objeto.', errors);
  assert(['BASE_RELEASE', 'LOCAL_OVERRIDE'].includes(manifest.customization?.mode), 'customization.mode debe ser BASE_RELEASE o LOCAL_OVERRIDE.', errors);
  assert(typeof manifest.customization?.parentRelease === 'string' && manifest.customization.parentRelease.trim().length > 0, 'customization.parentRelease es obligatorio.', errors);
  for (const key of ['overrideBranch', 'overrideCommit']) {
    assert(typeof manifest.customization?.[key] === 'string', `customization.${key} debe ser texto.`, errors);
  }
  if (manifest.customization?.mode === 'LOCAL_OVERRIDE') {
    assert(manifest.customization?.overrideBranch.trim().length > 0, 'LOCAL_OVERRIDE requiere customization.overrideBranch.', errors);
    assert(manifest.customization?.overrideCommit.trim().length > 0, 'LOCAL_OVERRIDE requiere customization.overrideCommit.', errors);
  }
  walkForSecrets(manifest, '', errors);
  return { ok: errors.length === 0, errors };
}

export function readInstanceManifest(filePath, options) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const manifest = JSON.parse(raw);
  return { manifest, ...validateInstanceManifest(manifest, options) };
}
