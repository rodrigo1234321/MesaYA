import { describe, expect, it } from 'vitest';
import { normalizePrismaRuntimeDatabaseUrl } from '../src/lib/prisma';

describe('normalizePrismaRuntimeDatabaseUrl', () => {
  it('moves Supabase pooler runtime traffic from session to transaction mode', () => {
    const normalized = normalizePrismaRuntimeDatabaseUrl(
      'postgresql://postgres.project:secret@aws-0-us-east-2.pooler.supabase.com:5432/postgres'
    );
    const url = new URL(normalized!);

    expect(url.port).toBe('6543');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('connection_limit')).toBe('1');
  });

  it('keeps an already transactional Supabase pooler URL transactional', () => {
    const normalized = normalizePrismaRuntimeDatabaseUrl(
      'postgresql://postgres.project:secret@aws-0-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true'
    );
    const url = new URL(normalized!);

    expect(url.port).toBe('6543');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('connection_limit')).toBe('1');
  });

  it('does not rewrite local or direct database hosts', () => {
    expect(normalizePrismaRuntimeDatabaseUrl('file:./dev.db')).toBe('file:./dev.db');
    const direct = 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres';
    expect(normalizePrismaRuntimeDatabaseUrl(direct)).toBe(direct);
  });
});
