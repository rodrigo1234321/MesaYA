const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function capture(htmlFilePath, outFileName, width, height) {
  const outFile = path.join(SCREENSHOTS_DIR, outFileName);
  const fileUrl = `file:///${htmlFilePath.replace(/\\/g, '/')}`;
  const cmd = `"${EDGE_PATH}" --headless --disable-gpu --hide-scrollbars --window-size=${width},${height} --virtual-time-budget=2500 --screenshot="${outFile}" "${fileUrl}"`;
  execSync(cmd, { stdio: 'ignore', timeout: 15000 });
  console.log(`[OK] ${outFileName} (${width}x${height})`);
}

// 1. CLIENTE: HUB DE MESA (390x844)
const htmlCliente1 = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=390, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>MesaYA — Carta & Servicio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="w-[390px] h-[844px] bg-slate-950 p-4 flex flex-col justify-between select-none antialiased box-border overflow-hidden">
  
  <!-- Header de Restaurante y Mesa -->
  <header class="flex items-center justify-between py-1.5 border-b border-slate-800/80 mb-2.5">
    <div class="flex items-center space-x-2.5">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-600 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20 text-lg">
        🍽️
      </div>
      <div>
        <div class="flex items-center gap-1.5">
          <h1 class="font-extrabold text-sm tracking-tight text-white leading-tight">Trattoria del Puerto</h1>
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </div>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Mesa 4
          </span>
          <span class="text-[10px] text-slate-400 font-medium">Terraza</span>
        </div>
      </div>
    </div>

    <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-amber-300 shadow-sm">
      📖 Ver Carta
    </button>
  </header>

  <!-- Botones de Acción Rápida (Above the fold) -->
  <div class="space-y-1.5 mb-2.5">
    <div class="flex items-center justify-between px-0.5">
      <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        <span class="text-amber-400">⚡</span> Servicios a la Mesa
      </span>
      <span class="text-[9px] text-emerald-400 font-semibold flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Mozo en Salón
      </span>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <div class="p-2.5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 flex flex-col items-center justify-between text-center shadow-lg">
        <div class="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-lg">💳</div>
        <div class="mt-1.5">
          <span class="font-extrabold text-[11px] text-white block leading-tight">Pedir Cuenta</span>
          <span class="text-[9px] text-emerald-300 font-medium">Mercado Pago</span>
        </div>
      </div>

      <div class="p-2.5 rounded-2xl bg-slate-900/90 border border-indigo-500/30 flex flex-col items-center justify-between text-center shadow-lg">
        <div class="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-lg">🙋‍♂️</div>
        <div class="mt-1.5">
          <span class="font-extrabold text-[11px] text-white block leading-tight">Llamar Mozo</span>
          <span class="text-[9px] text-indigo-300 font-medium">Asistencia</span>
        </div>
      </div>

      <div class="p-2.5 rounded-2xl bg-slate-900/90 border border-amber-500/30 flex flex-col items-center justify-between text-center shadow-lg">
        <div class="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 text-lg">🧂</div>
        <div class="mt-1.5">
          <span class="font-extrabold text-[11px] text-white block leading-tight">Insumos</span>
          <span class="text-[9px] text-slate-400 font-medium">Hielo / Vajilla</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Hero Gastronómico -->
  <div class="relative overflow-hidden rounded-2xl bg-slate-900 border border-amber-500/30 shadow-xl mb-2.5">
    <div class="relative h-44 w-full overflow-hidden">
      <img src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80" alt="Carta" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
      
      <div class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-slate-950/80 backdrop-blur-md border border-amber-500/40 text-[9px] font-bold text-amber-300 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
        Sugerencias del Chef
      </div>
      <div class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-700 text-[9px] font-semibold text-slate-300">
        ⭐ 4.9 • Cocina Abierta
      </div>

      <div class="absolute bottom-2.5 left-3 right-3 flex items-end justify-between">
        <div>
          <span class="text-[9px] font-bold text-amber-400 uppercase tracking-wider block">Menú & Precios 2026</span>
          <h2 class="text-sm font-extrabold text-white leading-tight">Explorar Carta Completa</h2>
        </div>
        <button class="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-[11px] shadow-md shadow-amber-500/30 flex items-center gap-1">
          Ver Todo →
        </button>
      </div>
    </div>
  </div>

  <!-- Platos Estrella -->
  <div class="space-y-2 mb-2">
    <div class="flex items-center justify-between px-0.5">
      <h3 class="text-[10px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1">
        ⭐ Especialidades de la Casa
      </h3>
      <span class="text-[9px] text-slate-400">Precios en ARS</span>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="bg-slate-900/90 border border-slate-800 p-2.5 rounded-2xl space-y-1.5">
        <img src="https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=300" class="w-full h-20 rounded-xl object-cover">
        <h4 class="font-bold text-xs text-white leading-tight">Sorrentinos Salmón</h4>
        <div class="flex justify-between items-center">
          <span class="text-xs font-extrabold text-amber-400">$14.500</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">Chef Pick</span>
        </div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 p-2.5 rounded-2xl space-y-1.5">
        <img src="https://images.unsplash.com/photo-1587740908075-9e245070dfaa?w=300" class="w-full h-20 rounded-xl object-cover">
        <h4 class="font-bold text-xs text-white leading-tight">Ravioles de Cordero</h4>
        <div class="flex justify-between items-center">
          <span class="text-xs font-extrabold text-amber-400">$13.200</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">Casero</span>
        </div>
      </div>
    </div>
  </div>

  <footer class="text-center py-1">
    <p class="text-[9px] text-slate-500 font-medium">MesaYA • Servicio Digital a la Mesa • Mar del Plata</p>
  </footer>
