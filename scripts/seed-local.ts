#!/usr/bin/env node

/**
 * Explicit local demo fixture entry point. The production/test seed remains
 * guarded in packages/api/prisma/seed.ts; this command is used only by the
 * clean-clone setup script against a local SQLite file.
 */
import { seedLocalDatabase } from '../packages/api/prisma/seed';

seedLocalDatabase().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
