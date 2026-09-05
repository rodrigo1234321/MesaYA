const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'packages', 'api', 'prisma', 'schema.prisma');
const destPath = path.join(__dirname, '..', 'packages', 'api', 'prisma', 'schema.supabase.prisma');

const POSTGRES_HEADER = `datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}`;

/** Normaliza saltos de línea CRLF/CR a LF para comparar sin falsos positivos en Windows. */
function normalizeLineEndings(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
}

function buildPostgresSchema(source) {
  return String(source).replace(/datasource db \{[\s\S]*?\}/, POSTGRES_HEADER);
}

function diffSchemas(expected, actual, maxLines = 8) {
  const expectedLines = normalizeLineEndings(expected).split('\n');
  const currentLines = normalizeLineEndings(actual || '').split('\n');
  const differences = [];
  const max = Math.max(expectedLines.length, currentLines.length);
  for (let i = 0; i < max && differences.length < maxLines; i += 1) {
    if (expectedLines[i] !== currentLines[i]) {
      differences.push(`línea ${i + 1}: esperado ${JSON.stringify(expectedLines[i] ?? '')}, actual ${JSON.stringify(currentLines[i] ?? '')}`);
    }
  }
  return differences;
}

function runCheck() {
  const content = fs.readFileSync(sourcePath, 'utf8');
  const updated = buildPostgresSchema(content);
  const current = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;
  // Comparación normalizada: CRLF vs LF no es diferencia semántica.
  if (current !== null && normalizeLineEndings(current) === normalizeLineEndings(updated)) {
    console.log('✅ schema.supabase.prisma está sincronizado con el schema canónico.');
    return 0;
  }
  const differences = diffSchemas(updated, current || '');
  console.error('❌ schema.supabase.prisma está desincronizado; no se escribió ningún archivo.');
  differences.forEach((line) => console.error(`   ${line}`));
  return 1;
}

function runSync() {
  const content = fs.readFileSync(sourcePath, 'utf8');
  const updated = buildPostgresSchema(content);
  fs.writeFileSync(destPath, updated, 'utf8');
  console.log('✅ schema.supabase.prisma successfully synchronized with full RTMS schema (' + updated.split('\n').length + ' lines).');
}

module.exports = {
  sourcePath,
  destPath,
  normalizeLineEndings,
  buildPostgresSchema,
  diffSchemas,
  runCheck,
  runSync,
};

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    process.exit(runCheck());
  } else {
    runSync();
  }
}
