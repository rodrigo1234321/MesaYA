#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/sanitize-k6-summary.mjs <summary.json>');
  process.exit(2);
}

const absolute = path.resolve(file);
const summary = JSON.parse(fs.readFileSync(absolute, 'utf8'));
// k6 puede incluir tokens en setup_data; reemplazar todo el objeto evita
// transportar credenciales aunque el perfil cambie sus campos internos.
summary.setup_data = { redacted: true };
fs.writeFileSync(absolute, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const values = (name) => summary.metrics?.[name]?.values || {};
const safe = (name, key) => values(name)[key] ?? 'NA';
const label = path.basename(absolute);
console.log(`K6_SUMMARY_SANITIZED=${label}`);
console.log(`K6_HTTP_REQS=${safe('http_reqs', 'count')}`);
console.log(`K6_POLLING_REQUESTS=${safe('polling_requests', 'count')}`);
console.log(`K6_BUSINESS_CHECK_PASS_RATE=${safe('business_check_pass', 'rate')}`);
console.log(`K6_BUSINESS_ERROR_RATE=${safe('business_error_rate', 'rate')}`);
console.log(`K6_BUSINESS_P95_MS=${safe('business_latency_ms', 'p(95)')}`);
console.log(`K6_FLOW_COMPLETED=${safe('business_flow_completed', 'count')}`);
console.log(`K6_RECONCILIATION_OK=${safe('business_reconciliation_ok', 'count')}`);
