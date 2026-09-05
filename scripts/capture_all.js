const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function capture(url, fileName, width, height, delayMs = 1500) {
  const outFile = path.join(SCREENSHOTS_DIR, fileName);
  const cmd = `"${EDGE_PATH}" --headless --disable-gpu --hide-scrollbars --window-size=${width},${height} --virtual-time-budget=${delayMs} --screenshot="${outFile}" "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 15000 });
    const stat = fs.statSync(outFile);
    console.log(`[OK] ${fileName} (${stat.size} bytes)`);
  } catch (err) {
    console.error(`[ERR] Failed capturing ${fileName}:`, err.message);
  }
}

// Build mock server for all frontends and API
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function startServer(dir, port, mockApi = false) {
  return http.createServer((req, res) => {
    const urlObj = new URL(req.url, `http://localhost:${port}`);
    let p = urlObj.pathname;

    // Optional API mocks for preview
    if (mockApi && p.startsWith('/v1/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      if (p.includes('/restaurants')) {
        return res.end(JSON.stringify([{ id: 'trattoria-del-puerto', name: 'Trattoria del Puerto', slug: 'trattoria-del-puerto', planTier: 'LEAN', themeColor: '#f59e0b', templateId: 'GOURMET_OBSIDIAN' }]));
      }
      if (p.includes('/sessions')) {
        return res.end(JSON.stringify({
          valid: true,
          token: 'demo-token-123',
          restaurant: { id: 'trattoria-del-puerto', name: 'Trattoria del Puerto', slug: 'trattoria-del-puerto' },
          table: { id: 'table-1', label: 'Mesa 4', sector: 'TERRAZA' }
        }));
      }
      if (p.includes('/calls')) {
        return res.end(JSON.stringify([
          { id: 'c1', type: 'BILL', paymentMethod: 'MERCADO_PAGO', status: 'PENDING', origin: 'WEB_DIRECT', createdAt: new Date(Date.now() - 120000).toISOString(), tableLabel: 'Mesa 4', sector: 'TERRAZA' },
          { id: 'c2', type: 'WAITER', paymentMethod: 'NOT_APPLICABLE', status: 'IN_PROGRESS', origin: 'WEB_DIRECT', createdAt: new Date(Date.now() - 300000).toISOString(), tableLabel: 'Mesa 1', sector: 'SALON_PRINCIPAL' }
        ]));
      }
      if (p.includes('/menu/categories')) {
        return res.end(JSON.stringify([
          {
            id: 'cat-1', name: 'Pastas Artesanales', icon: '🍝', items: [
              { id: 'i1', name: 'Sorrentinos de Salmón & Puerros', price: 14500, description: 'Con crema de puerros y nueces', isAvailable: true, imageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=400' },
              { id: 'i2', name: 'Ravioles de Cordero Braseado', price: 13200, description: 'En reducción de vino Malbec y salvia', isAvailable: true, imageUrl: 'https://images.unsplash.com/photo-1587740908075-9e245070dfaa?w=400' }
            ]
          },
          {
            id: 'cat-2', name: 'Tragos & Bebidas', icon: '🍹', items: [
              { id: 'i3', name: 'Aperol Spritz Clásico', price: 6800, description: 'Prosecco, Aperol y soda con rodaja de naranja', isAvailable: true, imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=400' }
            ]
          }
        ]));
      }
      return res.end(JSON.stringify({ ok: true }));
    }

    if (p === '/' || !path.extname(p)) p = '/index.html';
    const filePath = path.join(dir, p);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }).listen(port);
}

async function run() {
  console.log('🏁 Iniciando servidor de previsualización...');
  const serverClient = startServer(path.join(ROOT_DIR, 'apps/client-web'), 8101, true);
  const serverStaff = startServer(path.join(ROOT_DIR, 'apps/staff-panel/dist'), 8102, true);
  const serverAdmin = startServer(path.join(ROOT_DIR, 'apps/admin-dashboard/dist'), 8103, true);

  // 1. Cliente: Pantalla Principal de la Mesa (Mobile 430x932)
  console.log('📸 1. Cliente - Pantalla Principal de la Mesa');
  capture('http://localhost:8101/?r=trattoria-del-puerto&m=Mesa%204', '01_cliente_pantalla_principal.png', 430, 932, 2000);

  // 2. Cliente: Carta Digital Completa con Precios y Platos
  console.log('📸 2. Cliente - Carta Digital Gastronómica');
  capture('http://localhost:8101/preview-carta.html?r=trattoria-del-puerto&m=Mesa%204', '02_cliente_carta_digital.png', 430, 932, 2000);

  // 3. Cliente: Llamado en Curso (Mozo en camino)
  console.log('📸 3. Cliente - Estado de Llamado Activo');
  capture('http://localhost:8101/preview-llamado.html?r=trattoria-del-puerto&m=Mesa%204', '03_cliente_llamado_activo.png', 430, 932, 2000);

  // 4. Mozo: Login Táctil con PIN
  console.log('📸 4. Mozo - Login con PIN');
  capture('http://localhost:8102/', '04_mozo_login_pin.png', 440, 750, 1500);

  // 5. Mozo: Panel de Salón con Comandas en Vivo
  console.log('📸 5. Mozo - Panel de Comandas en Vivo');
  // Inject mock staff session into staff html
  const staffDist = path.join(ROOT_DIR, 'apps/staff-panel/dist');
  const staffHtml = fs.readFileSync(path.join(staffDist, 'index.html'), 'utf8');
  const staffLiveHtml = staffHtml.replace(
    '<head>',
    `<head><script>
      localStorage.setItem('mesaya_staff_token', 'mock-jwt-token');
      localStorage.setItem('mesaya_staff_user', JSON.stringify({
        id: 'staff-1',
        restaurantId: 'trattoria-del-puerto',
        name: 'Martín (Salón)',
        role: 'WAITER',
        assignedSector: 'SALON_PRINCIPAL'
      }));
    </script>`
  );
  fs.writeFileSync(path.join(staffDist, 'staff-view.html'), staffLiveHtml);
  capture('http://localhost:8102/staff-view.html', '05_mozo_panel_salon.png', 1024, 768, 2500);

  // 6. Admin: Panel de Control (Gestión de Mesas y Turnos)
  console.log('📸 6. Admin - Gestión de Mesas y Turnos');
  const adminDist = path.join(ROOT_DIR, 'apps/admin-dashboard/dist');
  const adminHtml = fs.readFileSync(path.join(adminDist, 'index.html'), 'utf8');
  const adminLiveHtml = adminHtml.replace(
    '<head>',
    `<head><script>
      localStorage.setItem('mesaya_admin_token', 'mock-admin-token');
      localStorage.setItem('mesaya_admin_restaurant', JSON.stringify({
        id: 'trattoria-del-puerto',
        name: 'Trattoria del Puerto',
        slug: 'trattoria-del-puerto',
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b'
      }));
    </script>`
  );
  fs.writeFileSync(path.join(adminDist, 'admin-view.html'), adminLiveHtml);
  capture('http://localhost:8103/admin-view.html', '06_admin_dashboard_mesas.png', 1366, 850, 3000);

  serverClient.close();
  serverStaff.close();
  serverAdmin.close();
  try { fs.unlinkSync(path.join(staffDist, 'staff-view.html')); } catch (_) {}
  try { fs.unlinkSync(path.join(adminDist, 'admin-view.html')); } catch (_) {}

  console.log('✅ Finalizado.');
}

run();
