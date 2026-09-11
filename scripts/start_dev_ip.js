const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIp();

function buildLanCorsOrigins(ip) {
  const origins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175'
  ];
  if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
    for (const port of [5173, 5174, 5175]) origins.push(`http://${ip}:${port}`);
  }
  return [...new Set(origins)].join(',');
}

const LAN_CORS_ORIGIN = buildLanCorsOrigins(LOCAL_IP);

console.log('====================================================');
console.log('🚀 INICIANDO MESAYA EN TU RED LOCAL (LAN / WIFI)');
console.log('====================================================');
console.log(`📱 TU IP LOCAL ES: ${LOCAL_IP}`);
console.log('----------------------------------------------------');
console.log(`🌐 1. Vista Cliente / QR-NFC (Mesa 1; requiere habilitar la mesa):`);
console.log(`   http://${LOCAL_IP}:5173/?r=trattoria-del-puerto&m=Mesa%201`);

try {
  const qrcode = require('qrcode');
  qrcode.toString(`http://${LOCAL_IP}:5173/?r=trattoria-del-puerto&m=Mesa%201`, { type: 'terminal', small: true }, (err, qr) => {
    if (!err) {
      console.log('\n📱 ESCANEA CON LA CÁMARA DE TU CELULAR:');
      console.log(qr);
    }
  });
} catch (_) {}

console.log(`🛎️ 2. Vista Mozo (Panel de Salón & Cocina):`);
console.log(`   http://${LOCAL_IP}:5174/ (PIN Mozo: 1234)`);
console.log(`\n📊 3. Vista Administrador (Dashboard):`);
console.log(`   http://${LOCAL_IP}:5175/`);
console.log(`\n⚙️ 4. API Backend Fastify:`);
console.log(`   http://${LOCAL_IP}:3000/v1/health`);
console.log('====================================================\n');

function runService(name, cmd, args, color, cwd = ROOT_DIR, extraEnv = {}) {
  const proc = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, PORT: '3000', HOST: '0.0.0.0', ...extraEnv }
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => console.log(`[${name}] ${line}`));
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => console.error(`[${name} ERR] ${line}`));
  });

  proc.on('close', (code) => {
    console.log(`[${name}] proceso finalizado con código ${code}`);
  });

  return proc;
}

const NODE = process.execPath;
const TSX_RUNNER = path.join(ROOT_DIR, 'scripts', 'run-tsx.mjs');
const VITE_CLI = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
const clientDir = path.join(ROOT_DIR, 'apps', 'client-web');
const staffDir = path.join(ROOT_DIR, 'apps', 'staff-panel');
const adminDir = path.join(ROOT_DIR, 'apps', 'admin-dashboard');

const pApi = runService('API', NODE, [TSX_RUNNER, 'packages/api/src/index.ts'], undefined, ROOT_DIR, process.env.CORS_ORIGIN ? {} : { CORS_ORIGIN: LAN_CORS_ORIGIN });
const pClient = runService('CLIENT', NODE, [VITE_CLI, '--host', '0.0.0.0', '--port', '5173'], undefined, clientDir);
const pStaff = runService('STAFF', NODE, [VITE_CLI, '--host', '0.0.0.0', '--port', '5174'], undefined, staffDir);
const pAdmin = runService('ADMIN', NODE, [VITE_CLI, '--host', '0.0.0.0', '--port', '5175'], undefined, adminDir);

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync(`taskkill /pid ${proc.pid} /T /F 2>nul`);
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_) {
    try { proc.kill(); } catch (__) {}
  }
}

process.on('SIGINT', () => {
  console.log('\n🛑 Deteniendo servidores de desarrollo...');
  killProcess(pApi);
  killProcess(pClient);
  killProcess(pStaff);
  killProcess(pAdmin);
  console.log('✅ Todos los puertos liberados limpiamente.');
  process.exit(0);
});
