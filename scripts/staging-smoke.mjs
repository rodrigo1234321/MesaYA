// Read-only checks against a deployed pilot. Never seeds, migrates or places orders.
import fs from 'node:fs';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Uso: node scripts/staging-smoke.mjs <config.json>');
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || /localhost|example\.|\.invalid$/.test(url.hostname)) {
    throw new Error('Configurá orígenes HTTPS reales, sin path ni barra final.');
  }
  return url.origin;
}
const api = origin(config.api);
const frontends = ['client', 'staff', 'admin'].map(key => origin(config[key]));
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.slug) || !Array.isArray(config.tables) || !config.tables.length || config.tables.some(t => typeof t !== 'string' || !t.trim())) {
  throw new Error('Configurá slug y etiquetas reales de mesa.');
}
let failures = 0;
async function check(label, task) {
  try { await task(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
}
async function request(url, init = {}) {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
}
for (const route of ['/health', '/v1/health']) {
  await check(route, async () => {
    const response = await request(api + route);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}; revisar protección de Vercel y runtime.`);
    const body = await response.json();
    if (body.status !== 'ok' || body.database !== 'connected') throw new Error('API o base no disponibles.');
  });
}
for (const frontend of frontends) {
  await check(`HTML ${frontend}`, async () => {
    const response = await request(frontend);
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`HTTP ${response.status}, se esperaba HTML público.`);
  });
  await check(`CORS ${frontend}`, async () => {
    const response = await request(api + '/v1/health', { method: 'OPTIONS', headers: {
      Origin: frontend, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type'
    } });
    if (![200, 204].includes(response.status) || response.headers.get('access-control-allow-origin') !== frontend || response.headers.get('access-control-allow-credentials') !== 'true') throw new Error('Preflight rechazado o cabeceras CORS incorrectas.');
  });
}
await check('CORS rechaza origen ajeno', async () => {
  const response = await request(api + '/v1/health', { headers: { Origin: 'https://untrusted.invalid' } });
  if (response.headers.has('access-control-allow-origin')) throw new Error('Se permite un origen no configurado.');
});
for (const label of config.tables) {
  await check(`Mesa ${label}`, async () => {
    const response = await request(`${api}/v1/sessions/${encodeURIComponent(config.slug)}/${encodeURIComponent(label)}`);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.restaurant?.slug !== config.slug || body.table?.label !== label) throw new Error('El enlace no resuelve al local y mesa esperados.');
    // No imprimir token: una mesa abierta puede devolver la sesión vigente.
  });
  await check(`Ruta física ${label}`, async () => {
    const response = await request(`${frontends[0]}/r/${config.slug}/mesa/${encodeURIComponent(label)}`);
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Falla rewrite SPA o protección del sitio.');
  });
}
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} smoke HTTP; la aceptación con celulares se realiza por separado.`);
process.exitCode = failures ? 1 : 0;