</body>
</html>`;

// 2. CLIENTE: CARTA DIGITAL COMPLETA (390x844)
const htmlCliente2 = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=390, initial-scale=1.0">
  <title>MesaYA — Carta Digital</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[390px] h-[844px] bg-slate-950 p-4 flex flex-col justify-between select-none antialiased box-border overflow-hidden">
  
  <!-- Header Modal Carta -->
  <header class="flex items-center justify-between pb-2.5 border-b border-slate-800 mb-2">
    <div class="flex items-center gap-2">
      <span class="text-xl">📖</span>
      <div>
        <h1 class="text-sm font-extrabold text-white">Carta Digital & Precios</h1>
        <p class="text-[10px] text-amber-400 font-medium">Trattoria del Puerto • Autor 2026</p>
      </div>
    </div>
    <span class="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-300">Mesa 4</span>
  </header>

  <!-- Category Pills Switcher -->
  <div class="flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-2 no-scrollbar text-xs">
    <button class="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-[11px] shadow-sm whitespace-nowrap">🍝 Pastas (4)</button>
    <button class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold text-[11px] whitespace-nowrap">🥩 Carnes (3)</button>
    <button class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold text-[11px] whitespace-nowrap">🍹 Tragos (5)</button>
    <button class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold text-[11px] whitespace-nowrap">🍰 Postres (3)</button>
  </div>

  <!-- Menu Dish Items List -->
  <div class="space-y-2.5 flex-1 overflow-y-auto mb-2 pr-0.5">
    <!-- Item 1 -->
    <div class="bg-slate-900/90 border border-slate-800/90 p-2.5 rounded-2xl flex items-center justify-between gap-2.5 shadow-md">
      <div class="space-y-1 flex-1">
        <div class="flex items-center gap-1.5">
          <h4 class="font-extrabold text-xs text-white">Sorrentinos de Salmón & Puerros</h4>
          <span class="text-[8px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">Chef Pick</span>
        </div>
        <p class="text-[10px] text-slate-400 line-clamp-2">Con crema suave de puerros, crocante de nueces y toque de ciboulette fresco.</p>
        <span class="text-xs font-extrabold text-amber-400 block">$14.500</span>
      </div>
      <img src="https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=200" class="w-16 h-16 rounded-xl object-cover shrink-0">
    </div>

    <!-- Item 2 -->
    <div class="bg-slate-900/90 border border-slate-800/90 p-2.5 rounded-2xl flex items-center justify-between gap-2.5 shadow-md">
      <div class="space-y-1 flex-1">
        <div class="flex items-center gap-1.5">
          <h4 class="font-extrabold text-xs text-white">Ravioles de Cordero Braseado</h4>
          <span class="text-[8px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">Casero</span>
        </div>
        <p class="text-[10px] text-slate-400 line-clamp-2">Cocción lenta en vino Malbec, salvia fresca y lluvia de parmesano estacionado.</p>
        <span class="text-xs font-extrabold text-amber-400 block">$13.200</span>
      </div>
      <img src="https://images.unsplash.com/photo-1587740908075-9e245070dfaa?w=200" class="w-16 h-16 rounded-xl object-cover shrink-0">
    </div>

    <!-- Item 3 -->
    <div class="bg-slate-900/90 border border-slate-800/90 p-2.5 rounded-2xl flex items-center justify-between gap-2.5 shadow-md">
      <div class="space-y-1 flex-1">
        <div class="flex items-center gap-1.5">
          <h4 class="font-extrabold text-xs text-white">Bife de Chorizo Ojo de Bife</h4>
          <span class="text-[8px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">450g</span>
        </div>
        <p class="text-[10px] text-slate-400 line-clamp-2">Acompañado de papas rústicas al romero y manteca de hierbas.</p>
        <span class="text-xs font-extrabold text-amber-400 block">$18.900</span>
      </div>
      <img src="https://images.unsplash.com/photo-1544025162-d76694265947?w=200" class="w-16 h-16 rounded-xl object-cover shrink-0">
    </div>

    <!-- Item 4 -->
    <div class="bg-slate-900/90 border border-slate-800/90 p-2.5 rounded-2xl flex items-center justify-between gap-2.5 shadow-md">
      <div class="space-y-1 flex-1">
        <div class="flex items-center gap-1.5">
          <h4 class="font-extrabold text-xs text-white">Aperol Spritz Clásico</h4>
          <span class="text-[8px] px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-300 font-bold border border-orange-500/30">Tragos</span>
        </div>
        <p class="text-[10px] text-slate-400 line-clamp-2">Prosecco italiano, Aperol, golpe de soda y rodaja de naranja fresca.</p>
        <span class="text-xs font-extrabold text-amber-400 block">$6.800</span>
      </div>
      <img src="https://images.unsplash.com/photo-1560512823-829485b8bf24?w=200" class="w-16 h-16 rounded-xl object-cover shrink-0">
    </div>
  </div>

  <!-- Bottom CTA Fixed Buttons -->
  <div class="pt-2 border-t border-slate-800 flex gap-2">
    <button class="px-3.5 py-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/40 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md">
      <span>✨</span>
      <span>Sommelier IA</span>
    </button>
    <button class="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 font-extrabold text-xs text-slate-950 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20">
      <span>🙋 Llamar al Mozo para Pedir</span>
    </button>
  </div>
</body>
</html>`;

