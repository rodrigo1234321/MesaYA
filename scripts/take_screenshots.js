const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getBrowserPath() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (fs.existsSync(edgePath)) return edgePath;
  if (fs.existsSync(chromePath)) return chromePath;
  throw new Error('No Edge or Chrome found');
}

const BROWSER_EXE = getBrowserPath();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function capture(url, outputFile, width, height, delayMs = 2000) {
  return new Promise((resolve, reject) => {
    const cmd = `"${BROWSER_EXE}" --headless --disable-gpu --hide-scrollbars --window-size=${width},${height} --virtual-time-budget=${delayMs} --screenshot="${outputFile}" "${url}"`;
    try {
      execSync(cmd, { stdio: 'inherit', timeout: 15000 });
      console.log(`[OK] ${path.basename(outputFile)} (${width}x${height})`);
      resolve();
    } catch (e) {
      console.error(`[ERR] ${outputFile}:`, e.message);
      reject(e);
    }
  });
}

async function main() {
  if (!fs.existsSync(path.join(ROOT_DIR, 'apps/staff-panel/dist'))) {
    console.log('🚀 Compilando bundles de staff y admin...');
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  function createServer(baseDir, port) {
    const s = http.createServer((req, res) => {
      let pth = req.url.split('?')[0];
      if (pth === '/' || !path.extname(pth)) pth = '/index.html';
      const fp = path.join(baseDir, pth);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(fp)] || 'text/plain', 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(fp).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    s.listen(port);
    return s;
  }

  const clientServer = createServer(path.join(ROOT_DIR, 'apps/client-web'), 8081);
  const staffServer = createServer(path.join(ROOT_DIR, 'apps/staff-panel/dist'), 8082);
  const adminServer = createServer(path.join(ROOT_DIR, 'apps/admin-dashboard/dist'), 8083);

  console.log('🚀 Iniciando backend API...');
  const apiProc = spawn('npm', ['--workspace=@mesaya/api', 'run', 'dev'], { cwd: ROOT_DIR, shell: true });

  await sleep(4500);

  try {
    // 1. Cliente Hub Principal
    console.log('📸 1. Cliente - Hub de Mesa');
    await capture('http://localhost:8081/?r=trattoria-del-puerto&m=Mesa%201', path.join(SCREENSHOTS_DIR, '01_cliente_hub_principal.png'), 430, 932, 3000);

    // 2. Cliente Carta Digital Completa
    console.log('📸 2. Cliente - Carta Digital');
    const cHtml = fs.readFileSync(path.join(ROOT_DIR, 'apps/client-web/index.html'), 'utf8');
    const menuHtml = cHtml
      .replace('id="modalMenu" class="fixed inset-0 bg-slate-950/95 backdrop-blur-lg z-50 hidden', 'id="modalMenu" class="fixed inset-0 bg-slate-950/95 backdrop-blur-lg z-50 flex')
      .replace('id="actionsContainer" class="stagger-2 space-y-1.5"', 'id="actionsContainer" class="hidden"');
    fs.writeFileSync(path.join(ROOT_DIR, 'apps/client-web/menu-preview.html'), menuHtml);
    await capture('http://localhost:8081/menu-preview.html?r=trattoria-del-puerto&m=Mesa%201', path.join(SCREENSHOTS_DIR, '02_cliente_carta_digital.png'), 430, 932, 3500);

    // 3. Cliente Llamado Activo
    console.log('📸 3. Cliente - Llamado Activo');
    const activeHtml = cHtml
      .replace('id="activeCallCard" class="hidden', 'id="activeCallCard" class="block');
    fs.writeFileSync(path.join(ROOT_DIR, 'apps/client-web/active-preview.html'), activeHtml);
    await capture('http://localhost:8081/active-preview.html?r=trattoria-del-puerto&m=Mesa%201', path.join(SCREENSHOTS_DIR, '03_cliente_llamado_activo.png'), 430, 932, 3000);

    // 4. Mozo Login PIN
    console.log('📸 4. Mozo - Login PIN');
    await capture('http://localhost:8082/', path.join(SCREENSHOTS_DIR, '04_mozo_login_pin.png'), 480, 800, 2000);

    // 5. Mozo Panel Llamados en Vivo
    console.log('📸 5. Mozo - Panel de Comandas');
    const sHtml = fs.readFileSync(path.join(ROOT_DIR, 'apps/staff-panel/dist/index.html'), 'utf8');
    const sLive = sHtml.replace('<head>', '<head><script>localStorage.setItem("mesaya_staff_user", JSON.stringify({id:"staff-1",restaurantId:"trattoria-del-puerto",name:"Martín (Salón)",role:"WAITER",assignedSector:"SALON_PRINCIPAL"}));</script>');
    fs.writeFileSync(path.join(ROOT_DIR, 'apps/staff-panel/dist/live.html'), sLive);
    await capture('http://localhost:8082/live.html', path.join(SCREENSHOTS_DIR, '05_mozo_panel_salon.png'), 1024, 768, 3000);

    // 6. Admin Dashboard Mesas
    console.log('📸 6. Admin - Gestión Mesas & Turnos');
    const aHtml = fs.readFileSync(path.join(ROOT_DIR, 'apps/admin-dashboard/dist/index.html'), 'utf8');
    const aLive = aHtml.replace('<head>', '<head><script>localStorage.setItem("mesaya_admin_restaurant", JSON.stringify({id:"trattoria-del-puerto",name:"Trattoria del Puerto",slug:"trattoria-del-puerto",templateId:"GOURMET_OBSIDIAN",themeColor:"#f59e0b"}));</script>');
    fs.writeFileSync(path.join(ROOT_DIR, 'apps/admin-dashboard/dist/live.html'), aLive);
    await capture('http://localhost:8083/live.html', path.join(SCREENSHOTS_DIR, '06_admin_dashboard_mesas.png'), 1440, 900, 3500);

    console.log('🎉 Todas las capturas fueron generadas en screenshots/');
  } finally {
    clientServer.close();
    staffServer.close();
    adminServer.close();
    try { apiProc.kill(); } catch (_) {}
    try { fs.unlinkSync(path.join(ROOT_DIR, 'apps/client-web/menu-preview.html')); } catch (_) {}
    try { fs.unlinkSync(path.join(ROOT_DIR, 'apps/client-web/active-preview.html')); } catch (_) {}
    try { fs.unlinkSync(path.join(ROOT_DIR, 'apps/staff-panel/dist/live.html')); } catch (_) {}
    try { fs.unlinkSync(path.join(ROOT_DIR, 'apps/admin-dashboard/dist/live.html')); } catch (_) {}
  }
}

main();
