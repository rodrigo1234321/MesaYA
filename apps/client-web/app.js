const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.VITE_API_URL) {
    return window.VITE_API_URL.replace(/\/$/, '');
  }
  try {
    if (import.meta && import.meta.env && import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL.replace(/\/$/, '');
    }
  } catch (_) {}
  const protocol = (typeof window !== 'undefined' && window.location.protocol && window.location.protocol.startsWith('http')) ? window.location.protocol : 'http:';
  const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
  return isLocal ? `${protocol}//${host}:3000/v1` : `${protocol}//${host}/v1`;
})();

let currentSession = null;
let currentToken = null;
let activeCall = null;
let pollTimer = null;
let pollAbortController = null;
let isPollingBusy = false;
let pollFailures = 0;
let callTimerInterval = null;
let lastCallType = 'WAITER';

// ==========================================
// CART / ORDER STATE (Customer Direct Ordering)
// ==========================================
let cartOrder = null;         // Active OrderDTO from server (null = no active order)
let cartSubmitting = false;   // Guard against double-submit
let cartAdding = false;       // Guard against duplicate add requests on slow mobile networks
let cartDishQty = 1;          // Quantity selector in dish detail sheet
let cartDishNotes = '';       // Notes field in dish detail sheet

function getGuestSessionId() {
  let gid = sessionStorage.getItem('mesaya_guest_session_id');
  if (!gid) {
    gid = 'gw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('mesaya_guest_session_id', gid);
  }
  return gid;
}

function canOrderDirectly() {
  if (!currentToken) return false;
  // Fail closed while the server configuration is still loading or unavailable.
  if (!restaurantConfigLoaded) return false;
  if (activeRestaurantConfig && activeRestaurantConfig.allowOrdering === false) return false;
  return true;
}

function cartItemCount() {
  if (!cartOrder || !cartOrder.items) return 0;
  return cartOrder.items.reduce((s, i) => s + i.quantity, 0);
}

function cartTotalAmount() {
  if (!cartOrder || !cartOrder.items) return 0;
  return cartOrder.totalAmount || 0;
}

async function loadActiveOrder() {
  if (!currentToken) return;
  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/active`, {
      headers: { 'x-session-token': currentToken }
    });
    if (res && res.ok) {
      const data = await res.json();
      cartOrder = data.order || null;
    }
  } catch (_) {}
  renderCartBadge();
}

async function addCartItem(menuItemId, quantity, notes) {
  if (!currentToken) return;
  // Las mutaciones no se reintentan automáticamente: si el servidor confirma
  // y la red demora la respuesta, repetir el POST duplicaría la comanda.
  const res = await fetchWithRetry(`${API_BASE}/orders/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionToken: currentToken,
      guestSessionId: getGuestSessionId(),
      menuItemId,
      quantity,
      notes: notes || undefined
    })
  }, 1, 10000);
  const data = await res.json();
  if (!res.ok) {
    handleOrderError(res.status, data);
    return null;
  }
  cartOrder = data;
  renderCartBadge();
  return data;
}

async function removeCartItem(orderItemId) {
  if (!currentToken) return;
  const res = await fetchWithRetry(`${API_BASE}/orders/items/${orderItemId}`, {
    method: 'DELETE',
    headers: { 'x-session-token': currentToken }
  }, 1, 10000);
  const data = await res.json();
  if (!res.ok) {
    handleOrderError(res.status, data);
    return null;
  }
  cartOrder = data;
  renderCartBadge();
  renderCartDrawer();
  return data;
}

async function submitCartOrder() {
  if (!currentToken || cartSubmitting) return;
  if (!cartOrder || !cartOrder.items || cartOrder.items.length === 0) {
    showToast('No hay ítems en el carrito para enviar.', 'warning');
    return;
  }
  cartSubmitting = true;
  renderCartSubmitBtn();
  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: currentToken })
    }, 1, 10000);
    const data = await res.json();
    if (!res.ok) {
      handleOrderError(res.status, data);
      return;
    }
    cartOrder = data;
    renderCartBadge();
    closeCartDrawer();
    if (data.status === 'IN_KITCHEN') {
      showToast('¡Pedido enviado directo a cocina! 🍳', 'success');
    } else if (data.status === 'PENDING_VALIDATION') {
      showToast('¡Pedido enviado! El mozo lo validará antes de enviarlo a cocina. ✅', 'success');
    } else {
      showToast('Pedido enviado exitosamente.', 'success');
    }
  } catch (err) {
    showToast('No se pudo conectar con el servidor. Tu pedido no se perdió.', 'error');
  } finally {
    cartSubmitting = false;
    renderCartSubmitBtn();
  }
}

function handleOrderError(status, data) {
  const msg = data && data.error ? data.error : '';
  if (status === 401 || status === 410) {
    showExpiredState(msg || 'La sesión de mesa ha finalizado.');
    stopPolling();
    return;
  }
  if (status === 403) {
    showToast(msg || 'Las comandas digitales no están habilitadas en este restaurante.', 'error');
    return;
  }
  if (status === 422) {
    showToast(msg || 'El plato seleccionado no está disponible.', 'warning');
    return;
  }
  if (status === 503) {
    showToast(msg || 'Servicio temporalmente no disponible. Intentá en unos segundos.', 'warning');
    return;
  }
  showToast(msg || 'Ocurrió un error al procesar el pedido.', 'error');
}

// ==========================================
// SEGURIDAD Y SANITIZACIÓN CONTEXTUAL (Etapa 19)
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

const ALLOWED_IMAGE_HOSTS = new Set([
  'images.unsplash.com',
  'plus.unsplash.com'
]);

function sanitizeUrl(url, fallback = '', allowedHosts = ALLOWED_IMAGE_HOSTS) {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;

  // Rechazar barras invertidas ('\') y caracteres de control/espacios internos
  if (trimmed.includes('\\') || /[\x00-\x1F\x7F\s]/.test(trimmed)) {
    return fallback;
  }

  // Rutas relativas seguras (/ o ./) pero no protocol-relative (//)
  if (trimmed.startsWith('/') || trimmed.startsWith('./')) {
    if (trimmed.startsWith('//')) return fallback;

    try {
      const dummyOrigin = 'http://localhost-guard.local';
      const parsed = new URL(trimmed, dummyOrigin);

      if (parsed.origin !== dummyOrigin) return fallback;
      if (parsed.username || parsed.password) return fallback;
      if (!parsed.pathname.startsWith('/')) return fallback;

      if (trimmed.startsWith('./')) {
        return '.' + parsed.pathname + parsed.search + parsed.hash;
      }
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
      return fallback;
    }
  }

  // URLs absolutas HTTP y HTTPS con allowlist estricta
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return fallback;
    }

    if (parsed.username || parsed.password) {
      return fallback;
    }

    // Rechazar puertos no estándar según el protocolo específico
    if (protocol === 'http:') {
      if (parsed.port && parsed.port !== '80') {
        return fallback;
      }
    } else if (protocol === 'https:') {
      if (parsed.port && parsed.port !== '443') {
        return fallback;
      }
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!allowedHosts.has(hostname)) {
      return fallback;
    }

    return parsed.href;
  } catch (_) {}

  return fallback;
}