// 3. CLIENTE: LLAMADO EN CAMINO (390x844)
const htmlCliente3 = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=390, initial-scale=1.0">
  <title>MesaYA — Mozo en Camino</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[390px] h-[844px] bg-slate-950 p-4 flex flex-col justify-between select-none antialiased box-border overflow-hidden">
  
  <header class="flex items-center justify-between py-1.5 border-b border-slate-800/80 mb-3">
    <div class="flex items-center space-x-2.5">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 text-lg">🍽️</div>
      <div>
        <h1 class="font-extrabold text-sm text-white">Trattoria del Puerto</h1>
        <p class="text-[10px] text-amber-400 font-bold">Mesa 4 • Terraza</p>
      </div>
    </div>
    <span class="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-extrabold">🟢 Mozo Conectado</span>
  </header>

  <!-- LLAMADO ACTIVO HERO NOTIFICATION -->
  <div class="my-auto space-y-4">
    <div class="rounded-3xl bg-gradient-to-b from-indigo-950 to-slate-900 border-2 border-amber-500 p-5 shadow-2xl space-y-4 text-center">
      <div class="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto text-3xl shadow-lg shadow-amber-500/20">
        🏃‍♂️
      </div>

      <div class="space-y-1">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
          Mozo en Camino a tu Mesa
        </span>
        <h2 class="text-base font-extrabold text-white pt-1">Pedido de Cuenta Confirmado</h2>
        <p class="text-xs text-slate-300">El mozo de tu sector ya recibió la solicitud y se está acercando con el posnet / QR.</p>
      </div>

      <div class="bg-slate-950/90 rounded-2xl p-3.5 border border-slate-800 text-left space-y-2">
        <div class="flex justify-between items-center text-xs">
          <span class="text-slate-400">Medio de Pago:</span>
          <span class="font-extrabold text-emerald-400">Mercado Pago (QR)</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-slate-400">Tiempo de Espera:</span>
          <span class="font-mono text-amber-400 font-bold">0:45 min</span>
        </div>
      </div>

      <button class="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold text-xs text-slate-200">
        ✓ Ya fui atendido / Cancelar
      </button>
    </div>
  </div>

  <footer class="text-center py-1">
    <p class="text-[9px] text-slate-500">MesaYA • Servicio en tiempo real sin esperas</p>
  </footer>
