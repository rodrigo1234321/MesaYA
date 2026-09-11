#!/usr/bin/env node

/**
 * MesaYA - Monorepo Build Runner
 * Etapa 02: Compilación ordenada por dependencias:
 * 1. @mesaya/shared (contratos y tipos base)
 * 2. @mesaya/api (backend Fastify + Prisma Client)
 * 3. apps: @mesaya/client-web, @mesaya/staff-panel, @mesaya/admin-dashboard
 * 4. hardware: @mesaya/qr-generator
 *
 * Se detiene con exit no-cero ante el primer fallo de compilación.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { acquireHeavyLock, stopOnTimeout } from './heavy-lock.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const cli = (relative, ...args) => [path.resolve(projectRoot, 'node_modules', relative), ...args];

const buildSteps = [
  {
    name: '@mesaya/shared',
    description: 'Contratos compartidos, schemas Zod y tipos RTMS',
    cwd: path.resolve(projectRoot, 'packages', 'shared'),
    commands: [cli('typescript/bin/tsc')]
  },
  {
    name: '@mesaya/api',
    description: 'Backend Fastify, generación Prisma Client y compilación TypeScript',
    cwd: path.resolve(projectRoot, 'packages', 'api'),
    commands: [cli('prisma/build/index.js', 'generate'), cli('typescript/bin/tsc')]
  },
  {
    name: '@mesaya/client-web',
    description: 'App web comensal (Vite)',
    cwd: path.resolve(projectRoot, 'apps', 'client-web'),
    commands: [cli('vite/bin/vite.js', 'build')]
  },
  {
    name: '@mesaya/staff-panel',
    description: 'Panel mozo/salón (React + TypeScript + Vite)',
    cwd: path.resolve(projectRoot, 'apps', 'staff-panel'),
    commands: [cli('typescript/bin/tsc'), cli('vite/bin/vite.js', 'build')]
  },
  {
    name: '@mesaya/admin-dashboard',
    description: 'Dashboard gerencial / editor de plano (React + TypeScript + Vite)',
    cwd: path.resolve(projectRoot, 'apps', 'admin-dashboard'),
    commands: [cli('typescript/bin/tsc'), cli('vite/bin/vite.js', 'build')]
  },
  {
    name: '@mesaya/qr-generator',
    description: 'Herramienta de generación de códigos QR (TypeScript typecheck)',
    cwd: path.resolve(projectRoot, 'hardware', 'qr-generator'),
    commands: [cli('typescript/bin/tsc', '--noEmit')]
  }
];

function main() {
  // A production build is a normal developer/CI operation and must not depend
  // on the optional Windows Job supervisor used by the isolated test runner.
  // A host may still opt into the old hard gate for a bounded certification
  // job with MESAYA_REQUIRE_BOUNDED_JOB=1.
  if (
    process.platform === 'win32' &&
    process.env.MESAYA_REQUIRE_BOUNDED_JOB === '1' &&
    !process.env.MESAYA_BOUNDED_JOB
  ) {
    console.error('Este build fue configurado para requerir el adaptador Windows Job, pero no está presente.');
    process.exit(125);
  }
  if (process.platform === 'win32' && !process.env.MESAYA_BOUNDED_JOB) {
    console.warn('Aviso: build local sin supervisor Windows Job; los timeouts se controlan por comando.');
  }
  for (const step of buildSteps) {
    for (const [script] of step.commands) {
      if (!fs.existsSync(script)) throw new Error(`CLI local no disponible: ${script}`);
    }
  }
  acquireHeavyLock(projectRoot);
  console.log('🏗️  Iniciando build ordenado del monorepo MesaYA...');
  console.log(`📁 Directorio raíz: ${projectRoot}\n`);

  const startTime = Date.now();
  const results = [];

  for (let i = 0; i < buildSteps.length; i++) {
    const step = buildSteps[i];
    const stepNum = i + 1;
    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`[${stepNum}/${buildSteps.length}] Compilando ${step.name} (${step.description})...`);
    console.log(`📂 Directorio: ${step.cwd}`);

    const stepStart = Date.now();
    for (const args of step.commands) {
      const remaining = COMMAND_TIMEOUT_MS - (Date.now() - startTime);
      if (remaining <= 0) stopOnTimeout();
      const result = spawnSync(process.execPath, args, {
        cwd: step.cwd,
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        timeout: remaining,
        // Prisma generate validates DATABASE_URL even though this build does
        // not connect to a database. A clean clone therefore gets a local
        // SQLite fallback; an explicitly configured operator/CI URL wins.
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db'
        }
      });
      if (result.error?.code === 'ETIMEDOUT') {
        console.error(`Timeout de build en ${step.name}; el Job externo termina todo el árbol.`);
        stopOnTimeout();
      }
      if (result.error || result.signal || result.status !== 0) {
        console.error(`Falló ${step.name}: ${result.error?.code || result.signal || result.status}`);
        process.exit(result.status || 1);
      }
    }

    const duration = ((Date.now() - stepStart) / 1000).toFixed(2);

    console.log(`✅ ${step.name} compilado con éxito (${duration}s).\n`);
    results.push({ name: step.name, duration: `${duration}s`, status: 'OK' });
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('=============================================================');
  console.log(`🎉 BUILD COMPLETO EXITOSO (${totalDuration}s)`);
  console.log('Resumen de compilación por workspace:');
  for (const r of results) {
    console.log(`  ✓ ${r.name.padEnd(26)} [${r.status}] (${r.duration})`);
  }
  process.exit(0);
}

main();
