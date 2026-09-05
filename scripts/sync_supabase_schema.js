const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'packages', 'api', 'prisma', 'schema.prisma');
const destPath = path.join(__dirname, '..', 'packages', 'api', 'prisma', 'schema.supabase.prisma');

const checkOnly = process.argv.includes('--check');

const content = fs.readFileSync(sourcePath, 'utf8');

const postgresHeader = `datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}`;

const updated = content.replace(/datasource db \{[\s\S]*?\}/, postgresHeader);
const current = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;

if (checkOnly) {
  if (current === updated) {
    console.log('✅ schema.supabase.prisma está sincronizado con el schema canónico.');
    process.exit(0);
  }
  const expectedLines = updated.split('\n');
  const currentLines = (current || '').split('\n');
  const differences = [];
  const max = Math.max(expectedLines.length, currentLines.length);
  for (let i = 0; i < max && differences.length < 8; i += 1) {
    if (expectedLines[i] !== currentLines[i]) {
      differences.push(`línea ${i + 1}: esperado ${JSON.stringify(expectedLines[i] ?? '')}, actual ${JSON.stringify(currentLines[i] ?? '')}`);
    }
  }
  console.error('❌ schema.supabase.prisma está desincronizado; no se escribió ningún archivo.');
  differences.forEach((line) => console.error(`   ${line}`));
  process.exit(1);
}

fs.writeFileSync(destPath, updated, 'utf8');
console.log('✅ schema.supabase.prisma successfully synchronized with full RTMS schema (' + updated.split('\n').length + ' lines).');
