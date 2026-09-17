#!/usr/bin/env node

import { seedEphemeralPostgres } from '../packages/api/prisma/seed';

const originalLog = console.log;
const originalWarn = console.warn;

async function main() {
  try {
    // El seed existente imprime URLs/tokens de fixture; E22 sólo conserva
    // métricas y nunca debe transportar esos valores a los logs del runner.
    console.log = () => undefined;
    console.warn = () => undefined;
    await seedEphemeralPostgres();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  console.log('E22_EPHEMERAL_SEED=PASS');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
  console.error(`E22_EPHEMERAL_SEED=FAIL ${redacted}`);
  process.exitCode = 1;
});