</body>
</html>`;

// 4. CLIENTE: DETALLE DE PLATO CON MARIDAJE (390x844)
const htmlCliente4 = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=390, initial-scale=1.0">
  <title>MesaYA — Ficha del Plato</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[390px] h-[844px] bg-slate-950 p-4 flex flex-col justify-between select-none antialiased box-border overflow-hidden">
  
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex justify-between items-center pb-2 border-b border-slate-800">
      <span class="text-xs font-bold text-amber-400">⭐ Especialidad del Chef</span>
      <span class="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-300">Mesa 4</span>
    </div>

    <!-- Plato Big Image -->
    <div class="relative h-56 w-full rounded-2xl overflow-hidden shadow-2xl border border-amber-500/30">
      <img src="https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
      <span class="absolute bottom-3 left-3 px-3 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md text-amber-400 font-extrabold text-base border border-amber-500/40">$14.500</span>
    </div>

    <!-- Title & Description -->
    <div class="space-y-2">
      <h2 class="text-lg font-extrabold text-white leading-tight">Sorrentinos de Salmón & Puerros</h2>
      <p class="text-xs text-slate-300 leading-relaxed">
        Masa casera elaborada con sémola de grano duro, rellenos con salmón rosado fresco y puerros caramelizados. Servidos con salsa suave de crema y lluvia de nueces crocantes.
      </p>

      <div class="flex gap-1.5 pt-1">
        <span class="text-[10px] px-2.5 py-1 rounded-lg font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">⭐ Chef Pick</span>
        <span class="text-[10px] px-2.5 py-1 rounded-lg font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">🌾 Sin TACC</span>
        <span class="text-[10px] px-2.5 py-1 rounded-lg font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Pasta Casera</span>
      </div>
    </div>

    <!-- Maridaje Sommelier IA Box -->
    <div class="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 space-y-1">
      <div class="flex items-center gap-1.5 text-amber-400 font-extrabold text-xs">
        <span>✨</span>
        <span>Maridaje Sugerido por Sommelier IA</span>
      </div>
      <p class="text-[11px] text-slate-300">
        Recomendado con <strong>Sauvignon Blanc Marítimo</strong> o <strong>Copa de Chardonnay Reserva</strong> para realzar los sabores del salmón rosado.
      </p>
    </div>
  </div>

  <div class="pt-3 border-t border-slate-800 flex gap-2">
    <button class="flex-1 py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 font-extrabold text-xs text-slate-950 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/30">
      <span>🙋 Llamar al Mozo para Pedir este Plato</span>
    </button>
  </div>
</body>
</html>`;

