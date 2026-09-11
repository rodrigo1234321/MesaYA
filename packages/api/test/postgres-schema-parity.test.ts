import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '../../..');
const sqliteSchemaPath = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.prisma');
const postgresSchemaPath = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.supabase.prisma');
const syncScriptPath = path.join(projectRoot, 'scripts', 'sync_supabase_schema.js');
const prismaCliPath = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');

function modelFields(schema: string) {
  const result = new Map<string, string[]>();
  const lines = schema.split(/\r?\n/);
  let model: string | null = null;
  let depth = 0;
  for (const line of lines) {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      model = modelMatch[1];
      depth = 1;
      result.set(model, []);
      continue;
    }
    if (!model) continue;
    if (line.trim() === '}') {
      depth -= 1;
      if (depth === 0) model = null;
      continue;
    }
    if (depth === 1 && line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('@@')) {
      const field = line.trim().match(/^(\w+)\s+([^\s/]+)/);
      if (field) result.get(model)!.push(`${field[1]} ${field[2]}`);
    }
  }
  return result;
}

describe('Etapa 22 — Paridad SQLite/PostgreSQL y sincronizador seguro', () => {
  it('mantiene modelos y campos equivalentes, con sólo diferencias de datasource', () => {
    const sqlite = fs.readFileSync(sqliteSchemaPath, 'utf8');
    const postgres = fs.readFileSync(postgresSchemaPath, 'utf8');
    expect([...modelFields(postgres)]).toEqual([...modelFields(sqlite)]);
    expect(sqlite).toContain('provider = "sqlite"');
    expect(postgres).toContain('provider  = "postgresql"');
    expect(postgres).toContain('directUrl = env("DIRECT_URL")');
  });

  it('--check pasa sincronizado y detecta deriva sin dejar cambios', () => {
    const original = fs.readFileSync(postgresSchemaPath, 'utf8');
    const clean = spawnSync(process.execPath, [syncScriptPath, '--check'], { cwd: projectRoot, encoding: 'utf8' });
    expect(clean.status).toBe(0);

    try {
      fs.writeFileSync(postgresSchemaPath, original.replace('mergedWithTableId String?', 'mergedWithTableId String? // drift fixture'), 'utf8');
      const drift = spawnSync(process.execPath, [syncScriptPath, '--check'], { cwd: projectRoot, encoding: 'utf8' });
      expect(drift.status).toBe(1);
      expect(fs.readFileSync(postgresSchemaPath, 'utf8')).toContain('// drift fixture');
    } finally {
      fs.writeFileSync(postgresSchemaPath, original, 'utf8');
    }
    expect(fs.readFileSync(postgresSchemaPath, 'utf8')).toBe(original);
  });

  it('valida ambos schemas sin conexión usando URLs ficticias de sintaxis válida', () => {
    for (const schemaPath of [sqliteSchemaPath, postgresSchemaPath]) {
      const postgres = schemaPath === postgresSchemaPath;
      const env = {
        ...process.env,
        DATABASE_URL: postgres
          ? 'postgresql://fixture_user:fixture_pass@127.0.0.1:5432/mesaya_fixture?schema=public'
          : 'file:./.tmp/schema-validation.db',
        ...(postgres ? {
          DIRECT_URL: 'postgresql://fixture_user:fixture_pass@127.0.0.1:5432/mesaya_fixture?schema=public'
        } : {})
      };
      const result = spawnSync(process.execPath, [prismaCliPath, 'validate', `--schema=${schemaPath}`], {
        cwd: projectRoot,
        env,
        encoding: 'utf8'
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
    }
  // Prisma's Windows CLI cold start can take >20s on Node 24 even though
  // `validate` never opens a database connection. Keep this gate strict
  // enough to catch a hang while allowing a normal local cold start.
  }, 60000);
});
