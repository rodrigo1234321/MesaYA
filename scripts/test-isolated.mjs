#!/usr/bin/env node

/**
 * MesaYA - Runner de pruebas aisladas con SQLite efímera
 * Etapa 01: Aislamiento estricto por suite, sandbox .tmp/qa/<uuid>,
 * protección contra alteración de la base demo persistente y propagación de exit codes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { acquireHeavyLock, stopOnTimeout } from './heavy-lock.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEV_DB_PATH = path.resolve(projectRoot, 'packages', 'api', 'prisma', 'dev.db');
const QA_ROOT = path.resolve(projectRoot, '.tmp', 'qa');

const PRISMA_CLI = path.resolve(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const TSX_CLI = path.resolve(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VITEST_CLI = path.resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const runnerStarted = Date.now();

function getDevDbHash() {
  if (!fs.existsSync(DEV_DB_PATH)) return null;
  const content = fs.readFileSync(DEV_DB_PATH);
  return createHash('sha256').update(content).digest('hex');
}

function runNodeScript(scriptPath, args, env, cwd = projectRoot) {
  const remaining = COMMAND_TIMEOUT_MS - (Date.now() - runnerStarted);
  if (remaining <= 0) return { status: 124, stdout: '', stderr: '', timedOut: true };
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: remaining,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  // Only the external Windows Job owns tree cancellation; never kill a PID after its parent exited.
  if (!timedOut && (result.error || result.signal)) {
    throw result.error || new Error(`Comando interrumpido: ${result.signal}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut
  };
}

function safeCleanup(sandboxDir) {
  try {
    const resolved = path.resolve(sandboxDir);
    const resolvedQaRoot = path.resolve(QA_ROOT);
    const rel = path.relative(resolvedQaRoot, resolved);

    // Salvaguarda: sólo eliminar directorios dentro de .tmp/qa
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.warn(`⚠️ [cleanup] Intento de eliminar ruta fuera de .tmp/qa ignorado: ${resolved}`);
      return;
    }

    const marker = path.join(resolved, '.runner-owner.json');
    if (!fs.existsSync(marker)) {
      console.warn(`⚠️ [cleanup] Directorio sin marcador .runner-owner.json ignorado: ${resolved}`);
      return;
    }

    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    console.warn(`⚠️ [cleanup] Error no crítico al limpiar sandbox: ${err.message}`);
  }
}

async function main() {
  if (process.platform === 'win32' && !process.env.MESAYA_BOUNDED_JOB) {
    throw new Error('Este runner requiere el adaptador Windows Job de la jornada. No ejecutar sin supervisor.');
  }
  acquireHeavyLock(projectRoot);
  console.log('🧪 Iniciando MesaYA Isolated Test Runner...');
  console.log(`📁 Directorio raíz del proyecto: ${projectRoot}`);

  // 1. Registrar hash inicial de la base demo persistente
  const initialDevDbHash = getDevDbHash();
  if (initialDevDbHash) {
    console.log(`🔒 Base demo detectada (dev.db). SHA-256 inicial: ${initialDevDbHash.slice(0, 16)}...`);
  } else {
    console.log('ℹ️ No se detectó base demo dev.db previa.');
  }

  // 2. Definir suites disponibles
  const allSuites = [
    {
      name: 'seed-guard',
      path: 'packages/api/test/seed-guard.test.ts',
      needsSeed: false,
      description: 'Prueba centinela: Guard de seguridad del seed y sandbox'
    },
    {
      name: 'ai-containment',
      path: 'packages/api/test/ai-containment.test.ts',
      needsSeed: false,
      description: 'Contención IA: sin fallbacks engañosos, con mocks y fixtures ficticias'
    },
    {
      name: 'environment-security',
      path: 'packages/api/test/environment-security.test.ts',
      needsSeed: false,
      description: 'Entorno, JWT, cifrado y CORS con configuración efímera'
    },
    {
      name: 'auth-policy',
      path: 'packages/api/test/auth-policy.test.ts',
      needsSeed: false,
      description: 'Helpers de token, rol y tenant con fixtures A/B'
    },
    {
      name: 'staff-access',
      path: 'packages/api/test/staff-access.test.ts',
      needsSeed: false,
      description: 'Altas de personal, login admin y onboarding cerrado'
    },
    {
      name: 'admin-boundary',
      path: 'packages/api/test/admin-boundary.test.ts',
      needsSeed: false,
      description: 'Configuración, auditoría y métricas aisladas por manager/tenant'
    },
    {
      name: 'menu-access',
      path: 'packages/api/test/menu-access.test.ts',
      needsSeed: false,
      description: 'Mutaciones de menú aisladas por manager/tenant e importación validada'
    },
    {
      name: 'tables-shifts-access',
      path: 'packages/api/test/tables-shifts-access.test.ts',
      needsSeed: false,
      description: 'Protección de mesas, aperturas/cierres de turnos y eliminación de tokens de sesión'
    },
    {
      name: 'floorplan-fsm-access',
      path: 'packages/api/test/floorplan-fsm-access.test.ts',
      needsSeed: false,
      description: 'Autorización de plano, transiciones FSM, derivación de actor y concurrencia optimista'
    },
    {
      name: 'fsm-concurrency',
      path: 'packages/api/test/fsm-concurrency.test.ts',
      needsSeed: false,
      description: 'Concurrencia real FSM con SQLite efímera, conflicto 409 y unicidad de eventos'
    },
    {
      name: 'qr-session-lifecycle',
      path: 'packages/api/test/qr-session-lifecycle.test.ts',
      needsSeed: false,
      description: 'Separación de QR estable de sesión operativa, revocación por rotación y consultas read-only'
    },
    {
      name: 'calls-feedback-access',
      path: 'packages/api/test/calls-feedback-access.test.ts',
      needsSeed: false,
      description: 'Validación de llamados, feedback privado, deduplicación, aislamiento tenant y señal GPS'
    },
    {
      name: 'guest-orders-validation',
      path: 'packages/api/test/guest-orders-validation.test.ts',
      needsSeed: false,
      description: 'Validación de pedidos del comensal, aislamiento de tenant, cantidades, anti-tampering e idempotencia'
    },
    {
      name: 'staff-orders-kitchen',
      path: 'packages/api/test/staff-orders-kitchen.test.ts',
      needsSeed: false,
      description: 'Autorización de cocina, estados de pedidos, transiciones permitidas y cobro manual por manager'
    },
    {
      name: 'waitlist-lifecycle',
      path: 'packages/api/test/waitlist-lifecycle.test.ts',
      needsSeed: false,
      description: 'Fila virtual: aislamiento de tenant, validación de mesa destino, join público sin leak de datos y desactivación de preorden'
    },
    {
      name: 'stream-closure-snapshots',
      path: 'packages/api/test/stream-closure-snapshots.test.ts',
      needsSeed: false,
      description: 'Cierre de SSE /stream (410 GONE), snapshots autenticados, aislamiento tenant y comensal acotado a su mesa'
    },
    {
      name: 'polling-clients-reconnect',
      path: 'packages/api/test/polling-clients-reconnect.test.ts',
      needsSeed: false,
      description: 'Reconexión, polling autoritativo, deduplicación de alertas y consistencia multi-cliente'
    },
    {
      name: 'client-xss-security',
      path: 'packages/api/test/client-xss-security.test.ts',
      needsSeed: false,
      description: 'Mitigación contextual de XSS en cliente, sanitización de URLs y ausencia de sinks vulnerables'
    },
    {
      name: 'client-build-assets',
      path: 'packages/api/test/client-build-assets.test.ts',
      needsSeed: false,
      description: 'Build productivo del cliente sin Tailwind runtime ni controles de demostración'
    },
    {
      name: 'postgres-schema-parity',
      path: 'packages/api/test/postgres-schema-parity.test.ts',
      needsSeed: false,
      description: 'Paridad de modelos SQLite/PostgreSQL, --check y validación sin conexión'
    },
    {
      name: 'atomic-shifts-sessions',
      path: 'packages/api/test/atomic-shifts-sessions.test.ts',
      needsSeed: false,
      description: 'Turnos y sesiones atómicos, claves activas únicas y rotación concurrente'
    },
    {
      name: 'abuse-controls',
      path: 'packages/api/test/abuse-controls.test.ts',
      needsSeed: false,
      description: 'Rate limits compartidos y deduplicación atómica de llamados entre conexiones'
    },
    {
      name: 'floorplan-atomic-save',
      path: 'packages/api/test/floorplan-atomic-save.test.ts',
      needsSeed: false,
      description: 'Guardado atómico del plano: validación previa, versión optimista 409 y bloqueo de borrado con dependencias'
    },
    {
      name: 'floorplan-position-cas',
      path: 'packages/api/test/floorplan-position-cas.test.ts',
      needsSeed: false,
      description: 'CAS en vía rápida PATCH y rutas HTTP reales del plano con servicio sin mocks'
    },
    {
      name: 'floorplan-store-save',
      path: 'apps/admin-dashboard/src/stores/useFloorPlanStore.test.ts',
      needsSeed: false,
      description: 'Action versionado del store: expectedVersion, preservación del borrador ante 409 y reintento consciente'
    },
    {
      name: 'route-matrix-guard',
      path: 'packages/api/test/route-matrix-guard.test.ts',
      needsSeed: false,
      description: 'Gate de matriz de rutas: sin rutas nuevas sin clasificar ni deriva de auth'
    },
    {
      name: 'pilot-rehearsal',
      path: 'packages/api/test/pilot-rehearsal.test.ts',
      needsSeed: false,
      description: 'Ensayo integral del piloto con datos ficticios: turno, QR, llamado, pedido, cocina, cobro, cierre, A/B y reinicio'
    },
    {
      name: 'system-lifecycle',
      path: 'packages/api/test/system-lifecycle.test.ts',
      needsSeed: true,
      description: 'Ciclo de vida del sistema, health check y contratos de URL'
    },
    {
      name: 'rtms-fsm-analytics',
      path: 'packages/api/test/rtms-fsm-analytics.test.ts',
      needsSeed: true,
      description: 'FSM Engine, transiciones de estado y analíticas RTMS'
    },
    {
      name: 'full-system-e2e',
      path: 'packages/api/test/full-system-e2e.test.ts',
      needsSeed: true,
      description: 'End-to-End completo del sistema (llamados, staff, admin)'
    },
    {
      name: 'cocina-cuentas-etapa-01',
      path: 'packages/api/test/cocina-cuentas-etapa-01.test.ts',
      needsSeed: false,
      description: 'Etapa 01: Login, PIN, bootstrap, rate limits y QR'
    },
    {
      name: 'cocina-cuentas-etapa-02',
      path: 'packages/api/test/cocina-cuentas-etapa-02.test.ts',
      needsSeed: false,
      description: 'Etapa 02: Handler HTTP y hardening documentado'
    },
    {
      name: 'cocina-cuentas-etapa-03',
      path: 'packages/api/test/cocina-cuentas-etapa-03.test.ts',
      needsSeed: false,
      description: 'Etapa 03: Contratos y datos aditivos cocina y cuentas'
    },
    {
      name: 'cocina-cuentas-etapa-04',
      path: 'packages/api/test/cocina-cuentas-etapa-04.test.ts',
      needsSeed: false,
      description: 'Etapa 04: Participantes, tandas, idempotencia, modos y alérgenos'
    }
  ];

  // Filtrar si el usuario especificó una suite particular
  const requestedSuiteArg = process.argv[2];
  let suitesToRun = requestedSuiteArg
    ? allSuites.filter(s => s.name.includes(requestedSuiteArg) || s.path.includes(requestedSuiteArg))
    : allSuites;

  if (suitesToRun.length === 0 && requestedSuiteArg && fs.existsSync(path.resolve(projectRoot, requestedSuiteArg))) {
    suitesToRun = [{
      name: path.basename(requestedSuiteArg, path.extname(requestedSuiteArg)),
      path: requestedSuiteArg,
      needsSeed: false,
      description: `Suite ad-hoc: ${requestedSuiteArg}`
    }];
  }

  if (suitesToRun.length === 0) {
    console.error(`❌ No se encontró ninguna suite que coincida con "${requestedSuiteArg}".`);
    process.exit(1);
  }

  console.log(`📋 Suites programadas en serie: ${suitesToRun.length}`);

  let failedSuites = [];
  const runResults = [];

  for (const suite of suitesToRun) {
    const suiteUuid = randomUUID();
    const sandboxDir = path.resolve(QA_ROOT, suiteUuid);
    const dbFile = path.resolve(sandboxDir, 'test.db');
    const normalizedDbUrl = `file:${dbFile.split(path.sep).join('/')}`;

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log(`▶ Ejecutando suite: ${suite.name} (${suite.description})`);
    console.log(`📦 Sandbox temporal: ${sandboxDir}`);
    console.log(`🗄️ SQLite aislada: ${normalizedDbUrl}`);

    // Crear sandbox y marcador de propiedad
    fs.mkdirSync(sandboxDir, { recursive: true });
    // Pre-crear archivo SQLite vacío para inicialización determinística en Windows
    fs.writeFileSync(dbFile, '');
    fs.writeFileSync(
      path.join(sandboxDir, '.runner-owner.json'),
      JSON.stringify(
        {
          runner: 'test-isolated',
          suiteName: suite.name,
          suiteUuid,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          sandboxDir,
          dbFile
        },
        null,
        2
      ),
      'utf8'
    );

    const isolatedEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: normalizedDbUrl,
      ISOLATED_SANDBOX_DIR: sandboxDir,
      ISOLATED_SANDBOX_DB: dbFile,
      ALLOW_TEST_SEED: 'true',
      MSYS_NO_PATHCONV: '1',
      MSYS2_ENV_CONV_EXCL: 'DATABASE_URL',
      RUST_LOG: 'info',
      RUST_BACKTRACE: '1'
    };

    // Paso A: Crear schema en la SQLite temporal
    console.log('⚙️ Desplegando schema en la base de test aislada...');
    const schemaPath = path.resolve(projectRoot, 'packages', 'api', 'prisma', 'schema.prisma');
    const pushRes = runNodeScript(
      PRISMA_CLI,
      ['db', 'push', `--schema=${schemaPath}`, '--skip-generate', '--accept-data-loss'],
      isolatedEnv
    );

    if (pushRes.timedOut) {
      console.error(`❌ Timeout al inicializar schema para la suite ${suite.name}; se detiene el runner.`);
      stopOnTimeout();
    }

    if (pushRes.status !== 0) {
      fs.writeFileSync(
        path.join(sandboxDir, 'prisma-push-failure.log'),
        `STATUS: ${pushRes.status}\nSTDOUT:\n${pushRes.stdout}\nSTDERR:\n${pushRes.stderr}\n`,
        'utf8'
      );
      console.error(`❌ Error al inicializar schema para la suite ${suite.name} (exit code: ${pushRes.status})`);
      failedSuites.push({ suite: suite.name, stage: 'prisma db push', exitCode: pushRes.status, sandboxDir });
      continue;
    }

    // Paso B: Sembrar datos en la base de test si la suite lo requiere
    if (suite.needsSeed) {
      console.log('🌱 Sembrando datos en sandbox con guard de seguridad activo...');
      const seedRes = runNodeScript(
        TSX_CLI,
        ['packages/api/prisma/seed.ts'],
        isolatedEnv
      );

      if (seedRes.timedOut) {
        console.error(`❌ Timeout al ejecutar seed aislado para la suite ${suite.name}; se detiene el runner.`);
        stopOnTimeout();
      }

      if (seedRes.status !== 0) {
        console.error(`❌ Error al ejecutar seed aislado para la suite ${suite.name} (exit code: ${seedRes.status})`);
        failedSuites.push({ suite: suite.name, stage: 'seed', exitCode: seedRes.status, sandboxDir });
        continue;
      }
    }

    // Paso C: Ejecutar Vitest para la suite específica
    console.log(`🚀 Ejecutando tests con Vitest: ${suite.path}`);
    const testRes = runNodeScript(
      VITEST_CLI,
      ['run', suite.path, '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1'],
      isolatedEnv
    );

    if (testRes.timedOut) {
      console.error(`❌ Timeout al ejecutar la suite ${suite.name}; se detiene el runner.`);
      stopOnTimeout();
    }

    if (testRes.status !== 0) {
      console.error(`❌ La suite ${suite.name} falló (exit code: ${testRes.status}).`);
      console.log(`📂 Se conserva el sandbox para análisis forense: ${sandboxDir}`);
      failedSuites.push({ suite: suite.name, stage: 'test', exitCode: testRes.status, sandboxDir });
    } else {
      console.log(`✅ Suite ${suite.name} PASSED.`);
      safeCleanup(sandboxDir);
      console.log(`🧹 Sandbox temporal limpiado con éxito.`);
      runResults.push({ suite: suite.name, status: 'PASSED' });
    }
  }

  // 3. Verificación de integridad post-ejecución
  console.log('\n=============================================================');
  console.log('🔍 VERIFICACIÓN DE INTEGRIDAD DE LA BASE DEMO');
  const finalDevDbHash = getDevDbHash();

  if (initialDevDbHash) {
    if (finalDevDbHash === initialDevDbHash) {
      console.log(`🛡️ dev.db permanece 100% INTACTA. Hash: ${finalDevDbHash.slice(0, 16)}...`);
    } else {
      console.error('🚨 VIOLACIÓN CRÍTICA: dev.db fue modificada durante la ejecución de los tests!');
      console.error(`Hash inicial: ${initialDevDbHash}`);
      console.error(`Hash final:   ${finalDevDbHash}`);
      process.exit(2);
    }
  } else {
    console.log('ℹ️ No existía dev.db antes de la prueba.');
  }

  // 4. Resumen final y propagación de exit code
  console.log('\n📊 RESUMEN DEL TEST RUNNER:');
  console.log(`• Total suites ejecutadas: ${suitesToRun.length}`);
  console.log(`• Suites exitosas: ${runResults.length}`);
  console.log(`• Suites fallidas: ${failedSuites.length}`);

  if (failedSuites.length > 0) {
    console.error('\n❌ Fallos registrados:');
    for (const f of failedSuites) {
      console.error(`  - ${f.suite} [Etapa: ${f.stage}, ExitCode: ${f.exitCode}]`);
      console.error(`    Evidencia forense conservada en: ${f.sandboxDir}`);
    }
    process.exit(1);
  }

  console.log('\n🎉 Todas las suites aisladas pasaron exitosamente sin tocar datos de demo.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error fatal en el runner:', err);
  process.exit(1);
});