// 5. MOZO: PANEL DE SALÓN EN SMARTPHONE (390x844)
const htmlMozoMobile = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=390, initial-scale=1.0">
  <title>MesaYA Staff — Móvil</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[390px] h-[844px] bg-slate-950 p-4 flex flex-col justify-between select-none antialiased box-border overflow-hidden">
  
  <div class="space-y-3">
    <!-- Header -->
    <header class="flex items-center justify-between p-3 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-md">
      <div class="flex items-center space-x-2.5">
        <div class="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-lg">🍽️</div>
        <div>
          <h1 class="text-xs font-extrabold text-white">Trattoria del Puerto</h1>
          <p class="text-[10px] text-slate-400">Mozo: <span class="text-amber-400 font-bold">Martín (Salón)</span></p>
        </div>
      </div>
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse"></span>
        SSE Vivo
      </span>
    </header>

    <!-- Sectors -->
    <div class="flex items-center space-x-1.5 text-[11px]">
      <button class="px-3 py-1 rounded-xl bg-amber-500 text-slate-950 font-extrabold shadow-sm">Todos (2)</button>
      <button class="px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold">Salón (1)</button>
      <button class="px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold">Terraza (1)</button>
    </div>

    <!-- Comandas -->
    <div class="space-y-3">
      <!-- Comanda 1 -->
      <div class="bg-slate-900/95 border-2 border-emerald-500/60 rounded-2xl p-3.5 shadow-xl space-y-2.5">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-lg font-extrabold text-white">Mesa 4</span>
              <span class="text-[9px] px-2 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">Terraza</span>
            </div>
            <p class="text-[10px] text-amber-400 font-semibold mt-0.5">⏱️ Hace 1 min</p>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            💳 Pedir Cuenta
          </span>
        </div>
        <div class="bg-slate-950/80 p-2 rounded-xl border border-slate-800 text-[11px]">
          <p class="text-slate-300">Medio de Pago: <span class="text-emerald-400 font-extrabold">Mercado Pago (QR)</span></p>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-0.5">
          <button class="py-2 px-2.5 rounded-xl bg-indigo-600 text-white font-extrabold text-xs shadow-md">En camino</button>
          <button class="py-2 px-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs shadow-md">✓ Resolver</button>
        </div>
      </div>

      <!-- Comanda 2 -->
      <div class="bg-slate-900/95 border-2 border-amber-500/60 rounded-2xl p-3.5 shadow-xl space-y-2.5">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-lg font-extrabold text-white">Mesa 1</span>
              <span class="text-[9px] px-2 py-0.2 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">Salón</span>
            </div>
            <p class="text-[10px] text-amber-400 font-semibold mt-0.5">⏱️ Hace 3 min</p>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            🙋 Llamar Mozo
          </span>
        </div>
        <div class="bg-slate-950/80 p-2 rounded-xl border border-slate-800 text-[11px]">
          <p class="text-slate-300">Comensal solicita asistencia para el pedido.</p>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-0.5">
          <button class="py-2 px-2.5 rounded-xl bg-indigo-600 text-white font-extrabold text-xs shadow-md">En camino</button>
          <button class="py-2 px-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs shadow-md">✓ Resolver</button>
        </div>
      </div>
    </div>
  </div>

  <footer class="text-center text-[10px] text-slate-500">MesaYA Staff — Notificaciones en vivo sincronizadas</footer>
</body>
</html>`;

// 6. MOZO: PANEL DE SALÓN EN TABLET (800x560)
const htmlMozoTablet = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <title>MesaYA Staff — Panel de Mozos</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[800px] h-[560px] bg-slate-950 p-4 font-sans select-none flex flex-col justify-between box-border overflow-hidden">
  <div class="w-full space-y-3">
    
    <!-- Top Header -->
    <header class="flex items-center justify-between p-3.5 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-md">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl">🍽️</div>
        <div>
          <h1 class="text-sm font-extrabold text-white">Trattoria del Puerto</h1>
          <p class="text-xs text-slate-400">Mozo en Salón: <span class="text-amber-400 font-bold">Martín (Salón & Terraza)</span></p>
        </div>
      </div>
      <div class="flex items-center space-x-2.5">
        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          <span class="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
          SSE En Vivo
        </span>
        <button class="px-3 py-1 rounded-xl bg-slate-800 text-xs font-bold text-slate-300 border border-slate-700">Salir</button>
      </div>
    </header>

    <!-- Sectors Filter -->
    <div class="flex items-center space-x-2 text-xs">
      <button class="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-extrabold shadow-md">Todos (2)</button>
      <button class="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold">Salón Principal (1)</button>
      <button class="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold">Terraza (1)</button>
      <button class="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold opacity-50">Barra (0)</button>
    </div>

    <!-- Live Call Cards Grid -->
    <div class="grid grid-cols-2 gap-3.5">
      
      <!-- Card 1 -->
      <div class="bg-slate-900/95 border-2 border-emerald-500/50 rounded-2xl p-4 shadow-xl space-y-3 relative overflow-hidden">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xl font-extrabold text-white">Mesa 4</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">Terraza</span>
            </div>
            <p class="text-xs text-amber-400 font-semibold mt-0.5">⏱️ Hace 1 min</p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            💳 Pedir Cuenta
          </span>
        </div>
        <div class="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-xs">
          <p class="text-slate-300">Medio de Pago: <span class="text-emerald-400 font-extrabold">Mercado Pago (QR)</span></p>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button class="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs shadow-md">En camino</button>
          <button class="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md">✓ Resolver</button>
        </div>
      </div>

      <!-- Card 2 -->
      <div class="bg-slate-900/95 border-2 border-amber-500/50 rounded-2xl p-4 shadow-xl space-y-3 relative overflow-hidden">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xl font-extrabold text-white">Mesa 1</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">Salón</span>
            </div>
            <p class="text-xs text-amber-400 font-semibold mt-0.5">⏱️ Hace 3 min</p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            🙋 Llamar Mozo
          </span>
        </div>
        <div class="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-xs">
          <p class="text-slate-300">Comensal solicita asistencia para el pedido.</p>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button class="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs shadow-md">En camino</button>
          <button class="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md">✓ Resolver</button>
        </div>
      </div>

    </div>
  </div>

  <footer class="text-center text-xs text-slate-500">MesaYA Staff — Notificaciones en vivo sincronizadas por salón</footer>
</body>
</html>`;

