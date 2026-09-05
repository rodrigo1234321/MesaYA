import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { assertSafeSeedEnvironment, seedDatabase } from '../prisma/seed';

describe('Sentinel Test: Seed Guard & Sandbox Enforcement', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const validUuid = randomUUID();
  const validSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', validUuid);
  const validDbPath = path.resolve(validSandboxDir, 'isolated-test.db');
  const validDbUrl = `file:${validDbPath.split(path.sep).join('/')}`;

  beforeAll(() => {
    fs.mkdirSync(validSandboxDir, { recursive: true });
    fs.writeFileSync(
      path.join(validSandboxDir, '.runner-owner.json'),
      JSON.stringify(
        {
          runner: 'test-isolated',
          suiteName: 'sentinel',
          suiteUuid: validUuid,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          sandboxDir: validSandboxDir,
          dbFile: validDbPath
        },
        null,
        2
      ),
      'utf8'
    );
  });

  afterAll(() => {
    if (fs.existsSync(validSandboxDir)) {
      fs.rmSync(validSandboxDir, { recursive: true, force: true });
    }
  });

  describe('1. Confinamiento estricto de entorno (P1: eliminación de excepciones dev)', () => {
    it('rechaza estrictamente la ejecución de seed en entorno de producción', () => {
      expect(() => {
        assertSafeSeedEnvironment(validDbUrl, validSandboxDir, 'production');
      }).toThrow(/GUARD_VIOLATION.*fuera de entorno test/i);
    });

    it('rechaza en entorno development incluso con ALLOW_DEV_SEED=true para dev.db relativo', () => {
      const prevFlag = process.env.ALLOW_DEV_SEED;
      process.env.ALLOW_DEV_SEED = 'true';

      const relativeDevUrls = [
        'file:./dev.db',
        'file:./prisma/dev.db',
        'file:packages/api/prisma/dev.db'
      ];

      try {
        for (const url of relativeDevUrls) {
          expect(() => {
            assertSafeSeedEnvironment(url, validSandboxDir, 'development');
          }).toThrow(/GUARD_VIOLATION.*fuera de entorno test/i);
        }
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_DEV_SEED = prevFlag;
        else delete process.env.ALLOW_DEV_SEED;
      }
    });

    it('rechaza en entorno development con ALLOW_DEV_SEED=true para dev.db absoluto', () => {
      const prevFlag = process.env.ALLOW_DEV_SEED;
      process.env.ALLOW_DEV_SEED = 'true';

      const absoluteDevUrls = [
        `file:${path.resolve(projectRoot, 'packages/api/prisma/dev.db')}`,
        `file:${path.resolve(projectRoot, 'dev.db')}`
      ];

      try {
        for (const url of absoluteDevUrls) {
          expect(() => {
            assertSafeSeedEnvironment(url, validSandboxDir, 'development');
          }).toThrow(/GUARD_VIOLATION.*fuera de entorno test/i);
        }
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_DEV_SEED = prevFlag;
        else delete process.env.ALLOW_DEV_SEED;
      }
    });

    it('rechaza en entorno development con ALLOW_DEV_SEED=true para bases remotas', () => {
      const prevFlag = process.env.ALLOW_DEV_SEED;
      process.env.ALLOW_DEV_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment('postgresql://postgres:secret@db.supabase.co:5432/postgres', validSandboxDir, 'development');
        }).toThrow(/GUARD_VIOLATION.*fuera de entorno test/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_DEV_SEED = prevFlag;
        else delete process.env.ALLOW_DEV_SEED;
      }
    });

    it('rechaza cuando NODE_ENV no está definido', () => {
      expect(() => {
        assertSafeSeedEnvironment(validDbUrl, validSandboxDir, '');
      }).toThrow(/GUARD_VIOLATION.*fuera de entorno test/i);
    });
  });

  describe('2. Bloqueo de bases de datos remotas y rutas inseguras en test', () => {
    it('rechaza conexiones a bases de datos remotas en entorno test', () => {
      const remoteUrls = [
        'postgresql://postgres:secret@db.supabase.co:5432/postgres',
        'postgres://user:pass@localhost:5432/mydb',
        'mysql://root:pass@localhost:3306/db'
      ];

      for (const url of remoteUrls) {
        expect(() => {
          assertSafeSeedEnvironment(url, validSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*remota/i);
      }
    });

    it('rechaza en entorno de test si no cuenta con autorización explícita (ALLOW_TEST_SEED=true)', () => {
      const prevFlag = process.env.ALLOW_TEST_SEED;
      delete process.env.ALLOW_TEST_SEED;

      try {
        expect(() => {
          assertSafeSeedEnvironment(validDbUrl, validSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*ALLOW_TEST_SEED/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
      }
    });

    it('rechaza en entorno de test si ISOLATED_SANDBOX_DIR no está definido', () => {
      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(validDbUrl, '', 'test');
        }).toThrow(/GUARD_VIOLATION.*ISOLATED_SANDBOX_DIR/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
      }
    });

    it('rechaza si la base de datos apunta a la base demo habitual (./dev.db o prisma/dev.db) en test', () => {
      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      const unsafeUrls = [
        'file:./dev.db',
        'file:./prisma/dev.db',
        'file:packages/api/prisma/dev.db',
        `file:${path.resolve(projectRoot, 'packages/api/prisma/dev.db')}`,
        `file:${path.resolve(projectRoot, 'dev.db')}`
      ];

      try {
        for (const unsafeUrl of unsafeUrls) {
          expect(() => {
            assertSafeSeedEnvironment(unsafeUrl, validSandboxDir, 'test');
          }).toThrow(/GUARD_VIOLATION/i);
        }
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
      }
    });

    it('rechaza si la ruta de la base de datos está fuera de .tmp/qa/', () => {
      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      const nonQaDir = path.resolve(projectRoot, 'temp-other-dir');
      const nonQaDb = path.resolve(nonQaDir, 'test.db');

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${nonQaDb}`, nonQaDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*\.tmp\/qa/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
      }
    });
  });

  describe('3. Verificación en disco del marcador .runner-owner.json (P2)', () => {
    it('rechaza si el marcador .runner-owner.json no existe en el sandbox', () => {
      const emptyDirUuid = randomUUID();
      const emptySandboxDir = path.resolve(projectRoot, '.tmp', 'qa', emptyDirUuid);
      fs.mkdirSync(emptySandboxDir, { recursive: true });

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(emptySandboxDir, 'test.db')}`, emptySandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*Marcador de runner \(\.runner-owner\.json\) no encontrado/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(emptySandboxDir, { recursive: true, force: true });
      }
    });

    it('rechaza si el marcador .runner-owner.json está malformado o es JSON inválido', () => {
      const badJsonUuid = randomUUID();
      const badSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', badJsonUuid);
      fs.mkdirSync(badSandboxDir, { recursive: true });
      fs.writeFileSync(path.join(badSandboxDir, '.runner-owner.json'), '{ NOT_VALID_JSON }', 'utf8');

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(badSandboxDir, 'test.db')}`, badSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*malformado o ilegible/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(badSandboxDir, { recursive: true, force: true });
      }
    });

    it('rechaza si el marcador fue emitido por un runner no autorizado', () => {
      const foreignUuid = randomUUID();
      const foreignSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', foreignUuid);
      fs.mkdirSync(foreignSandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(foreignSandboxDir, '.runner-owner.json'),
        JSON.stringify({
          runner: 'rogue-script',
          sandboxDir: foreignSandboxDir
        }),
        'utf8'
      );

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(foreignSandboxDir, 'test.db')}`, foreignSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*no emitido por runner autorizado/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(foreignSandboxDir, { recursive: true, force: true });
      }
    });

    it('rechaza si el marcador sandboxDir no coincide con la ruta actual', () => {
      const spoofUuid = randomUUID();
      const spoofSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', spoofUuid);
      fs.mkdirSync(spoofSandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(spoofSandboxDir, '.runner-owner.json'),
        JSON.stringify({
          runner: 'test-isolated',
          sandboxDir: path.resolve(projectRoot, '.tmp', 'qa', 'other-dir')
        }),
        'utf8'
      );

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(spoofSandboxDir, 'test.db')}`, spoofSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*sandboxDir no coincide/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(spoofSandboxDir, { recursive: true, force: true });
      }
    });

    it('rechaza si el marcador .runner-owner.json no incluye el campo obligatorio dbFile', () => {
      const noDbFileUuid = randomUUID();
      const noDbFileSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', noDbFileUuid);
      fs.mkdirSync(noDbFileSandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(noDbFileSandboxDir, '.runner-owner.json'),
        JSON.stringify({
          runner: 'test-isolated',
          sandboxDir: noDbFileSandboxDir
          // dbFile omitido intencionalmente
        }),
        'utf8'
      );

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(noDbFileSandboxDir, 'test.db')}`, noDbFileSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*no incluye el campo obligatorio dbFile/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(noDbFileSandboxDir, { recursive: true, force: true });
      }
    });

    it('rechaza si el marcador dbFile no coincide con la base actual', () => {
      const mismatchDbUuid = randomUUID();
      const mismatchSandboxDir = path.resolve(projectRoot, '.tmp', 'qa', mismatchDbUuid);
      fs.mkdirSync(mismatchSandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(mismatchSandboxDir, '.runner-owner.json'),
        JSON.stringify({
          runner: 'test-isolated',
          sandboxDir: mismatchSandboxDir,
          dbFile: path.resolve(mismatchSandboxDir, 'other.db')
        }),
        'utf8'
      );

      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(`file:${path.join(mismatchSandboxDir, 'test.db')}`, mismatchSandboxDir, 'test');
        }).toThrow(/GUARD_VIOLATION.*Marcador dbFile no coincide/i);
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
        fs.rmSync(mismatchSandboxDir, { recursive: true, force: true });
      }
    });

    it('permite la ejecución cuando el sandbox es válido y el marcador en disco coincide al 100%', () => {
      const prevFlag = process.env.ALLOW_TEST_SEED;
      process.env.ALLOW_TEST_SEED = 'true';

      try {
        expect(() => {
          assertSafeSeedEnvironment(validDbUrl, validSandboxDir, 'test');
        }).not.toThrow();
      } finally {
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
      }
    });
  });

  describe('4. Aborto previo a cualquier mutación', () => {
    it('seedDatabase aborta antes de ejecutar cualquier deleteMany si el entorno no es seguro', async () => {
      const prevDb = process.env.DATABASE_URL;
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.ALLOW_TEST_SEED;

      process.env.DATABASE_URL = 'file:./dev.db';
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOW_TEST_SEED;

      try {
        await expect(seedDatabase()).rejects.toThrow(/GUARD_VIOLATION/i);
      } finally {
        if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
        else delete process.env.DATABASE_URL;
        if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
        else delete process.env.NODE_ENV;
        if (prevFlag !== undefined) process.env.ALLOW_TEST_SEED = prevFlag;
        else delete process.env.ALLOW_TEST_SEED;
      }
    });
  });
});
