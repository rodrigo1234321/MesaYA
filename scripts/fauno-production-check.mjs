// Read-only smoke/latency evidence. Supply pilot PINs via environment, never files.
import { performance } from 'node:perf_hooks';

const base = process.env.FAUNO_API_URL || 'https://fauno-olavarria-api.vercel.app';
const slug = 'fauno-olavarria';
const observations = [];
async function request(path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  observations.push({ path, status: response.status, ms: Math.round(performance.now() - started) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return body;
}
try {
  if (!process.env.FAUNO_ADMIN_PIN || !process.env.FAUNO_STAFF_PIN) throw new Error('Set FAUNO_ADMIN_PIN and FAUNO_STAFF_PIN');
  const login = async (path, pin) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantSlug: slug, pin }) });
  const admin = await login('/v1/auth/login-admin', process.env.FAUNO_ADMIN_PIN);
  const staff = await login('/v1/staff/login', process.env.FAUNO_STAFF_PIN);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const staffHeaders = { Authorization: `Bearer ${staff.token}` };
  const restaurantId = staff.staffUser.restaurantId;
  const tables = await request(`/v1/restaurants/${slug}/tables`, { headers });
  for (let i = 0; i < 3; i++) {
    await request('/health');
    await request(`/v1/restaurants/${slug}/tables`, { headers });
    await request(`/v1/floor-plan/${slug}`, { headers });
    await request(`/v1/staff/restaurants/${restaurantId}/service-workspace`, { headers: staffHeaders });
  }
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), base, restaurantId, tables: tables.map(t => ({ id: t.id, label: t.label, sector: t.sector })), observations }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: error.message, observations }, null, 2));
  process.exitCode = 1;
}