// 7. ADMIN: DASHBOARD GERENCIAL (1280x750)
const htmlAdmin = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <title>MesaYA — Panel Gerencial</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; } </style>
</head>
<body class="w-[1280px] h-[750px] bg-slate-950 p-6 font-sans select-none flex flex-col justify-between box-border overflow-hidden">
  <div class="w-full space-y-4">
    
    <!-- Top Nav -->
    <header class="flex items-center justify-between p-4 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-lg">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl">⚙️</div>
        <div>
          <h1 class="text-base font-extrabold text-white">MesaYA Admin — Trattoria del Puerto</h1>
          <p class="text-xs text-slate-400">Plan: <span class="text-amber-400 font-bold">LEAN • Turno Activo (Noche)</span></p>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <div class="flex space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button class="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold">Mesas & QR</button>
          <button class="px-3 py-1.5 rounded-lg text-slate-300 font-bold hover:bg-slate-900">Carta & Precios</button>
          <button class="px-3 py-1.5 rounded-lg text-slate-300 font-bold hover:bg-slate-900">Personal & PINs</button>
          <button class="px-3 py-1.5 rounded-lg text-slate-300 font-bold hover:bg-slate-900">Métricas</button>
        </div>
        <button class="px-4 py-2 rounded-xl bg-red-950/80 text-red-300 border border-red-800 text-xs font-bold">Cerrar Turno</button>
      </div>
    </header>

    <!-- Metrics Cards Grid -->
    <div class="grid grid-cols-4 gap-3.5">
      <div class="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-1 shadow-md">
        <span class="text-xs text-slate-400">Llamados Atendidos Hoy</span>
        <h3 class="text-2xl font-extrabold text-white">48</h3>
        <p class="text-[11px] text-emerald-400 font-semibold">↑ 14% vs fin de semana anterior</p>
      </div>
      <div class="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-1 shadow-md">
        <span class="text-xs text-slate-400">Tiempo de Respuesta Promedio</span>
        <h3 class="text-2xl font-extrabold text-amber-400">1.8 min</h3>
        <p class="text-[11px] text-emerald-400 font-semibold">⭐ Nivel de Servicio Óptimo</p>
      </div>
      <div class="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-1 shadow-md">
        <span class="text-xs text-slate-400">Ocupación de Salón</span>
        <h3 class="text-2xl font-extrabold text-indigo-400">8 / 10</h3>
        <p class="text-[11px] text-slate-400">80% de mesas activas</p>
      </div>
      <div class="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-1 shadow-md">
        <span class="text-xs text-slate-400">Cobro con Mercado Pago</span>
        <h3 class="text-2xl font-extrabold text-emerald-400">72%</h3>
        <p class="text-[11px] text-emerald-400 font-semibold">Agilidad en rotación de mesas</p>
      </div>
    </div>

    <!-- Table Grid in Salon -->
    <div class="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 space-y-3 shadow-lg">
      <div class="flex justify-between items-center">
        <h3 class="text-xs font-extrabold text-white uppercase tracking-wider">Mapa de Mesas & Códigos QR en Salón</h3>
        <span class="text-xs text-slate-400">Click en cualquier mesa para reimprimir QR o forzar liberación</span>
      </div>
      <div class="grid grid-cols-5 gap-3 text-xs">
        <div class="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-1">
          <div class="flex justify-between items-center"><span class="font-extrabold text-white">Mesa 1</span><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span></div>
          <span class="text-[10px] text-slate-400 block">Salón</span>
          <span class="text-[10px] text-emerald-400 font-bold">Ocupada</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-1">
          <div class="flex justify-between items-center"><span class="font-extrabold text-white">Mesa 2</span><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span></div>
          <span class="text-[10px] text-slate-400 block">Salón</span>
          <span class="text-[10px] text-emerald-400 font-bold">Ocupada</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border-2 border-amber-500 space-y-1 shadow-lg shadow-amber-500/10">
          <div class="flex justify-between items-center"><span class="font-extrabold text-amber-300">Mesa 3</span><span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span></div>
          <span class="text-[10px] text-slate-400 block">Salón</span>
          <span class="text-[10px] text-amber-400 font-extrabold">Llamado Activo</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-1">
          <div class="flex justify-between items-center"><span class="font-extrabold text-white">Mesa 4</span><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span></div>
          <span class="text-[10px] text-slate-400 block">Terraza</span>
          <span class="text-[10px] text-emerald-400 font-bold">Ocupada</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 opacity-50">
          <div class="flex justify-between items-center"><span class="font-extrabold text-white">Mesa 5</span><span class="w-2 h-2 rounded-full bg-slate-600"></span></div>
          <span class="text-[10px] text-slate-400 block">Terraza</span>
          <span class="text-[10px] text-slate-400 font-bold">Libre</span>
        </div>
      </div>
    </div>
  </div>

  <footer class="text-center text-xs text-slate-500">MesaYA Admin — Panel de Control y Auditoría Operativa</footer>