function sanitizeGooglePlaceId(placeId) {
  if (!placeId || typeof placeId !== 'string') return null;
  const trimmed = placeId.trim();
  if (/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

// Toast Notification System (DOM seguro con textContent)
function showToast(message, type = 'info', duration = 3500) {
  triggerHaptic();
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto p-3.5 rounded-2xl border shadow-xl flex items-center gap-3 transition-all duration-300 transform translate-y-2 opacity-0 text-xs font-bold';

  let icon = 'ℹ️';
  let theme = 'bg-slate-900/95 border-slate-700 text-slate-100 shadow-slate-950/50';

  if (type === 'success') {
    icon = '✅';
    theme = 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200 shadow-emerald-950/40';
  } else if (type === 'error') {
    icon = '⚠️';
    theme = 'bg-red-950/95 border-red-500/50 text-red-200 shadow-red-950/40';
  } else if (type === 'warning') {
    icon = '🔔';
    theme = 'bg-amber-950/95 border-amber-500/50 text-amber-200 shadow-amber-950/40';
  }

  toast.className += ` ${theme}`;

  // Creación segura de nodos DOM sin innerHTML
  const iconSpan = document.createElement('span');
  iconSpan.className = 'text-base';
  iconSpan.textContent = icon;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'flex-1';
  msgSpan.textContent = String(message || '');

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// DOM Elements
const el = {
  restaurantName: document.getElementById('restaurantName'),
  tableBadge: document.getElementById('tableBadge'),
  sectorBadge: document.getElementById('sectorBadge'),
  btnOpenMenuHeader: document.getElementById('btnOpenMenuHeader'),
  btnOpenMenuHero: document.getElementById('btnOpenMenuHero'),
  heroCoverImage: document.getElementById('heroCoverImage'),
  stateLoading: document.getElementById('stateLoading'),
  stateExpired: document.getElementById('stateExpired'),
  expiredMessageText: document.getElementById('expiredMessageText'),
  actionsContainer: document.getElementById('actionsContainer'),
  heroMenuCard: document.getElementById('heroMenuCard'),
  activeCallCard: document.getElementById('activeCallCard'),
  activeCallTitle: document.getElementById('activeCallTitle'),
  activeCallSubtitle: document.getElementById('activeCallSubtitle'),
  activeCallBadge: document.getElementById('activeCallBadge'),
  activeCallDetailText: document.getElementById('activeCallDetailText'),
  activeCallTimer: document.getElementById('activeCallTimer'),
  btnCancelCall: document.getElementById('btnCancelCall'),
  btnReactivateSession: document.getElementById('btnReactivateSession'),
  btnActionBill: document.getElementById('btnActionBill'),
  btnActionWaiter: document.getElementById('btnActionWaiter'),
  btnActionSupplies: document.getElementById('btnActionSupplies'),
  modalBill: document.getElementById('modalBill'),
  modalBillTotal: document.getElementById('modalBillTotal'),
  modalBillStatusText: document.getElementById('modalBillStatusText'),
  btnToggleBillDetails: document.getElementById('btnToggleBillDetails'),
  modalBillItemsContainer: document.getElementById('modalBillItemsContainer'),
  modalBillItemsList: document.getElementById('modalBillItemsList'),
  modalBillNoItems: document.getElementById('modalBillNoItems'),
  modalBillItemCount: document.getElementById('modalBillItemCount'),
  accordionArrow: document.getElementById('accordionArrow'),
  modalWaiter: document.getElementById('modalWaiter'),
  modalSupplies: document.getElementById('modalSupplies'),
  modalMenu: document.getElementById('modalMenu'),
  menuImage: document.getElementById('menuImage'),
  heroCategoryPillsContainer: document.getElementById('heroCategoryPillsContainer'),
  dynamicMenuCategoriesContainer: document.getElementById('dynamicMenuCategoriesContainer'),
  btnCloseModalBill: document.getElementById('btnCloseModalBill'),
  btnCloseModalWaiter: document.getElementById('btnCloseModalWaiter'),
  btnCloseModalSupplies: document.getElementById('btnCloseModalSupplies'),
  btnCloseModalMenu: document.getElementById('btnCloseModalMenu'),
  btnOrderFromMenu: document.getElementById('btnOrderFromMenu'),
  customSupplyNote: document.getElementById('customSupplyNote'),
  btnSubmitCustomSupply: document.getElementById('btnSubmitCustomSupply')
};

// Unified Table Params Extraction (supports /r/:slug/mesa/:label, /mesa/:label, and query params)
function getTableParams() {
  const parsed = {
    token: null,
    restaurantSlug: null,
    tableLabel: null
  };
  if (typeof window === 'undefined') return parsed;

  const pathname = decodeURIComponent(window.location.pathname || '');
  const search = window.location.search || '';
  const params = new URLSearchParams(search);

  // 1. Pathname: /r/:slug/mesa/:label
  const rMatch = pathname.match(/\/r\/([^\/]+)\/mesa\/([^\/]+)/i);
  if (rMatch) {
    parsed.restaurantSlug = rMatch[1];
    parsed.tableLabel = rMatch[2];
  } else {
    // Pathname: /mesa/:label
    const mMatch = pathname.match(/\/mesa\/([^\/]+)/i);
    if (mMatch) {
      parsed.tableLabel = mMatch[1];
    }
  }

  // 2. Query Params
  if (params.get('token')) parsed.token = params.get('token');
  if (params.get('r') || params.get('restaurante')) parsed.restaurantSlug = params.get('r') || params.get('restaurante');
  if (params.get('m') || params.get('mesa')) parsed.tableLabel = params.get('m') || params.get('mesa');

  // Reject demo-token, latest, null, undefined outside explicit testing
  if (parsed.token === 'demo-token' || parsed.token === 'latest' || parsed.token === 'null' || parsed.token === 'undefined') {
    parsed.token = null;
    sessionStorage.removeItem('mesaya_token');
  }

  if (parsed.token) {
    sessionStorage.setItem('mesaya_token', parsed.token);
  } else {
    const stored = sessionStorage.getItem('mesaya_token');
    if (stored && stored !== 'demo-token' && stored !== 'latest' && stored !== 'null' && stored !== 'undefined') {
      parsed.token = stored;
    } else {
      parsed.token = currentToken || null;
    }
  }

  return parsed;
}

function getToken() {
  return getTableParams().token;
}

function triggerHaptic() {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([40, 60, 40]);
    } catch (_) {}
  }
}

// Just-in-time Geolocation grabber (2.5s max timeout)
async function getDeviceCoordinates() {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
      },
      () => {
        clearTimeout(timeout);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 2500, maximumAge: 60000 }
    );
  });
}

// Fetch with automatic retry
async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 3000) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      if (i === retries - 1) throw err;
    }
  }
}

function formatSector(sector) {
  const map = {
    SALON_PRINCIPAL: 'Salón Principal',
    TERRAZA: 'Terraza',
    PLANTA_ALTA: 'Planta Alta',
    VEREDA: 'Vereda',
    BARRA: 'Barra'
  };
  return map[sector] || sector || 'Salón';
}

async function init(overrideToken) {
  const tableParams = getTableParams();
  const token = overrideToken || tableParams.token;
  const restaurantSlug = tableParams.restaurantSlug;
  const tableParam = tableParams.tableLabel;

  if (el.stateLoading) el.stateLoading.classList.remove('hidden');
  if (el.stateExpired) el.stateExpired.classList.add('hidden');

  try {
    let endpoint = null;
    if (restaurantSlug && tableParam && !overrideToken) {
      endpoint = `${API_BASE}/sessions/${encodeURIComponent(restaurantSlug)}/${encodeURIComponent(tableParam)}`;
    } else if (token) {
      endpoint = `${API_BASE}/sessions/${token}`;
    } else {
      if (el.stateLoading) el.stateLoading.classList.add('hidden');
      showExpiredState('Código QR no especificado. Por favor escaneá el QR físico canónico de tu mesa (/r/:slug/mesa/:label).');
      return;
    }

    const res = await fetchWithRetry(endpoint);
    const data = await res.json();

    if (!res.ok) {
      if (data.isClosed || data.isExpired) {
        showExpiredState(data.error);
        return;
      }
      showExpiredState(data.error || 'Mesa o restaurante no encontrados.');
      return;
    }

    // Handle Inactive Table State (valid: false, isActive: false)
    if (!data.valid) {
      if (el.stateLoading) el.stateLoading.classList.add('hidden');
      if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
      if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
      stopPolling();

      // Render table & restaurant header info and dynamic public menu
      if (data.restaurant) {
        if (el.restaurantName) el.restaurantName.textContent = data.restaurant.name;
        if (data.restaurant.pdfMenuUrl) {
          const safePdfUrl = sanitizeUrl(data.restaurant.pdfMenuUrl);
          if (safePdfUrl) {
            if (el.menuImage) el.menuImage.src = safePdfUrl;
            if (el.heroCoverImage) el.heroCoverImage.src = safePdfUrl;
          }
        }
        loadDynamicMenu(data.restaurant.slug || 'trattoria-del-puerto');
        loadRestaurantModuleConfig(data.restaurant.slug || 'trattoria-del-puerto');
      }
      if (data.table) {
        if (el.tableBadge) el.tableBadge.textContent = data.table.label;
        if (el.sectorBadge) el.sectorBadge.textContent = formatSector(data.table.sector);
      }

      if (data.isClosed || data.isExpired) {
        showExpiredState(data.error || 'La sesión de mesa ha finalizado.');
      } else {
        showInactiveState(data.message || 'Mesa sin sesión activa. Podés explorar la carta; el personal habilitará la atención al tomar asiento.');
      }
      return;
    }

    currentSession = data;
    currentToken = data.token;
    if (data.token) {
      sessionStorage.setItem('mesaya_token', data.token);
    }

    // Render header & details
    if (el.restaurantName) el.restaurantName.textContent = data.restaurant.name;
    if (el.tableBadge) el.tableBadge.textContent = data.table.label;
    if (el.sectorBadge) el.sectorBadge.textContent = formatSector(data.table.sector);

    if (data.restaurant.pdfMenuUrl) {
      const safePdfUrl = sanitizeUrl(data.restaurant.pdfMenuUrl);
      if (safePdfUrl) {
        if (el.menuImage) el.menuImage.src = safePdfUrl;
        if (el.heroCoverImage) el.heroCoverImage.src = safePdfUrl;
      }
    }

    if (data.restaurant && data.restaurant.slug) {
      loadDynamicMenu(data.restaurant.slug);
      loadRestaurantModuleConfig(data.restaurant.slug);
    } else {
      loadDynamicMenu('trattoria-del-puerto');
      loadRestaurantModuleConfig('trattoria-del-puerto');
    }

    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    if (el.stateExpired) el.stateExpired.classList.add('hidden');
    if (el.actionsContainer) el.actionsContainer.classList.remove('hidden');

    if (data.activeCall) {
      activeCall = data.activeCall;
      renderActiveCall(data.activeCall);
    } else {
      activeCall = null;
      if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
    }

    // Start background sync
    startPolling();

    // Load active order for cart
    loadActiveOrder();
  } catch (err) {
    console.warn('Falla al conectar sesión:', err);
    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    showExpiredState('No se pudo establecer conexión con la mesa. Por favor reintenta o escanea el QR nuevamente.');
  }
}

function showInactiveState(message) {
  if (el.stateLoading) el.stateLoading.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
  if (el.stateExpired) {
    el.stateExpired.classList.remove('hidden');
    const titleEl = el.stateExpired.querySelector('h3');
    if (titleEl) titleEl.textContent = 'Mesa Sin Sesión Activa';
    if (el.expiredMessageText && message) {
      el.expiredMessageText.textContent = message;
    }
    if (el.btnReactivateSession) {
      el.btnReactivateSession.textContent = 'Reintentar conexión';
    }
  }
}

function showExpiredState(message) {
  if (el.stateLoading) el.stateLoading.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
  if (el.stateExpired) {
    el.stateExpired.classList.remove('hidden');
    const titleEl = el.stateExpired.querySelector('h3');
    if (titleEl) titleEl.textContent = 'Sesión de Mesa Finalizada';
    if (el.expiredMessageText && message) {
      el.expiredMessageText.textContent = message;
    }
    if (el.btnReactivateSession) {
      el.btnReactivateSession.textContent = 'Reintentar conexión';
    }
  }
}

let selectedDishForOrder = null;

