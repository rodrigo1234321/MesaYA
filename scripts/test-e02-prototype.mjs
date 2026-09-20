import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const prototypePath = resolve('docs/prototipos/atencion/index.html');

console.log('--- Verificando Prototipo E02 (Atención) ---');

if (!existsSync(prototypePath)) {
  console.error('ERROR: El archivo de prototipo no existe en:', prototypePath);
  process.exit(1);
}

const html = readFileSync(prototypePath, 'utf8');

const requiredTokens = [
  'MesaYA — Prototipo Navegable de Atención',
  'Puesto 1 (Terminal Salón)',
  'selectLoad',
  'selectCashPermission',
  'btnSimulateNewTask',
  'btnToggleConnection',
  'btnSimulateCollision',
  'btnOpenNumpad',
  'pinModal',
  'numpad-btn',
  'btnActionVoy',
  'btnActionAtendido',
  'btnActionEntregado',
  'btnActionCobrarEfectivo',
  'btnActionLimpia',
  'btnActionAcceptReview',
  'btnBackToQueue',
  'offlineBanner',
  '--touch-min: 48px',
  '@media (max-width: 900px)'
];

let missing = 0;
for (const token of requiredTokens) {
  if (!html.includes(token)) {
    console.error(`FALTA token requerido: "${token}"`);
    missing++;
  } else {
    console.log(`✓ Token presente: "${token}"`);
  }
}

if (missing > 0) {
  console.error(`FALLO: ${missing} verificaciones fallaron.`);
  process.exit(1);
}

console.log('TODAS las verificaciones del prototipo E02 pasaron con éxito.');
process.exit(0);