</body>
</html>`;

const tmpC1 = path.join(SCREENSHOTS_DIR, 'tmp_c1.html');
const tmpC2 = path.join(SCREENSHOTS_DIR, 'tmp_c2.html');
const tmpC3 = path.join(SCREENSHOTS_DIR, 'tmp_c3.html');
const tmpC4 = path.join(SCREENSHOTS_DIR, 'tmp_c4.html');
const tmpMozoMob = path.join(SCREENSHOTS_DIR, 'tmp_mozo_mob.html');
const tmpMozoTab = path.join(SCREENSHOTS_DIR, 'tmp_mozo_tab.html');
const tmpAdmin = path.join(SCREENSHOTS_DIR, 'tmp_admin.html');

fs.writeFileSync(tmpC1, htmlCliente1);
fs.writeFileSync(tmpC2, htmlCliente2);
fs.writeFileSync(tmpC3, htmlCliente3);
fs.writeFileSync(tmpC4, htmlCliente4);
fs.writeFileSync(tmpMozoMob, htmlMozoMobile);
fs.writeFileSync(tmpMozoTab, htmlMozoTablet);
fs.writeFileSync(tmpAdmin, htmlAdmin);

console.log('🚀 Generando capturas a resolución móvil nativa...');

// 4 Vistas Móviles de Cliente (390x844 - Perfectas para ver en Celular)
capture(tmpC1, '01_cliente_hub_servicios.png', 390, 844);
capture(tmpC2, '02_cliente_carta_digital.png', 390, 844);
capture(tmpC3, '03_cliente_llamado_en_camino.png', 390, 844);
capture(tmpC4, '04_cliente_detalle_plato.png', 390, 844);

// 2 Vistas de Mozo (Móvil 390x844 y Tablet 800x560)
capture(tmpMozoMob, '05_mozo_panel_movil.png', 390, 844);
capture(tmpMozoTab, '06_mozo_panel_tablet.png', 800, 560);

// 1 Vista de Admin (Desktop 1280x750)
capture(tmpAdmin, '07_admin_dashboard_gerencial.png', 1280, 750);

// Cleanup
fs.unlinkSync(tmpC1);
fs.unlinkSync(tmpC2);
fs.unlinkSync(tmpC3);
fs.unlinkSync(tmpC4);
fs.unlinkSync(tmpMozoMob);
fs.unlinkSync(tmpMozoTab);
fs.unlinkSync(tmpAdmin);

console.log('🎉 Todas las capturas móviles y de panel listas.');
