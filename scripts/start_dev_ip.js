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

console.log('====================================================');
console.log('🚀 INICIANDO MESAYA EN TU RED LOCAL (LAN / WIFI)');
console.log('====================================================');
console.log(`📱 TU IP LOCAL ES: ${LOCAL_IP}`);
console.log('----------------------------------------------------');
console.log(`🌐 1. Vista Cliente (Comensal en Mesa 1):`);
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

function runService(name, cmd, args, color) {
  const proc = spawn(cmd, args, {
    cwd: ROOT_DIR,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, PORT: '3000', HOST: '0.0.0.0' }
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

const pApi = runService('API', 'npx', ['tsx', 'packages/api/src/index.ts']);
const pClient = runService('CLIENT', 'npm', ['--workspace=@mesaya/client-web', 'run', 'dev']);
const pStaff = runService('STAFF', 'npm', ['--workspace=@mesaya/staff-panel', 'run', 'dev']);
const pAdmin = runService('ADMIN', 'npm', ['--workspace=@mesaya/admin-dashboard', 'run', 'dev']);

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