const MENU_TAG_MAP = {
  GLUTEN_FREE: { label: 'Sin TACC', emoji: '🌾', class: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  VEGAN: { label: 'Vegano', emoji: '🌱', class: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  VEGETARIAN: { label: 'Vegetariano', emoji: '🧀', class: 'text-lime-400 bg-lime-400/10 border-lime-400/30' },
  CHEF_PICK: { label: 'Sugerencia', emoji: '⭐', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  SPICY: { label: 'Picante', emoji: '🌶️', class: 'text-rose-400 bg-rose-400/10 border-rose-400/30' },
  POPULAR: { label: 'Más Pedido', emoji: '🔥', class: 'text-orange-400 bg-orange-400/10 border-orange-400/30' }
};

function openDishDetailSheet(item) {
  selectedDishForOrder = item;
  cartDishQty = 1;
  cartDishNotes = '';
  triggerHaptic();

  const sheet = document.getElementById('dishDetailSheetBackdrop');
  if (!sheet) return;

  const imgEl = document.getElementById('dishSheetImage');
  const titleEl = document.getElementById('dishSheetTitle');
  const descEl = document.getElementById('dishSheetDescription');
  const priceEl = document.getElementById('dishSheetPrice');
  const tagsEl = document.getElementById('dishSheetTagsContainer');
  const pairingBox = document.getElementById('dishSheetPairingBox');
  const pairingText = document.getElementById('dishSheetPairingText');
  const qtyDisplay = document.getElementById('dishSheetQtyDisplay');
  const notesInput = document.getElementById('dishSheetNotesInput');
  const actionBtn = document.getElementById('btnOrderSpecificDish');

  if (imgEl) {
    const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
    imgEl.src = sanitizeUrl(item.imageUrl, defaultImg);
  }
  if (titleEl) titleEl.textContent = item.name;
  if (descEl) descEl.textContent = item.description || 'Elaborado artesanalmente en el momento con ingredientes frescos de primera calidad.';
  if (priceEl) priceEl.textContent = `$${Number(item.price).toLocaleString('es-AR')}`;

  // Reset quantity and notes
  if (qtyDisplay) qtyDisplay.textContent = '1';
  if (notesInput) notesInput.value = '';

  // Configure action button based on ordering capability
  if (actionBtn) {
    if (canOrderDirectly()) {
      actionBtn.innerHTML = '<span>🛒 Agregar al carrito</span>';
      actionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 font-extrabold text-xs text-slate-950 flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-98 transition-all';
    } else {
      actionBtn.innerHTML = '<span>🛎️ Pedir este plato al Mozo</span>';
      actionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 font-extrabold text-xs text-white flex items-center justify-center gap-2 shadow-xl shadow-indigo-500/25 active:scale-98 transition-all';
    }
  }

  if (tagsEl) {
    tagsEl.innerHTML = '';
    (item.tags || []).forEach(t => {
      const tagObj = MENU_TAG_MAP[t];
      if (!tagObj) return;
      const tagSpan = document.createElement('span');
      tagSpan.className = `text-[11px] px-2 py-0.5 rounded-lg font-bold border ${tagObj.class}`;
      tagSpan.textContent = `${tagObj.emoji} ${tagObj.label}`;
      tagsEl.appendChild(tagSpan);
    });

    if (item.isFeatured) {
      const featSpan = document.createElement('span');
      featSpan.className = 'text-[11px] px-2 py-0.5 rounded-lg font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
      featSpan.textContent = '⭐ Especialidad de la Casa';
      tagsEl.appendChild(featSpan);
    }
  }

  // Suggest pairing depending on dish name / keywords
  if (pairingBox && pairingText) {
    const lowerName = item.name.toLowerCase();
    if (lowerName.includes('pasta') || lowerName.includes('carne') || lowerName.includes('bife')) {
      pairingBox.classList.remove('hidden');
      pairingText.textContent = 'Maridaje sugerido: Copa de Malbec Reserva o Agua con Gas';
    } else if (lowerName.includes('burger') || lowerName.includes('smash') || lowerName.includes('papas')) {
      pairingBox.classList.remove('hidden');
      pairingText.textContent = 'Maridaje sugerido: Pinta IPA Artesanal bien helada';
    } else if (lowerName.includes('pesca') || lowerName.includes('marisco') || lowerName.includes('raba')) {
      pairingBox.classList.remove('hidden');
      pairingText.textContent = 'Maridaje sugerido: Aperol Spritz o Sauvignon Blanc Marítimo';
    } else if (lowerName.includes('postre') || lowerName.includes('tiramis') || lowerName.includes('volcan')) {
      pairingBox.classList.remove('hidden');
      pairingText.textContent = 'Maridaje sugerido: Café Espresso o Copa de Espumante';
    } else {
      pairingBox.classList.add('hidden');
    }
  }

  sheet.classList.add('active');
  document.body.classList.add('modal-open');
}

function closeDishDetailSheet() {
  const sheet = document.getElementById('dishDetailSheetBackdrop');
  if (sheet) sheet.classList.remove('active');
  selectedDishForOrder = null;
  
  // Only remove modal-open if no other drawer or modal is active
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden)');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

let lastMenuResponse = null;

async function loadDynamicMenu(slug) {
  try {
    const res = await fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(slug)}/menu`);
    if (!res.ok) return;
    const data = await res.json();
    lastMenuResponse = data;
    renderDynamicMenu(data);
  } catch (err) {
    console.warn('Usando carta local estática como respaldo:', err);
  }
}

function applyTemplateTheme(templateId, manual = true) {
  const appBody = document.getElementById('appBody');
  const appHtml = document.documentElement;
  const themeClasses = ['theme-gourmet', 'theme-neon', 'theme-coastal', 'theme-minimal'];

  if (appBody) appBody.classList.remove(...themeClasses);
  if (appHtml) appHtml.classList.remove(...themeClasses);

  const themeClassMap = {
    GOURMET_OBSIDIAN: 'theme-gourmet',
    NEON_BURGER: 'theme-neon',
    COASTAL_BEACH: 'theme-coastal',
    MINIMAL_BISTRO: 'theme-minimal'
  };
  const targetClass = themeClassMap[templateId] || 'theme-gourmet';
  if (appBody) appBody.classList.add(targetClass);
  if (appHtml) appHtml.classList.add(targetClass);

  // Dedicated high-res culinary image per theme
  const themeImages = {
    GOURMET_OBSIDIAN: '/assets/images/restaurantes/pastas-artesanales-gourmet.jpg',
    NEON_BURGER: '/assets/images/rotiserias-fastfood/hamburguesa-smash-doble-cheddar.jpg',
    COASTAL_BEACH: '/assets/images/restaurantes/banquete-gastronomia-mediterranea.jpg',
    MINIMAL_BISTRO: '/assets/images/cafeterias-bakery/espresso-perfecto-granos-cafe.jpg'
  };

  if (el.heroCoverImage) {
    el.heroCoverImage.src = themeImages[templateId] || themeImages.GOURMET_OBSIDIAN;
  }

  if (manual && lastMenuResponse) {
    const updatedResponse = {
      ...lastMenuResponse,
      restaurant: {
        ...lastMenuResponse.restaurant,
        templateId
      }
    };
    renderDynamicMenu(updatedResponse);
  }
}

function renderDynamicMenu(menuResponse) {
  lastMenuResponse = menuResponse;
  const { restaurant, categories } = menuResponse;
  if (!categories || categories.length === 0) return;

  const templateId = restaurant.templateId || 'GOURMET_OBSIDIAN';
  const allItems = categories.flatMap(c => c.items);

  // 0. Apply Dynamic Theme Classes on Body
  applyTemplateTheme(templateId, false);

  const subtitleEl = document.getElementById('menuRestaurantSubtitle');
  if (subtitleEl && restaurant.name) {
    if (templateId === 'NEON_BURGER') {
      subtitleEl.textContent = `${restaurant.name} // STREET FOOD & CRAFT BEER`;
    } else if (templateId === 'COASTAL_BEACH') {
      subtitleEl.textContent = `${restaurant.name} • Puerto de Mar del Plata 2026`;
    } else if (templateId === 'MINIMAL_BISTRO') {
      subtitleEl.textContent = `${restaurant.name} • Specialty Roasters & Bakery`;
    } else {
      subtitleEl.textContent = `${restaurant.name} • Carta Tradicional de Autor`;
    }
  }

  // 1. Render Category Quick Pills
  const pillsContainer = el.heroCategoryPillsContainer || document.getElementById('heroCategoryPillsContainer');
  if (pillsContainer) {
    pillsContainer.innerHTML = categories.map((cat, idx) => `
      <button data-category="dynamic-cat-${idx}" class="btn-category-pill px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-amber-500/20 hover:text-amber-300 border border-slate-700/80 text-slate-200 font-semibold text-[11px] whitespace-nowrap active:scale-95 transition-all flex items-center gap-1">
        <span>${escapeHtml(cat.icon || '🍽️')}</span> ${escapeHtml(cat.name)}
      </button>
    `).join('');

    pillsContainer.querySelectorAll('.btn-category-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-category');
        closeAllModals();
        if (el.modalMenu) {
          el.modalMenu.classList.remove('hidden');
          setTimeout(() => {
            const target = document.getElementById(catId);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 50);
        }
      });
    });
  }

  // 1b. Render Category Switcher Pills inside the Modal
  const modalPillsContainer = document.getElementById('modalMenuCategoryPillsContainer');
  if (modalPillsContainer) {
    modalPillsContainer.innerHTML = categories.map((cat, idx) => `
      <button data-category="dynamic-cat-${idx}" class="btn-modal-cat-pill px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-amber-500/20 text-slate-300 font-bold text-[10px] whitespace-nowrap border border-slate-700/80 active:scale-95 transition-all flex items-center gap-1">
        <span>${escapeHtml(cat.icon || '🍽️')}</span> ${escapeHtml(cat.name)}
      </button>
    `).join('');

    modalPillsContainer.querySelectorAll('.btn-modal-cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-category');
        const target = document.getElementById(catId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // 2. Render Featured Dishes: Story Cards (Appetite Appeal)
  const storyContainer = document.getElementById('featuredStoryCardsContainer');
  const featuredItems = allItems.filter(i => i.isFeatured || (i.tags && i.tags.includes('CHEF_PICK')));
  const itemsToShowInStory = (featuredItems.length > 0 ? featuredItems : allItems).slice(0, 6);

  if (storyContainer && itemsToShowInStory.length > 0) {
    storyContainer.innerHTML = itemsToShowInStory.map(item => {
      const formattedPrice = `$${Number(item.price).toLocaleString('es-AR')}`;
      const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
      const imgUrl = sanitizeUrl(item.imageUrl, defaultImg);
      const safeDishId = escapeHtmlAttr(item.id);
      const safeName = escapeHtml(item.name);
      const safeAlt = escapeHtmlAttr(item.name);
      const safeDesc = escapeHtml(item.description || '');

      if (templateId === 'NEON_BURGER') {
        return `
          <div data-dish-id="${safeDishId}" class="card-dish-story snap-center shrink-0 w-64 sm:w-72 rounded-3xl overflow-hidden neon-card-street cursor-pointer active:scale-95 transition-all group shadow-2xl">
            <div class="relative h-40 sm:h-44 w-full overflow-hidden bg-zinc-950">
              <img src="${imgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
              <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent"></div>
              <span class="absolute top-3 left-3 px-2.5 py-1 rounded-lg neon-sticker-badge text-[10px] font-black shadow-lg">
                🔥 SMASH BURGER
              </span>
              <span class="absolute bottom-3 right-3 px-3 py-1 rounded-xl neon-price-tag text-xs font-mono font-black shadow-lg">
                ${formattedPrice}
              </span>
            </div>
            <div class="p-3.5 bg-zinc-950 flex items-center justify-between gap-2">
              <div class="min-w-0 pr-1">
                <h4 class="font-heading font-black text-sm text-white uppercase truncate group-hover:text-lime-400 transition-colors">${safeName}</h4>
                <p class="text-xs text-zinc-400 truncate mt-0.5">${safeDesc || 'Doble smash artesanal con queso cheddar fundido.'}</p>
              </div>
              <span class="text-xs font-black text-lime-400 shrink-0">VER →</span>
            </div>
          </div>
        `;
      } else if (templateId === 'COASTAL_BEACH') {
        return `
          <div data-dish-id="${safeDishId}" class="card-dish-story snap-center shrink-0 w-64 sm:w-72 rounded-3xl overflow-hidden coastal-card-marine cursor-pointer active:scale-95 transition-all group shadow-2xl">
            <div class="relative h-40 sm:h-44 w-full overflow-hidden bg-slate-950">
              <img src="${imgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
              <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
              <span class="absolute top-3 left-3 px-2.5 py-1 rounded-full coastal-seal-badge text-[10px] font-bold shadow-lg">
                ⚓ Pesca MDP
              </span>
              <span class="absolute bottom-3 right-3 px-3 py-1 rounded-xl bg-slate-950/95 font-mono font-black text-xs text-cyan-300 border border-cyan-500/40 shadow-lg">
                ${formattedPrice}
              </span>
            </div>
            <div class="p-3.5 bg-slate-950 flex items-center justify-between gap-2">
              <div class="min-w-0 pr-1">
                <h4 class="font-heading font-black text-sm text-white truncate group-hover:text-cyan-300 transition-colors">${safeName}</h4>
                <p class="text-xs text-cyan-200/80 truncate mt-0.5">${safeDesc || 'Especialidad del Puerto de Mar del Plata'}</p>
              </div>
              <span class="text-xs font-black text-cyan-400 shrink-0">Ver →</span>
            </div>
          </div>
        `;
      } else if (templateId === 'MINIMAL_BISTRO') {
        return `
          <div data-dish-id="${safeDishId}" class="card-dish-story snap-center shrink-0 w-64 sm:w-72 rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-800 cursor-pointer active:scale-95 transition-all group shadow-2xl">
            <div class="relative h-40 sm:h-44 w-full overflow-hidden bg-neutral-950">
              <img src="${imgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
              <div class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/30 to-transparent"></div>
              <span class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-neutral-950/90 text-[10px] font-bold text-neutral-300 border border-neutral-700">
                ⭐ Selección
              </span>
              <span class="absolute bottom-3 right-3 px-3 py-1 rounded-xl bg-neutral-950/95 font-mono font-bold text-xs text-neutral-200 border border-neutral-800">
                ${formattedPrice}
              </span>
            </div>
            <div class="p-3.5 bg-neutral-950 flex items-center justify-between gap-2">
              <div class="min-w-0 pr-1">
                <h4 class="font-heading font-bold text-sm text-neutral-100 truncate">${safeName}</h4>
                <p class="text-xs text-neutral-400 truncate mt-0.5">${safeDesc || 'Elaboración artesanal diaria'}</p>
              </div>
              <span class="text-xs font-bold text-neutral-400 shrink-0">Ver →</span>
            </div>
          </div>
        `;
      } else {
        // GOURMET_OBSIDIAN (Default)
        return `
          <div data-dish-id="${safeDishId}" class="card-dish-story snap-center shrink-0 w-64 sm:w-72 rounded-3xl overflow-hidden bg-slate-900 border border-amber-500/40 gourmet-frame-gold cursor-pointer active:scale-95 transition-all group shadow-2xl">
            <div class="relative h-40 sm:h-44 w-full overflow-hidden bg-slate-950">
              <img src="${imgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 brightness-[0.92]" loading="lazy" />
              <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-transparent"></div>
              <span class="absolute top-3 left-3 px-3 py-1 rounded-full gourmet-seal-badge text-[10px] font-black flex items-center gap-1 shadow-lg">
                ★ Plato Estrella
              </span>
              <span class="absolute bottom-3 right-3 px-3 py-1 rounded-xl bg-slate-950/95 font-mono font-black text-xs text-amber-300 border border-amber-500/40 shadow-lg">
                ${formattedPrice}
              </span>
            </div>
            <div class="p-3.5 bg-slate-950 flex items-center justify-between gap-2">
              <div class="min-w-0 pr-1">
                <h4 class="font-heading font-black text-sm text-white truncate group-hover:text-amber-300 transition-colors">${safeName}</h4>
                <p class="text-xs text-slate-300 line-clamp-1 mt-0.5 font-normal">${safeDesc || 'Elaboración de autor con ingredientes seleccionados.'}</p>
              </div>
              <span class="text-xs font-black text-amber-400 shrink-0 flex items-center gap-1 group-hover:translate-x-1 transition-transform">Ver ➔</span>
            </div>
          </div>
        `;
      }
    }).join('');

    // Attach click listeners to story cards
    storyContainer.querySelectorAll('.card-dish-story').forEach(card => {
      card.addEventListener('click', () => {
        const dishId = card.getAttribute('data-dish-id');
        const dish = allItems.find(i => i.id === dishId);
        if (dish) openDishDetailSheet(dish);
      });
    });
  }

  // 3. Render Modal Menu Categories & Food Items by Template
  const menuContainer = el.dynamicMenuCategoriesContainer || document.getElementById('dynamicMenuCategoriesContainer');
  if (menuContainer) {
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

    menuContainer.innerHTML = categories.map((cat, idx) => {
      const itemsHtml = cat.items.map(item => {
        const formattedPrice = `$${Number(item.price).toLocaleString('es-AR')}`;
        const tagsHtml = (item.tags || []).map(t => {
          const tagObj = MENU_TAG_MAP[t];
          if (!tagObj) return '';
          return `<span class="text-[11px] px-2 py-0.5 rounded-lg font-bold border ${tagObj.class}">${tagObj.emoji} ${tagObj.label}</span>`;
        }).join('');

        const safeDishId = escapeHtmlAttr(item.id);
        const safeName = escapeHtml(item.name);
        const safeAlt = escapeHtmlAttr(item.name);
        const safeDesc = escapeHtml(item.description || '');

        const safeImgUrl = item.imageUrl ? sanitizeUrl(item.imageUrl) : '';
        const imageHtml = safeImgUrl ? `
          <div class="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-950 shrink-0 border border-slate-800 shadow-md">
            <img src="${safeImgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
        ` : '';

        if (templateId === 'NEON_BURGER') {
          return `
            <div data-dish-id="${safeDishId}" class="card-dish-row neon-card-street p-4 rounded-3xl cursor-pointer active:scale-[0.98] transition-all group relative overflow-hidden shadow-xl ${item.isAvailable ? '' : 'opacity-50'}">
              <div class="flex items-start gap-3.5">
                ${imageHtml}
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                  <div>
                    <h5 class="font-heading font-black text-sm sm:text-base text-white tracking-tight group-hover:text-lime-300 transition-colors uppercase leading-snug">${safeName}</h5>
                    <p class="text-xs text-zinc-300 font-normal leading-relaxed mt-1 line-clamp-2">${safeDesc || 'Doble smash artesanal con queso cheddar fundido.'}</p>
                  </div>
                  <div class="flex items-center justify-between gap-2 pt-2.5 mt-auto">
                    <span class="neon-price-tag text-xs px-2.5 py-1 rounded-xl font-mono shadow-md">${formattedPrice}</span>
                    <div class="flex items-center gap-1.5 flex-wrap justify-end">
                      ${item.isFeatured ? '<span class="neon-sticker-badge text-[9px] px-1.5 py-0.5 rounded shadow-sm">🔥 SMASH</span>' : ''}
                      ${tagsHtml}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else if (templateId === 'COASTAL_BEACH') {
          return `
            <div data-dish-id="${safeDishId}" class="card-dish-row coastal-card-marine p-4 rounded-3xl cursor-pointer active:scale-[0.98] transition-all group shadow-xl ${item.isAvailable ? '' : 'opacity-50'}">
              <div class="flex items-start gap-3.5">
                ${imageHtml}
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                  <div>
                    <h5 class="font-heading font-black text-sm sm:text-base text-cyan-100 group-hover:text-cyan-300 transition-colors leading-snug">${safeName}</h5>
                    <p class="text-xs text-slate-300 font-normal leading-relaxed mt-1 line-clamp-2">${safeDesc || 'Especialidad fresca del Puerto de Mar del Plata.'}</p>
                  </div>
                  <div class="flex items-center justify-between gap-2 pt-2.5 mt-auto">
                    <span class="font-mono font-black text-xs text-cyan-300 bg-slate-950/90 px-2.5 py-1 rounded-xl border border-cyan-500/40 shadow-md">${formattedPrice}</span>
                    <div class="flex items-center gap-1.5 flex-wrap justify-end">
                      ${item.isFeatured ? '<span class="coastal-seal-badge text-[9px] px-2 py-0.5 rounded-full font-bold">⚓ Fresco</span>' : ''}
                      ${tagsHtml}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else if (templateId === 'MINIMAL_BISTRO') {
          return `
            <div data-dish-id="${safeDishId}" class="card-dish-row p-4 rounded-3xl bg-neutral-900/90 hover:bg-neutral-850 border border-neutral-800 cursor-pointer active:scale-[0.98] transition-all group shadow-xl ${item.isAvailable ? '' : 'opacity-50'}">
              <div class="flex items-start gap-3.5">
                ${imageHtml}
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                  <div>
                    <h5 class="font-heading font-bold text-sm sm:text-base text-neutral-100 tracking-tight group-hover:text-amber-200 transition-colors leading-snug">${safeName}</h5>
                    <p class="text-xs text-neutral-300 font-light leading-relaxed mt-1 line-clamp-2">${safeDesc || 'Elaboración artesanal diaria con materias primas de origen orgánico.'}</p>
                  </div>
                  <div class="flex items-center justify-between gap-2 pt-2.5 mt-auto">
                    <span class="font-mono font-bold text-xs text-neutral-200 bg-neutral-950 px-2.5 py-1 rounded-xl border border-neutral-700">${formattedPrice}</span>
                    <div class="flex items-center gap-1.5 flex-wrap justify-end">
                      ${item.isFeatured ? '<span class="text-[9px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 font-medium">Recomendado</span>' : ''}
                      ${tagsHtml}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else {
          // GOURMET_OBSIDIAN (Default)
          return `
            <div data-dish-id="${safeDishId}" class="card-dish-row p-4 rounded-3xl bg-slate-900/95 hover:bg-slate-850 border border-amber-500/30 cursor-pointer active:scale-[0.98] transition-all group shadow-xl shadow-amber-950/20 ${item.isAvailable ? '' : 'opacity-50'}">
              <div class="flex items-start gap-3.5">
                ${imageHtml}
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                  <div>
                    <h5 class="font-heading font-black text-sm sm:text-base text-white group-hover:text-amber-300 transition-colors leading-snug">${safeName}</h5>
                    <p class="text-xs text-slate-300 leading-relaxed font-normal mt-1 line-clamp-2">${safeDesc || 'Elaborado artesanalmente en el momento con ingredientes frescos de primera calidad.'}</p>
                  </div>
                  <div class="flex items-center justify-between gap-2 pt-2.5 mt-auto">
                    <span class="font-mono font-black text-sm text-amber-400 bg-amber-500/15 px-2.5 py-1 rounded-xl border border-amber-500/30 shadow-md">${formattedPrice}</span>
                    <div class="flex items-center gap-1.5 flex-wrap justify-end">
                      ${item.isFeatured ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold gourmet-seal-badge shadow-sm">★ Chef</span>' : ''}
                      ${tagsHtml}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      }).join('');

      const safeCatName = escapeHtml(cat.name);
      let categoryHeader = `
        <h4 class="font-heading text-sm font-extrabold text-amber-300 flex items-center gap-2 border-b border-amber-500/20 pb-2">
          <span>❖ ${romanNumerals[idx] || (idx + 1)}.</span>
          <span>${safeCatName.toUpperCase()}</span>
          <span>❖</span>
        </h4>
      `;

      if (templateId === 'NEON_BURGER') {
        categoryHeader = `
          <h4 class="font-heading text-xs font-black uppercase tracking-wider text-lime-400 flex items-center gap-1.5 border-b border-lime-500/25 pb-1.5">
            <span>// 0${idx + 1}.</span>
            <span>${safeCatName}</span>
            <span>//</span>
          </h4>
        `;
      } else if (templateId === 'COASTAL_BEACH') {
        categoryHeader = `
          <h4 class="font-heading text-xs font-extrabold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 border-b border-cyan-500/25 pb-1.5">
            <span>⚓ ${romanNumerals[idx] || (idx + 1)}.</span>
            <span>${safeCatName}</span>
            <span>• PUERTO MDP</span>
          </h4>
        `;
      } else if (templateId === 'MINIMAL_BISTRO') {
        categoryHeader = `
          <h4 class="font-heading text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2 border-b border-neutral-800 pb-1.5">
            <span>0${idx + 1} /</span>
            <span>${safeCatName}</span>
          </h4>
        `;
      }

      return `
        <section id="dynamic-cat-${idx}" class="space-y-3 pt-2">
          ${categoryHeader}
          <div class="grid grid-cols-1 gap-2.5">
            ${itemsHtml || '<p class="text-xs text-slate-500 italic">No hay platos disponibles en esta categoría.</p>'}
          </div>
        </section>
      `;
    }).join('');

    // Attach click listeners to row items
    menuContainer.querySelectorAll('.card-dish-row').forEach(row => {
      row.addEventListener('click', () => {
        const dishId = row.getAttribute('data-dish-id');
        const dish = allItems.find(i => i.id === dishId);
        if (dish) openDishDetailSheet(dish);
      });
    });
  }
}

function renderActiveCall(call) {
  if (!el.activeCallCard) return;
  el.activeCallCard.classList.remove('hidden');

  let typeLabel = 'Llamado a la mesa';
  if (call.type === 'BILL') {
    const payMap = {
      MERCADO_PAGO: 'Mercado Pago (QR)',
      CARD: 'Tarjeta Débito/Crédito',
      CASH: 'Efectivo'
    };
    typeLabel = `Cuenta • ${payMap[call.paymentMethod] || 'Pendiente'}`;
  } else if (call.type === 'WAITER') {
    typeLabel = call.note ? `Mozo • ${call.note}` : 'Mozo a la mesa';
  } else if (call.type === 'SUPPLIES') {
    typeLabel = `Insumos • ${call.note || 'Solicitados'}`;
  }

  if (el.activeCallDetailText) el.activeCallDetailText.textContent = typeLabel;

  if (call.status === 'IN_PROGRESS') {
    if (el.activeCallTitle) el.activeCallTitle.textContent = 'Mozo en camino 🚶‍♂️';
    if (el.activeCallSubtitle) el.activeCallSubtitle.textContent = 'Tu solicitud fue tomada por el personal';
    if (el.activeCallBadge) {
      el.activeCallBadge.textContent = 'En camino';
      el.activeCallBadge.className = 'text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    }
  } else {
    if (el.activeCallTitle) el.activeCallTitle.textContent = 'Mozo notificado 🔔';
    if (el.activeCallSubtitle) el.activeCallSubtitle.textContent = 'Aguardando que el staff tome el llamado';
    if (el.activeCallBadge) {
      el.activeCallBadge.textContent = 'Pendiente';
      el.activeCallBadge.className = 'text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30';
    }
  }

  updateCallTimer(call.createdAt);
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => updateCallTimer(call.createdAt), 1000);
}

function updateCallTimer(isoCreatedAt) {
  if (!el.activeCallTimer) return;
  const created = new Date(isoCreatedAt).getTime();
  const now = Date.now();
  const diffSecs = Math.max(0, Math.floor((now - created) / 1000));

  const mins = Math.floor(diffSecs / 60);
  const secs = diffSecs % 60;
  el.activeCallTimer.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

async function sendCall(type, paymentMethod = 'NOT_APPLICABLE', note = null) {
  triggerHaptic();
  lastCallType = type;

  // Get optional coordinates for anti-ghost call geofencing
  const coords = await getDeviceCoordinates();

  const payload = {
    sessionToken: currentToken,
    type,
    paymentMethod,
    note,
    origin: 'WEB_DIRECT',
    ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {})
  };

  try {
    const res = await fetchWithRetry(`${API_BASE}/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 410) {
        showExpiredState(data.error || 'La sesión de mesa ha finalizado.');
        return;
      }
      if (res.status === 503 || data.code === 'DIGITAL_PAYMENTS_UNAVAILABLE') {
        showToast(data.error || 'Pagos digitales no disponibles en el piloto. El cobro se realiza de forma presencial.', 'warning');
        return;
      }
      if (res.status === 403 || data.code === 'GEOFENCE_EXCEEDED') {
        showToast(data.error || 'No se puede solicitar atención fuera del salón.', 'error');
        return;
      }
      showToast(data.error || 'No se pudo enviar el llamado.', 'error');
      return;
    }

    activeCall = data;
    renderActiveCall(data);
    closeAllModals();
    showToast(type === 'BILL' ? '¡Pedido de cuenta enviado!' : '¡Llamado enviado al mozo!', 'success');
  } catch (err) {
    console.error('Error al enviar llamado:', err);
    showToast('No se pudo conectar con el servidor. Por favor verifica tu conexión.', 'error');
  }
}

async function cancelActiveCall() {
  if (!activeCall || !currentToken) return;
  triggerHaptic();

  try {
    const res = await fetchWithRetry(`${API_BASE}/calls/${activeCall.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: currentToken })
    });

    if (res.ok) {
      activeCall = null;
      if (callTimerInterval) clearInterval(callTimerInterval);
      if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
      showToast('Llamado cancelado exitosamente.', 'info');
    }
  } catch (err) {
    console.error('Error al cancelar llamado:', err);
    showToast('No se pudo cancelar el llamado.', 'error');
  }
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
  isPollingBusy = false;
  pollFailures = 0;
}

function scheduleNextPoll(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollTick, delayMs);
}

async function pollTick() {
  if (!currentToken || isPollingBusy) return;

  // En background / tab oculta, reducir consumo pero mantener vivo
  if (typeof document !== 'undefined' && document.hidden) {
    scheduleNextPoll(10000);
    return;
  }

  isPollingBusy = true;
  pollAbortController = new AbortController();

  try {
    const res = await fetch(`${API_BASE}/sessions/${currentToken}`, {
      signal: pollAbortController.signal
    });

    // Checklist 3: Expiración 401 o 410 detiene bucle y pide renovación
    if (res.status === 401 || res.status === 410) {
      const errData = await res.json().catch(() => ({}));
      showExpiredState(errData.error || 'Sesión de mesa expirada o finalizada. Por favor reingresá escaneando el QR.');
      stopPolling();
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    pollFailures = 0; // Reset backoff tras éxito

    if (data.valid) {
      if (data.activeCall) {
        activeCall = data.activeCall;
        renderActiveCall(data.activeCall);
      } else if (activeCall) {
        // Fue resuelto o cancelado
        activeCall = null;
        if (callTimerInterval) clearInterval(callTimerInterval);
        if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
      }
      // Objetivo de 3 segundos en foreground
      scheduleNextPoll(3000);
    } else if (data.isClosed || data.isExpired) {
      showExpiredState(data.error || 'La sesión de mesa ha finalizado.');
      stopPolling();
    } else {
      showInactiveState(data.message || 'Mesa sin sesión activa.');
      scheduleNextPoll(5000);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    pollFailures++;
    // Backoff exponencial con jitter: min(3s * 1.5^failures, 15s) + random(0..1000ms)
    const backoff = Math.min(3000 * Math.pow(1.5, pollFailures), 15000) + Math.random() * 1000;
    scheduleNextPoll(backoff);
  } finally {
    isPollingBusy = false;
    pollAbortController = null;
  }
}

function startPolling() {
  stopPolling();
  scheduleNextPoll(3000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (currentToken && !isPollingBusy) {
      pollFailures = 0;
      scheduleNextPoll(0);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentToken && !isPollingBusy) {
      scheduleNextPoll(0);
    }
  });
}

function closeAllModals() {
  if (el.modalBill) el.modalBill.classList.add('hidden');
  if (el.modalWaiter) el.modalWaiter.classList.add('hidden');
  if (el.modalSupplies) el.modalSupplies.classList.add('hidden');
  if (el.modalMenu) el.modalMenu.classList.add('hidden');
  closeDishDetailSheet();
  closeSommelierDrawer();
  closeCartDrawer();
  document.body.classList.remove('modal-open');
}

// Universal Swipe-Down / Drag-to-Dismiss gesture engine for Bottom Sheets
function enableSheetSwipeToDismiss(sheetBackdropId, onDismissCallback) {
  const backdrop = document.getElementById(sheetBackdropId);
  if (!backdrop) return;
  const content = backdrop.querySelector('.bottom-sheet-content');
  const handleContainer = backdrop.querySelector('.drag-handle-container') || backdrop.querySelector('.drag-handle-pill');
  if (!content) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;

  const startDrag = (clientY) => {
    startY = clientY;
    currentY = clientY;
    isDragging = true;
    startTime = Date.now();
    content.style.transition = 'none';
  };

  const moveDrag = (clientY) => {
    if (!isDragging) return;
    const deltaY = Math.max(0, clientY - startY);
    currentY = clientY;
    content.style.transform = `translateY(${deltaY}px)`;
  };

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    content.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
    const deltaY = currentY - startY;
    const elapsedTime = Date.now() - startTime;
    const velocity = deltaY / Math.max(1, elapsedTime);

    // Dismiss if dragged down > 100px OR flicked fast downwards (velocity > 0.5)
    if (deltaY > 100 || (deltaY > 40 && velocity > 0.5)) {
      content.style.transform = 'translateY(100%)';
      setTimeout(() => {
        onDismissCallback();
        content.style.transform = '';
      }, 220);
    } else {
      content.style.transform = 'translateY(0)';
    }
  };

  // Touch handlers (Mobile)
  const touchTarget = handleContainer || content;
  touchTarget.addEventListener('touchstart', (e) => {
    if (e.target !== handleContainer && content.scrollTop > 5) return;
    startDrag(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    moveDrag(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener('touchend', endDrag);
  window.addEventListener('touchcancel', endDrag);

  // Mouse drag handlers on handle for desktop/pointer testing
  if (handleContainer) {
    handleContainer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(e.clientY);
      const onMouseMove = (ev) => moveDrag(ev.clientY);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        endDrag();
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Backdrop click outside to dismiss
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      onDismissCallback();
    }
  });
}

// Bind UI event listeners
function bindEvents() {
  // Menu Modals
  const openMenuModal = () => {
    closeAllModals();
    if (el.modalMenu) {
      el.modalMenu.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  };

  if (el.btnOpenMenuHeader) el.btnOpenMenuHeader.addEventListener('click', openMenuModal);
  if (el.btnOpenMenuHero) el.btnOpenMenuHero.addEventListener('click', openMenuModal);
  if (el.heroMenuCard) el.heroMenuCard.addEventListener('click', (e) => {
    // Avoid double firing if button was clicked
    if (e.target.closest('#btnOpenMenuHero')) return;
    openMenuModal();
  });

  if (el.btnCloseModalMenu) el.btnCloseModalMenu.addEventListener('click', () => {
    if (el.modalMenu) el.modalMenu.classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  if (el.modalMenu) {
    el.modalMenu.addEventListener('click', (e) => {
      if (e.target === el.modalMenu) {
        el.modalMenu.classList.add('hidden');
        document.body.classList.remove('modal-open');
      }
    });
  }

  if (el.btnOrderFromMenu) el.btnOrderFromMenu.addEventListener('click', () => {
    if (canOrderDirectly()) {
      closeAllModals();
      openCartDrawer();
      return;
    }

    closeAllModals();
    if (el.modalWaiter) {
      el.modalWaiter.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  }, 1, 10000);

async function loadBillDetails() {
  if (!currentToken) return;
  try {
    // Prefer freshly fetched data for bill modal accuracy
    const res = await fetchWithRetry(`${API_BASE}/orders/session/${currentToken}`);
    let order = null;
    let items = [];
    let total = 0;

    if (res && res.ok) {
      const data = await res.json();
      order = data.order;
      items = order && order.items ? order.items : [];
      total = order ? (order.totalAmount || 0) : 0;
    } else if (cartOrder) {
      items = cartOrder.items || [];
      total = cartOrder.totalAmount || 0;
    }

    if (el.modalBillTotal) {
      el.modalBillTotal.textContent = `$${Number(total).toLocaleString('es-AR')}`;
    }
    if (el.modalBillStatusText) {
      el.modalBillStatusText.textContent = items.length > 0
        ? `${items.length} producto${items.length > 1 ? 's' : ''} registrado${items.length > 1 ? 's' : ''}`
        : 'Consumo registrado en la mesa';
    }

    if (el.modalBillItemsList && el.modalBillNoItems) {
      if (items.length > 0) {
        el.modalBillItemsList.innerHTML = items.map(item => `
          <div class="flex justify-between items-center py-1.5 text-slate-300">
            <span class="truncate pr-2"><strong class="text-white">${item.quantity}x</strong> ${escapeHtml(item.name)}</span>
            <span class="font-semibold text-white shrink-0">$${Number(item.unitPrice * item.quantity).toLocaleString('es-AR')}</span>
          </div>
        `).join('');
        el.modalBillNoItems.classList.add('hidden');
        if (el.modalBillItemCount) {
          el.modalBillItemCount.textContent = `${items.length} ítem${items.length > 1 ? 's' : ''}`;
          el.modalBillItemCount.classList.remove('hidden');
        }
      } else {
        el.modalBillItemsList.innerHTML = '';
        el.modalBillNoItems.classList.remove('hidden');
        if (el.modalBillItemCount) el.modalBillItemCount.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('Error al cargar comanda de la sesión:', err);
  }
}

  // Action: Pedir Cuenta
  if (el.btnActionBill) el.btnActionBill.addEventListener('click', () => {
    closeAllModals();
    if (el.modalBill) {
      loadBillDetails();
      el.modalBill.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  });

  if (el.btnToggleBillDetails && el.modalBillItemsContainer) {
    el.btnToggleBillDetails.addEventListener('click', () => {
      const isHidden = el.modalBillItemsContainer.classList.contains('hidden');
      if (isHidden) {
        el.modalBillItemsContainer.classList.remove('hidden');
        if (el.accordionArrow) el.accordionArrow.style.transform = 'rotate(180deg)';
      } else {
        el.modalBillItemsContainer.classList.add('hidden');
        if (el.accordionArrow) el.accordionArrow.style.transform = 'rotate(0deg)';
      }
    });
  }

  if (el.btnCloseModalBill) el.btnCloseModalBill.addEventListener('click', () => {
    if (el.modalBill) el.modalBill.classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  if (el.modalBill) {
    el.modalBill.addEventListener('click', (e) => {
      if (e.target === el.modalBill) {
        el.modalBill.classList.add('hidden');
        document.body.classList.remove('modal-open');
      }
    });
  }

  document.querySelectorAll('.btn-pay-method').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.getAttribute('data-method');
      sendCall('BILL', method);
    });
  });

  // Action: Llamar Mozo
  if (el.btnActionWaiter) el.btnActionWaiter.addEventListener('click', () => {
    closeAllModals();
    if (el.modalWaiter) {
      el.modalWaiter.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  });

  if (el.btnCloseModalWaiter) el.btnCloseModalWaiter.addEventListener('click', () => {
    if (el.modalWaiter) el.modalWaiter.classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  if (el.modalWaiter) {
    el.modalWaiter.addEventListener('click', (e) => {
      if (e.target === el.modalWaiter) {
        el.modalWaiter.classList.add('hidden');
        document.body.classList.remove('modal-open');
      }
    });
  }

  document.querySelectorAll('.btn-waiter-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      const reason = btn.getAttribute('data-waiter-reason');
      sendCall('WAITER', 'NOT_APPLICABLE', reason);
    });
  });

  // Action: Insumos
  if (el.btnActionSupplies) el.btnActionSupplies.addEventListener('click', () => {
    closeAllModals();
    if (el.modalSupplies) {
      el.modalSupplies.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  });

  if (el.btnCloseModalSupplies) el.btnCloseModalSupplies.addEventListener('click', () => {
    if (el.modalSupplies) el.modalSupplies.classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  if (el.modalSupplies) {
    el.modalSupplies.addEventListener('click', (e) => {
      if (e.target === el.modalSupplies) {
        el.modalSupplies.classList.add('hidden');
        document.body.classList.remove('modal-open');
      }
    });
  }

  document.querySelectorAll('.btn-supply-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const supply = btn.getAttribute('data-supply');
      const extraNote = el.customSupplyNote?.value?.trim();
      const combinedNote = extraNote ? `${supply} (${extraNote})` : supply;
      sendCall('SUPPLIES', 'NOT_APPLICABLE', combinedNote);
    });
  });

  if (el.btnSubmitCustomSupply) el.btnSubmitCustomSupply.addEventListener('click', () => {
    const note = el.customSupplyNote?.value?.trim() || 'Insumos varios';
    sendCall('SUPPLIES', 'NOT_APPLICABLE', note);
  });

  if (el.customSupplyNote) {
    el.customSupplyNote.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const note = el.customSupplyNote?.value?.trim() || 'Insumos varios';
        sendCall('SUPPLIES', 'NOT_APPLICABLE', note);
      }
    });
  }

  // Cancel call
  if (el.btnCancelCall) el.btnCancelCall.addEventListener('click', cancelActiveCall);

  // Bottom Sheet (Dish Detail Drawer) Handlers
  const btnCloseDishSheet = document.getElementById('btnCloseDishSheet');
  if (btnCloseDishSheet) {
    btnCloseDishSheet.addEventListener('click', closeDishDetailSheet);
  }

  // Enable Swipe-Down / Drag-to-Dismiss on Bottom Sheets
  enableSheetSwipeToDismiss('dishDetailSheetBackdrop', closeDishDetailSheet);
  enableSheetSwipeToDismiss('sommelierSheetBackdrop', closeSommelierDrawer);

  const btnOrderSpecificDish = document.getElementById('btnOrderSpecificDish');
  if (btnOrderSpecificDish) {
    btnOrderSpecificDish.addEventListener('click', async () => {
      if (!selectedDishForOrder) return;

      if (canOrderDirectly()) {
        if (cartAdding) return;
        const dishId = selectedDishForOrder.id;
        const dishName = selectedDishForOrder.name;
        const qty = cartDishQty || 1;
        const notesEl = document.getElementById('dishSheetNotesInput');
        const notes = notesEl ? notesEl.value.trim() : '';
        cartAdding = true;
        btnOrderSpecificDish.disabled = true;
        btnOrderSpecificDish.innerHTML = '<span class="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block"></span> Agregando...';
        try {
          const result = await addCartItem(dishId, qty, notes || undefined);
          if (result) {
            closeDishDetailSheet();
            showToast(`${dishName} × ${qty} agregado al carrito.`, 'success');
          } else {
            btnOrderSpecificDish.innerHTML = '<span>🛒 Agregar al carrito</span>';
          }
        } catch (err) {
          console.warn('No se pudo agregar el plato al carrito:', err);
          btnOrderSpecificDish.innerHTML = '<span>🛒 Agregar al carrito</span>';
          showToast('No se pudo agregar el plato. Revisá la conexión e intentá nuevamente.', 'error');
        } finally {
          cartAdding = false;
          btnOrderSpecificDish.disabled = false;
        }
      } else {
        const dishName = selectedDishForOrder.name;
        closeDishDetailSheet();
        closeAllModals();
        if (activeRestaurantConfig && activeRestaurantConfig.allowOrdering === false) {
          showToast('Comandas digitales desactivadas (Modo Carta Informativa). Solicitud enviada al personal.', 'info');
        }
        sendCall('WAITER', 'NOT_APPLICABLE', `Pedido: ${dishName}`);
      }
    });
  }

  // Quantity controls in dish detail sheet
  const qtyMinusBtn = document.getElementById('dishSheetQtyMinus');
  const qtyPlusBtn = document.getElementById('dishSheetQtyPlus');
  const qtyDisplay = document.getElementById('dishSheetQtyDisplay');
  if (qtyMinusBtn && qtyPlusBtn && qtyDisplay) {
    qtyMinusBtn.addEventListener('click', () => {
      if (cartDishQty > 1) {
        cartDishQty--;
        qtyDisplay.textContent = String(cartDishQty);
      }
    });
    qtyPlusBtn.addEventListener('click', () => {
      if (cartDishQty < 50) {
        cartDishQty++;
        qtyDisplay.textContent = String(cartDishQty);
      }
    });
  }

  // Sommelier IA Drawer Handlers
  const btnOpenSommelierModal = document.getElementById('btnOpenSommelierModal');
  if (btnOpenSommelierModal) {
    btnOpenSommelierModal.addEventListener('click', openSommelierDrawer);
  }

  const btnCloseSommelierSheet = document.getElementById('btnCloseSommelierSheet');
  if (btnCloseSommelierSheet) {
    btnCloseSommelierSheet.addEventListener('click', closeSommelierDrawer);
  }

  // Quick Prompt Chips in Sommelier Drawer
  document.querySelectorAll('.btn-quick-prompt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt) handleSommelierQuery(prompt);
    });
  });

  // Chat Form Submission
  const formSommelierChat = document.getElementById('formSommelierChat');
  const inputSommelierQuery = document.getElementById('inputSommelierQuery');
  if (formSommelierChat && inputSommelierQuery) {
    formSommelierChat.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = inputSommelierQuery.value.trim();
      if (text) {
        inputSommelierQuery.value = '';
        handleSommelierQuery(text);
      }
    });
  }

  // Retry connection on inactive table or expired session
  if (el.btnReactivateSession) el.btnReactivateSession.addEventListener('click', () => {
    triggerHaptic();
    sessionStorage.removeItem('mesaya_token');
    init();
  });

  // Cart drawer handlers
  const btnCloseCart = document.getElementById('btnCloseCartDrawer');
  if (btnCloseCart) btnCloseCart.addEventListener('click', closeCartDrawer);

  const btnCartSubmit = document.getElementById('btnCartSubmit');
  if (btnCartSubmit) btnCartSubmit.addEventListener('click', submitCartOrder);

  const cartDrawer = document.getElementById('cartDrawerBackdrop');
  if (cartDrawer) {
    enableSheetSwipeToDismiss('cartDrawerBackdrop', closeCartDrawer);
  }

  // Cart entry point in menu modal footer
  const btnOpenCartFromMenu = document.getElementById('btnOpenCartFromMenu');
  if (btnOpenCartFromMenu) {
    btnOpenCartFromMenu.addEventListener('click', () => {
      if (el.modalMenu) el.modalMenu.classList.add('hidden');
      openCartDrawer();
    });
  }
}

function openSommelierDrawer() {
  triggerHaptic();
  const drawer = document.getElementById('sommelierSheetBackdrop');
  if (drawer) {
    drawer.classList.add('active');
    document.body.classList.add('modal-open');
  }
}

function closeSommelierDrawer() {
  const drawer = document.getElementById('sommelierSheetBackdrop');
  if (drawer) drawer.classList.remove('active');
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden)');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

// ==========================================
// CART DRAWER RENDERING & INTERACTION
// ==========================================
function renderCartBadge() {
  const btn = el.btnOpenMenuHeader;
  if (!btn) return;
  const count = cartItemCount();
  if (count > 0) {
    btn.innerHTML = `<span class="relative inline-flex">
      <span class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[9px] font-black flex items-center justify-center">${count}</span>
      🛒 Ver Carta
    </span>`;
  } else {
    btn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
    </svg> Ver Carta`;
  }
}

function renderCartDrawer() {
  const drawer = document.getElementById('cartDrawerBackdrop');
  if (!drawer) return;
  const itemsList = document.getElementById('cartItemsList');
  const emptyMsg = document.getElementById('cartEmptyMsg');
  const totalEl = document.getElementById('cartTotal');
  const countEl = document.getElementById('cartItemCount');
  if (!itemsList || !emptyMsg || !totalEl || !countEl) return;

  const items = cartOrder && cartOrder.items ? cartOrder.items : [];
  if (items.length === 0) {
    itemsList.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    totalEl.textContent = '$0';
    countEl.textContent = '0 ítems';
    return;
  }

  emptyMsg.classList.add('hidden');
  countEl.textContent = `${items.length} ítem${items.length > 1 ? 's' : ''}`;
  totalEl.textContent = `$${Number(cartOrder.totalAmount || 0).toLocaleString('es-AR')}`;

  itemsList.innerHTML = items.map(item => {
    const safeId = escapeHtmlAttr(item.id);
    const safeName = escapeHtml(item.name);
    const lineTotal = Number(item.unitPrice * item.quantity).toLocaleString('es-AR');
    return `<div class="flex items-center justify-between gap-2 py-2.5 border-b border-slate-800/40 last:border-0">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-bold text-white truncate">${safeName}</p>
        <p class="text-[11px] text-slate-400">${item.quantity}x $${Number(item.unitPrice).toLocaleString('es-AR')}${item.notes ? ' • ' + escapeHtml(item.notes) : ''}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-mono font-bold text-amber-400">$${lineTotal}</span>
        <button data-remove-id="${safeId}" class="cart-remove-btn w-7 h-7 rounded-lg bg-red-950/60 border border-red-500/30 text-red-400 flex items-center justify-center text-xs font-bold active:scale-90 transition-all" aria-label="Eliminar ${safeName}">
          ✕
        </button>
      </div>
    </div>`;
  }).join('');

  itemsList.querySelectorAll('.cart-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.getAttribute('data-remove-id');
      if (itemId) {
        await removeCartItem(itemId);
      }
    });
  });
}

function renderCartSubmitBtn() {
  const btn = document.getElementById('btnCartSubmit');
  if (!btn) return;
  if (cartSubmitting) {
    btn.disabled = true;
    btn.innerHTML = '<span class="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block"></span> Enviando...';
  } else {
    btn.disabled = false;
    const count = cartItemCount();
    btn.innerHTML = count > 0 ? `🛒 Enviar pedido (${count})` : '🛒 Enviar pedido';
  }
}

function openCartDrawer() {
  triggerHaptic();
  const drawer = document.getElementById('cartDrawerBackdrop');
  if (!drawer) return;
  renderCartDrawer();
  renderCartSubmitBtn();
  drawer.classList.add('active');
  document.body.classList.add('modal-open');
}

function closeCartDrawer() {
  const drawer = document.getElementById('cartDrawerBackdrop');
  if (drawer) drawer.classList.remove('active');
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden), #modalCart:not(.hidden)');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

async function handleSommelierQuery(queryText) {
  const q = queryText.trim();
  if (!q) return;

  const messagesContainer = document.getElementById('sommelierChatMessages');
  if (!messagesContainer) return;

  // Append user bubble de forma segura (DOM con textContent)
  const userBubble = document.createElement('div');
  userBubble.className = 'flex items-start justify-end gap-2';
  const userCard = document.createElement('div');
  userCard.className = 'p-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs leading-relaxed max-w-[85%] shadow-md';
  userCard.textContent = q;
  userBubble.appendChild(userCard);
  messagesContainer.appendChild(userBubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Append typing indicator
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'flex items-start gap-2.5';
  loadingBubble.id = 'sommelierTypingIndicator';
  loadingBubble.innerHTML = `
    <div class="w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs shrink-0">
      🍷
    </div>
    <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-amber-300/80 leading-relaxed shadow-md flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
      <span>Consultando la cocina...</span>
    </div>
  `;
  messagesContainer.appendChild(loadingBubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const slug = currentSession?.restaurant?.slug || 'trattoria-del-puerto';
    const res = await fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(slug)}/ai-sommelier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, sessionToken: currentToken })
    });

    const data = await res.json();
    loadingBubble.remove();

    if (!res.ok) {
      throw new Error(data.error || 'Error al consultar al sommelier');
    }

    const aiBubble = document.createElement('div');
    aiBubble.className = 'flex items-start gap-2.5';

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs shrink-0';
    avatarDiv.textContent = '🍷';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-200 leading-relaxed shadow-md max-w-[88%] space-y-1';

    // Texto de respuesta de IA seguro con textContent
    const answerP = document.createElement('p');
    answerP.textContent = data.answer || '';
    contentDiv.appendChild(answerP);

    // Maridaje sugerido seguro
    if (data.suggestedPairing) {
      const pairingDiv = document.createElement('div');
      pairingDiv.className = 'p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-1.5 mt-2';
      const wineIcon = document.createElement('span');
      wineIcon.textContent = '🍷';
      const pairingSpan = document.createElement('span');
      const boldLabel = document.createElement('strong');
      boldLabel.textContent = 'Maridaje: ';
      pairingSpan.appendChild(boldLabel);
      pairingSpan.appendChild(document.createTextNode(String(data.suggestedPairing)));
      pairingDiv.appendChild(wineIcon);
      pairingDiv.appendChild(pairingSpan);
      contentDiv.appendChild(pairingDiv);
    }

    // Platos recomendados seguros construidos con DOM y atributos sanitizados
    if (data.suggestedDishes && data.suggestedDishes.length > 0) {
      const dishesContainer = document.createElement('div');
      dishesContainer.className = 'space-y-2 pt-2.5 border-t border-slate-800/80 mt-2.5';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'text-[10px] font-black uppercase tracking-wider text-amber-400 block';
      titleSpan.textContent = '✨ Platos recomendados:';
      dishesContainer.appendChild(titleSpan);

      data.suggestedDishes.forEach((dish) => {
        const dishCard = document.createElement('div');
        dishCard.className = 'card-sommelier-dish p-2.5 rounded-2xl bg-slate-950/90 hover:bg-slate-900 border border-amber-500/35 flex items-center justify-between gap-3 cursor-pointer active:scale-95 transition-all shadow-md group';
        dishCard.setAttribute('data-dish-id', escapeHtmlAttr(dish.id));

        const leftDiv = document.createElement('div');
        leftDiv.className = 'flex items-center gap-2.5 min-w-0';

        const safeImgUrl = dish.imageUrl ? sanitizeUrl(dish.imageUrl) : '';
        if (safeImgUrl) {
          const img = document.createElement('img');
          img.src = safeImgUrl;
          img.alt = dish.name || '';
          img.className = 'w-12 h-12 rounded-xl object-cover border border-slate-700/80 shrink-0';
          leftDiv.appendChild(img);
        } else {
          const fallbackIcon = document.createElement('span');
          fallbackIcon.className = 'text-xl';
          fallbackIcon.textContent = '🍽️';
          leftDiv.appendChild(fallbackIcon);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'min-w-0';
        const nameH6 = document.createElement('h6');
        nameH6.className = 'text-xs font-extrabold text-white leading-tight group-hover:text-amber-300 transition-colors';
        nameH6.textContent = dish.name || '';
        const priceSpan = document.createElement('span');
        priceSpan.className = 'text-xs font-mono font-black text-amber-400 mt-0.5 block';
        priceSpan.textContent = `$${Number(dish.price).toLocaleString('es-AR')}`;
        infoDiv.appendChild(nameH6);
        infoDiv.appendChild(priceSpan);
        leftDiv.appendChild(infoDiv);

        const orderBadge = document.createElement('span');
        orderBadge.className = 'text-[10px] px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 font-black border border-amber-500/40 shrink-0 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors';
        orderBadge.textContent = 'Pedir ➔';

        dishCard.appendChild(leftDiv);
        dishCard.appendChild(orderBadge);

        dishCard.addEventListener('click', () => {
          openDishDetailSheet(dish);
        });

        dishesContainer.appendChild(dishCard);
      });

      contentDiv.appendChild(dishesContainer);
    }

    aiBubble.appendChild(avatarDiv);
    aiBubble.appendChild(contentDiv);
    messagesContainer.appendChild(aiBubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (err) {
    loadingBubble.remove();
    const errorBubble = document.createElement('div');
    errorBubble.className = 'flex items-start gap-2.5';
    errorBubble.innerHTML = `
      <div class="w-7 h-7 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-xs shrink-0 text-rose-300">
        ⚠️
      </div>
      <div class="p-3 rounded-2xl bg-slate-900 border border-rose-500/30 text-xs text-rose-300 leading-relaxed shadow-md">
        No se pudo conectar con el Sommelier en este momento. Por favor reintenta en unos instantes.
      </div>
    `;
    messagesContainer.appendChild(errorBubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

let activeRestaurantConfig = null;
let restaurantConfigLoaded = false;
let selectedTipPercentage = 10;

async function loadRestaurantModuleConfig(slug) {
  try {
    const res = await fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(slug)}/config`);
    if (!res.ok) {
      restaurantConfigLoaded = false;
      return;
    }
    const config = await res.json();
    activeRestaurantConfig = config;
    restaurantConfigLoaded = true;

    // Adaptar textos y acciones según allowOrdering (Comandas Digitales vs Modo Carta Informativa)
    if (config.allowOrdering === false) {
      if (el.btnOrderFromMenu) {
        el.btnOrderFromMenu.innerHTML = '<span>📖 Modo Carta • Llamar al Mozo</span>';
      }
      const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
      if (orderSpecificBtn) {
        orderSpecificBtn.innerHTML = '<span>🛎️ Solicitar plato al Mozo (Modo Carta)</span>';
      }
    } else {
      if (el.btnOrderFromMenu) {
        el.btnOrderFromMenu.innerHTML = '<span>🛒 Ver carrito y enviar</span>';
      }
      const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
      if (orderSpecificBtn) {
        orderSpecificBtn.innerHTML = '<span>🛎️ Pedir este plato al Mozo</span>';
      }
    }

    const cartSubmitHint = document.getElementById('cartSubmitHint');
    if (cartSubmitHint) {
      cartSubmitHint.textContent = config.requireWaiterValidation === false
        ? 'El precio final se calcula en el servidor. El pedido se enviará directo a cocina.'
        : 'El precio final se calcula en el servidor. El mozo validará el pedido antes del envío a cocina.';
    }

    // Apply Google Review Deep Link if available (validado contra caracteres maliciosos)
    const reviewBtn = document.getElementById('btnGoogleReviewDeepLink');
    if (reviewBtn) {
      const safePlaceId = sanitizeGooglePlaceId(config.googlePlaceId);
      if (safePlaceId) {
        reviewBtn.href = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(safePlaceId)}`;
      } else {
        reviewBtn.removeAttribute('href');
      }
    }

    // Hide / show tipping section depending on module flag
    const tipSection = document.getElementById('smartTipSection');
    if (tipSection) {
      if (config.enableSmartTips === false) {
        tipSection.classList.add('hidden');
      } else {
        tipSection.classList.remove('hidden');
      }
    }
  } catch (err) {
    restaurantConfigLoaded = false;
    console.warn('Error al cargar configuración modular:', err);
  }
}

function openReviewFairModal() {
  triggerHaptic();
  const modal = document.getElementById('modalReviewFair');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
}

function closeReviewFairModal() {
  const modal = document.getElementById('modalReviewFair');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

// Bind review & tipping listeners
function bindReviewFairEvents() {
  const btnCloseModalReview = document.getElementById('btnCloseModalReview');
  if (btnCloseModalReview) {
    btnCloseModalReview.addEventListener('click', closeReviewFairModal);
  }

  // Tip pills
  document.querySelectorAll('.btn-tip-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      const pct = Number(btn.getAttribute('data-tip')) || 10;
      selectedTipPercentage = pct;

      document.querySelectorAll('.btn-tip-pill').forEach((b) => {
        b.className = 'btn-tip-pill py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold text-xs active:scale-95 transition-all';
      });
      btn.className = 'btn-tip-pill py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs active:scale-95 transition-all';

      const tipText = document.getElementById('tipSelectedAmount');
      if (tipText) tipText.textContent = `${pct}%`;
    });
  });

  // Private feedback toggle
  const btnPrivateToggle = document.getElementById('btnPrivateFeedbackToggle');
  const formContainer = document.getElementById('privateFeedbackFormContainer');
  if (btnPrivateToggle && formContainer) {
    btnPrivateToggle.addEventListener('click', () => {
      formContainer.classList.toggle('hidden');
    });
  }

  // Private feedback submit
  const btnSubmitPrivate = document.getElementById('btnSubmitPrivateFeedback');
  const privateText = document.getElementById('privateFeedbackText');
  if (btnSubmitPrivate && privateText) {
    btnSubmitPrivate.addEventListener('click', async () => {
      const text = privateText.value.trim();
      if (!text) return;

      try {
        const res = await fetchWithRetry(`${API_BASE}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: currentToken,
            rating: 5,
            comment: text
          })
        });

        if (!res.ok) {
          throw new Error('Respuesta no válida del servidor');
        }

        showToast('¡Gracias! Tu mensaje fue enviado directamente al encargado del local.', 'success');
        privateText.value = '';
        closeReviewFairModal();
      } catch (err) {
        showToast('No se pudo enviar el comentario. Intenta nuevamente.', 'error');
      }
    });
  }
}

// Start
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  bindReviewFairEvents();
  init();
});

