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
let publicMenuOnly = false;
let staticMenuOnly = false;
const STATIC_CATALOG_BY_RESTAURANT = Object.freeze({
  // La sesión, llamados y estado siguen siendo los de MesaYA Piloto. Sólo la
  // carta visual se sustituye por el catálogo Fauno hasta importar sus ítems
  // con IDs propios en la base operativa del local.
  'mesaya-piloto': '/demo/fauno-olavarria/catalog.json'
});
let activeCall = null;
let activeCalls = [];
let pollTimer = null;
let pollAbortController = null;
let isPollingBusy = false;
let pollFailures = 0;
let callTimerInterval = null;
let lastCallType = 'WAITER';
let activeOrder = null;
let orderHistory = [];
// El camino normal va directo a cocina. Sólo una excepción persistida o el
// modo manual explícito del local debe poner una comanda delante del mozo.
let activeOrderPolicy = { allowOrdering: true, requireWaiterValidation: false };
let isCartSubmitting = false;
// E17: una sola mutación por intención de agregar. Mutex lógico inmediato:
// el segundo clic durante el envío se ignora; tras el éxito, una nueva unidad
// intencional vuelve a estar permitida (el mutex se libera en `finally`).
let dishAddInFlight = false;
const cartRemoveInFlight = new Set();
let cartSubmitIdempotencyKey = null;
// E17: contexto del borrador para invalidar el estado auxiliar cuando cambia
// la mesa/sesión. Nunca incluye tokens.
let lastCartContextKey = null;
let lastCartSubmitStorageKey = null;
let networkState = 'unknown';
let networkStatusTimer = null;
let modalFocusStack = [];
let suppressModalFocusRestore = false;

function sanitizeCartKeyPart(value, fallback, maxLength) {
  const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, maxLength);
  return clean || fallback;
}

function getCartContextParts() {
  const slug = (currentSession && currentSession.restaurant && currentSession.restaurant.slug)
    || getTableParams().restaurantSlug
    || 'noresto';
  const table = (currentSession && currentSession.table && currentSession.table.label)
    || getTableParams().tableLabel
    || 'notable';
  const sessionVersion = (currentSession && (
    currentSession.tableSessionId
    || currentSession.sessionId
    || currentSession.id
    || currentSession.expiresAt
  )) || 'nosession';
  const orderId = activeOrder && activeOrder.id ? String(activeOrder.id) : 'draft';
  return {
    slug: sanitizeCartKeyPart(slug, 'noresto', 64),
    table: sanitizeCartKeyPart(table, 'notable', 64),
    session: sanitizeCartKeyPart(sessionVersion, 'nosession', 64),
    order: sanitizeCartKeyPart(orderId, 'draft', 64)
  };
}

// E17: la clave auxiliar del borrador está ligada a restaurante/mesa/orden.
// No usa tokens crudos ni los guarda como identificador de almacenamiento:
// el servidor es la fuente de verdad y el borrador siempre se recarga desde
// la API (loadActiveOrder), sin sumar estado local y respuesta remota.
function getCartSubmitStorageKey() {
  const parts = getCartContextParts();
  return `mesaya_cart_submit_${parts.slug}_${parts.table}_${parts.session}_${parts.order}`.slice(0, 200);
}

function readPersistedCartSubmitKey(storageKey) {
  const key = storageKey || getCartSubmitStorageKey();
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && typeof existing === 'string' && existing.trim()) return existing.trim().slice(0, 200);
  } catch (_) {}
  return null;
}

function getOrCreateCartSubmitIdempotencyKey() {
  const storageKey = getCartSubmitStorageKey();
  if (lastCartSubmitStorageKey && lastCartSubmitStorageKey !== storageKey) {
    try { sessionStorage.removeItem(lastCartSubmitStorageKey); } catch (_) {}
  }
  lastCartSubmitStorageKey = storageKey;
  const existing = readPersistedCartSubmitKey(storageKey);
  if (existing) {
    cartSubmitIdempotencyKey = existing;
    return existing;
  }
  const parts = getCartContextParts();
  const orderIdPart = parts.order !== 'draft'
    ? parts.order
    : `draft-${parts.slug}-${parts.table}`.slice(0, 64);
  let newKey = null;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      newKey = `cart_${orderIdPart}_${crypto.randomUUID()}`;
    }
  } catch (_) { newKey = null; }
  if (!newKey) {
    const base = `${orderIdPart}:${parts.slug}:${parts.table}:${parts.session}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
    const hex = Math.abs(hash).toString(36);
    newKey = `cart_${orderIdPart}_${hex}_fallback`;
  }
  newKey = newKey.slice(0, 200);
  cartSubmitIdempotencyKey = newKey;
  try { sessionStorage.setItem(storageKey, newKey); } catch (_) {}
  return newKey;
}

function clearPersistedCartSubmitKey(storageKey) {
  const key = storageKey || getCartSubmitStorageKey();
  try { sessionStorage.removeItem(key); } catch (_) {}
  if (lastCartSubmitStorageKey === key) lastCartSubmitStorageKey = null;
  cartSubmitIdempotencyKey = null;
}

// E17: invalida el estado auxiliar del borrador ante sesión vencida, mesa
// distinta o borrador enviado. No restaura pedidos viejos: el borrador se
// recarga siempre desde el servidor.
function invalidateCartSubmitState() {
  if (lastCartSubmitStorageKey) {
    try { sessionStorage.removeItem(lastCartSubmitStorageKey); } catch (_) {}
    lastCartSubmitStorageKey = null;
  }
  try { sessionStorage.removeItem(getCartSubmitStorageKey()); } catch (_) {}
  cartSubmitIdempotencyKey = null;
}

// E17: si cambió el contexto restaurante/mesa, el estado auxiliar anterior
// queda inválido y se limpia sin restaurar nada local.
function trackCartSessionContext() {
  const parts = getCartContextParts();
  const contextKey = `${parts.slug}::${parts.table}::${parts.session}`;
  if (lastCartContextKey && lastCartContextKey !== contextKey) {
    invalidateCartSubmitState();
  }
  lastCartContextKey = contextKey;
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
  btnOpenCartHeader: document.getElementById('btnOpenCartHeader'),
  headerCartCount: document.getElementById('headerCartCount'),
  btnOpenMenuHero: document.getElementById('btnOpenMenuHero'),
  heroCoverImage: document.getElementById('heroCoverImage'),
  stateLoading: document.getElementById('stateLoading'),
  networkStatus: document.getElementById('networkStatus'),
  stateExpired: document.getElementById('stateExpired'),
  expiredMessageText: document.getElementById('expiredMessageText'),
  actionsContainer: document.getElementById('actionsContainer'),
  heroMenuCard: document.getElementById('heroMenuCard'),
  activeCallCard: document.getElementById('activeCallCard'),
  activeCallTitle: document.getElementById('activeCallTitle'),
  activeCallSubtitle: document.getElementById('activeCallSubtitle'),
  activeCallBadge: document.getElementById('activeCallBadge'),
  activeCallList: document.getElementById('activeCallList'),
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
  modalBillPaid: document.getElementById('modalBillPaid'),
  modalBillTip: document.getElementById('modalBillTip'),
  modalBillRequestedTip: document.getElementById('modalBillRequestedTip'),
  modalBillBalance: document.getElementById('modalBillBalance'),
  modalBillPayableTotal: document.getElementById('modalBillPayableTotal'),
  modalBillPending: document.getElementById('modalBillPending'),
  billTipSelection: document.getElementById('billTipSelection'),
  btnToggleBillDetails: document.getElementById('btnToggleBillDetails'),
  modalBillItemsContainer: document.getElementById('modalBillItemsContainer'),
  modalBillItemsList: document.getElementById('modalBillItemsList'),
  modalBillNoItems: document.getElementById('modalBillNoItems'),
  modalBillItemCount: document.getElementById('modalBillItemCount'),
  accordionArrow: document.getElementById('accordionArrow'),
  modalWaiter: document.getElementById('modalWaiter'),
  modalSupplies: document.getElementById('modalSupplies'),
  modalMenu: document.getElementById('modalMenu'),
  modalCart: document.getElementById('modalCart'),
  btnCloseModalCart: document.getElementById('btnCloseModalCart'),
  cartItemsList: document.getElementById('cartItemsList'),
  cartEmptyState: document.getElementById('cartEmptyState'),
  cartTotal: document.getElementById('cartTotal'),
  cartOrderStatus: document.getElementById('cartOrderStatus'),
  orderHistorySection: document.getElementById('orderHistorySection'),
  orderHistoryList: document.getElementById('orderHistoryList'),
  orderHistoryEmpty: document.getElementById('orderHistoryEmpty'),
  btnSubmitCart: document.getElementById('btnSubmitCart'),
  btnCartCallWaiter: document.getElementById('btnCartCallWaiter'),
  menuImage: document.getElementById('menuImage'),
  heroCategoryPillsContainer: document.getElementById('heroCategoryPillsContainer'),
  dynamicMenuCategoriesContainer: document.getElementById('dynamicMenuCategoriesContainer'),
  btnCloseModalBill: document.getElementById('btnCloseModalBill'),
  btnOpenReviewFromBill: document.getElementById('btnOpenReviewFromBill'),
  btnSubmitReview: document.getElementById('btnSubmitReview'),
  btnCloseModalWaiter: document.getElementById('btnCloseModalWaiter'),
  btnCloseModalSupplies: document.getElementById('btnCloseModalSupplies'),
  btnCloseModalMenu: document.getElementById('btnCloseModalMenu'),
  btnOrderFromMenu: document.getElementById('btnOrderFromMenu'),
  dishOrderQuantity: document.getElementById('dishOrderQuantity'),
  dishOrderQuantityDisplay: document.getElementById('dishOrderQuantityDisplay'),
  btnDishOrderQuantityMinus: document.getElementById('btnDishOrderQuantityMinus'),
  btnDishOrderQuantityPlus: document.getElementById('btnDishOrderQuantityPlus'),
  dishOrderNote: document.getElementById('dishOrderNote'),
  customSupplyNote: document.getElementById('customSupplyNote'),
  btnSubmitCustomSupply: document.getElementById('btnSubmitCustomSupply'),
  waitlistPublicRoot: document.getElementById('waitlistPublicRoot'),
  waitlistRestaurantName: document.getElementById('waitlistRestaurantName'),
  waitlistJoinView: document.getElementById('waitlistJoinView'),
  waitlistTicketView: document.getElementById('waitlistTicketView'),
  waitlistUnavailableView: document.getElementById('waitlistUnavailableView'),
  waitlistJoinForm: document.getElementById('waitlistJoinForm'),
  waitlistGuestName: document.getElementById('waitlistGuestName'),
  waitlistPartySize: document.getElementById('waitlistPartySize'),
  waitlistPhone: document.getElementById('waitlistPhone'),
  waitlistConsent: document.getElementById('waitlistConsent'),
  waitlistJoinButton: document.getElementById('waitlistJoinButton'),
  waitlistJoinError: document.getElementById('waitlistJoinError'),
  waitlistPreOrderSection: document.getElementById('waitlistPreOrderSection'),
  waitlistPreOrderList: document.getElementById('waitlistPreOrderList'),
  waitlistTicketGuest: document.getElementById('waitlistTicketGuest'),
  waitlistTicketPosition: document.getElementById('waitlistTicketPosition'),
  waitlistTicketWait: document.getElementById('waitlistTicketWait'),
  waitlistTicketStatus: document.getElementById('waitlistTicketStatus'),
  waitlistTicketMeta: document.getElementById('waitlistTicketMeta'),
  waitlistNewTicketButton: document.getElementById('waitlistNewTicketButton'),
  waitlistUnavailableText: document.getElementById('waitlistUnavailableText')
};

function bindImageResilience(image) {
  if (!image || image.dataset.resilienceBound === 'true') return;
  image.dataset.resilienceBound = 'true';
  image.addEventListener('error', () => {
    image.classList.add('hidden');
    image.setAttribute('aria-hidden', 'true');
  });
  image.addEventListener('load', () => {
    image.classList.remove('hidden');
    image.removeAttribute('aria-hidden');
  });
}

bindImageResilience(el.heroCoverImage);
bindImageResilience(document.getElementById('dishSheetImage'));

let publicWaitlistSlug = null;
let publicWaitlistTimer = null;
let publicWaitlistTicket = null;
let publicWaitlistPreOrderEnabled = false;
let publicWaitlistMenuItems = [];

// Unified Table Params Extraction (supports /r/:slug/mesa/:label, /mesa/:label, and query params)
function getTableParams() {
  const parsed = {
    token: null,
    restaurantSlug: null,
    tableLabel: null,
    queueSlug: null,
    menuSlug: null
  };
  if (typeof window === 'undefined') return parsed;

  const pathname = decodeURIComponent(window.location.pathname || '');
  const search = window.location.search || '';
  const params = new URLSearchParams(search);

  const queueMatch = pathname.match(/\/fila\/([^\/]+)/i);
  if (queueMatch) parsed.queueSlug = queueMatch[1];
  if (params.get('fila') || params.get('queue')) parsed.queueSlug = params.get('fila') || params.get('queue');

  const publicMenuMatch = pathname.match(/\/carta\/([^\/]+)/i);
  if (publicMenuMatch) parsed.menuSlug = publicMenuMatch[1];
  if (params.get('carta')) parsed.menuSlug = params.get('carta');

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
      markOnline();
      return res;
    } catch (err) {
      clearTimeout(id);
      if (i === retries - 1) {
        if (isLikelyNetworkError(err)) markOffline();
        throw err;
      }
    }
  }
}

function isLikelyNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'TypeError') return true;
  return /fetch|network|connection|timeout|failed/i.test(String(error.message || error));
}

// E17: mutaciones del carrito (agregar/quitar/enviar) en una sola tentativa
// con timeout razonable. Un reintento automático tras una respuesta tardía o
// una pérdida de red post-commit duplicaría la intención, porque
// /orders/items no tiene clave de idempotencia en el backend. Las consultas
// GET conservan fetchWithRetry; ante error de red se reconcilia con el
// servidor y se pide verificación antes de reintentar de forma consciente.
async function fetchMutationOnce(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    markOnline();
    return res;
  } catch (err) {
    clearTimeout(id);
    if (isLikelyNetworkError(err)) markOffline();
    throw err;
  }
}

function showNetworkStatus(online, message) {
  if (!el.networkStatus) return;
  if (networkStatusTimer) {
    clearTimeout(networkStatusTimer);
    networkStatusTimer = null;
  }
  el.networkStatus.textContent = message;
  el.networkStatus.className = online
    ? 'rounded-2xl border border-emerald-500/40 bg-emerald-950/70 px-4 py-3 text-xs font-bold leading-relaxed text-emerald-100 shadow-lg'
    : 'rounded-2xl border border-amber-500/40 bg-amber-950/70 px-4 py-3 text-xs font-bold leading-relaxed text-amber-100 shadow-lg';
  el.networkStatus.classList.remove('hidden');
  if (online) {
    networkStatusTimer = window.setTimeout(() => {
      el.networkStatus?.classList.add('hidden');
      networkStatusTimer = null;
    }, 4000);
  }
}

function markOffline() {
  networkState = 'offline';
  showNetworkStatus(false, 'Sin conexión. No se enviará nada hasta comprobarlo.');
}

function markOnline() {
  const wasOffline = networkState === 'offline';
  networkState = 'online';
  if (wasOffline) {
    showNetworkStatus(true, 'Conexión restablecida; comprobando la mesa…');
  } else if (el.networkStatus) {
    el.networkStatus.classList.add('hidden');
  }
}

const MANAGED_MODAL_IDS = [
  'dishDetailSheetBackdrop',
  'sommelierSheetBackdrop',
  'modalReviewFair',
  'modalCart',
  'modalBill',
  'modalWaiter',
  'modalSupplies',
  'modalMenu'
];

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

function isVisibleForFocus(node) {
  if (!node || typeof node.matches !== 'function') return false;
  if (node.closest('.hidden') || node.getAttribute('aria-hidden') === 'true') return false;
  try {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  } catch (_) {}
  return true;
}

function getTopManagedModal() {
  for (const id of MANAGED_MODAL_IDS) {
    const candidate = document.getElementById(id);
    if (!candidate) continue;
    const open = candidate.classList.contains('active')
      || (candidate.classList.contains('fixed') && !candidate.classList.contains('hidden'));
    if (open) return candidate;
  }
  return null;
}

function hasOpenManagedModal() {
  return Boolean(getTopManagedModal());
}

function rememberModalFocus(trigger = document.activeElement) {
  if (trigger && typeof trigger.focus === 'function' && trigger !== document.body) {
    modalFocusStack.push(trigger);
  }
}

function focusManagedModal(container) {
  if (!container) return;
  const focus = () => {
    if (!isVisibleForFocus(container)) return;
    const autofocus = container.querySelector('[autofocus]');
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisibleForFocus);
    const target = (autofocus && isVisibleForFocus(autofocus)) ? autofocus : (focusables[0] || container);
    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
  else window.setTimeout(focus, 0);
}

function restoreModalFocusIfNone() {
  if (suppressModalFocusRestore) return;
  while (modalFocusStack.length > 0) {
    const target = modalFocusStack.pop();
    if (target && isVisibleForFocus(target)) {
      target.focus({ preventScroll: true });
      return;
    }
  }
}

function closeBasicModal(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  if (!hasOpenManagedModal()) {
    document.body.classList.remove('modal-open');
  }
  restoreModalFocusIfNone();
}

function closeManagedModal(modal) {
  if (!modal) return;
  switch (modal.id) {
    case 'dishDetailSheetBackdrop':
      closeDishDetailSheet();
      break;
    case 'sommelierSheetBackdrop':
      closeSommelierDrawer();
      break;
    case 'modalReviewFair':
      closeReviewFairModal();
      break;
    case 'modalCart':
      closeCartModal();
      break;
    case 'modalMenu':
      closeBasicModal(modal);
      restoreMenuContext();
      break;
    default:
      closeBasicModal(modal);
      break;
  }
}

document.addEventListener('keydown', (event) => {
  const modal = getTopManagedModal();
  if (!modal) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeManagedModal(modal);
    return;
  }

  if (event.key !== 'Tab') return;
  const focusables = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisibleForFocus);
  if (focusables.length === 0) {
    event.preventDefault();
    modal.focus({ preventScroll: true });
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
});

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

function formatWaitlistStatus(status) {
  const labels = {
    WAITING: 'Estamos esperando que se libere una mesa.',
    CALLED: '¡Tu mesa está lista! Acercate al ingreso.',
    SEATED: 'Tu grupo fue asignado a una mesa.',
    CANCELLED: 'Este turno fue cancelado.',
    NO_SHOW: 'El turno venció por falta de presentación.'
  };
  return labels[status] || 'Estamos actualizando tu turno.';
}

function setWaitlistPublicMode() {
  if (!el.waitlistPublicRoot) return;
  el.waitlistPublicRoot.classList.remove('hidden');
  el.waitlistPublicRoot.classList.add('flex');
  document.body.classList.remove('justify-between', 'max-w-md', 'p-3.5', 'sm:p-4');
  document.querySelectorAll('body > *:not(#waitlistPublicRoot)').forEach((node) => {
    node.classList.add('hidden');
  });
}

function showWaitlistPublicView(view) {
  el.waitlistJoinView?.classList.toggle('hidden', view !== 'join');
  el.waitlistTicketView?.classList.toggle('hidden', view !== 'ticket');
  el.waitlistUnavailableView?.classList.toggle('hidden', view !== 'unavailable');
}

function renderWaitlistPreOrderMenu() {
  if (!el.waitlistPreOrderSection || !el.waitlistPreOrderList) return;
  if (!publicWaitlistPreOrderEnabled || publicWaitlistMenuItems.length === 0) {
    el.waitlistPreOrderSection.classList.add('hidden');
    return;
  }

  el.waitlistPreOrderList.replaceChildren();
  publicWaitlistMenuItems.slice(0, 30).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2';
    const text = document.createElement('span');
    text.className = 'min-w-0 flex-1 text-[11px] font-semibold text-slate-200';
    text.textContent = `${item.name} · $${Number(item.price).toLocaleString('es-AR')}`;
    const qty = document.createElement('input');
    qty.type = 'hidden';
    qty.value = '0';
    qty.dataset.preorderItemId = item.id;
    const controls = document.createElement('div');
    controls.className = 'flex shrink-0 items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `Cantidad de ${item.name}`);
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 text-xl leading-none text-white disabled:cursor-not-allowed disabled:opacity-40';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Restar ${item.name}`);
    const display = document.createElement('output');
    display.className = 'min-w-7 text-center text-sm font-black text-white';
    display.textContent = '0';
    display.setAttribute('aria-live', 'polite');
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 text-xl leading-none text-white disabled:cursor-not-allowed disabled:opacity-40';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Sumar ${item.name}`);
    const setQuantity = (value) => {
      const quantity = Math.min(50, Math.max(0, Math.round(Number(value) || 0)));
      qty.value = String(quantity);
      display.textContent = String(quantity);
      minus.disabled = quantity <= 0;
      plus.disabled = quantity >= 50;
    };
    minus.addEventListener('click', () => setQuantity(Number(qty.value) - 1));
    plus.addEventListener('click', () => setQuantity(Number(qty.value) + 1));
    controls.append(minus, display, plus);
    row.append(text, controls, qty);
    el.waitlistPreOrderList.appendChild(row);
  });
  el.waitlistPreOrderSection.classList.remove('hidden');
}

function collectWaitlistPreOrder() {
  if (!publicWaitlistPreOrderEnabled || !el.waitlistPreOrderList) return [];
  return [...el.waitlistPreOrderList.querySelectorAll('[data-preorder-item-id]')]
    .map((input) => ({ menuItemId: input.dataset.preorderItemId, quantity: Number(input.value) || 0 }))
    .filter((line) => line.quantity > 0);
}

function renderPublicWaitlistTicket(ticket) {
  publicWaitlistTicket = ticket;
  showWaitlistPublicView('ticket');
  if (el.waitlistTicketGuest) el.waitlistTicketGuest.textContent = ticket.guestName ? `${ticket.guestName}, tu turno está registrado` : 'Tu turno está registrado';
  if (el.waitlistTicketPosition) el.waitlistTicketPosition.textContent = ticket.positionInQueue ? `#${ticket.positionInQueue}` : '—';
  if (el.waitlistTicketWait) el.waitlistTicketWait.textContent = ticket.estimatedWaitMinutes ? `${ticket.estimatedWaitMinutes} min` : 'Ahora';
  if (el.waitlistTicketStatus) el.waitlistTicketStatus.textContent = formatWaitlistStatus(ticket.status);
  if (el.waitlistTicketMeta) el.waitlistTicketMeta.textContent = `Estado: ${ticket.status === 'CALLED' ? 'LLAMADO' : ticket.status === 'SEATED' ? 'SENTADO' : ticket.status === 'WAITING' ? 'EN ESPERA' : ticket.status}`;
}

async function refreshPublicWaitlistTicket() {
  if (!publicWaitlistSlug || !publicWaitlistTicket?.id || !publicWaitlistTicket.phone) return;
  const query = new URLSearchParams({ phone: publicWaitlistTicket.phone });
  try {
    const res = await fetchWithRetry(`${API_BASE}/waitlist/${encodeURIComponent(publicWaitlistTicket.id)}/status?${query.toString()}`, {}, 2, 5000);
    if (res.status === 404) {
      window.sessionStorage.removeItem(`mesaya_waitlist_${publicWaitlistSlug}`);
      showWaitlistPublicView('join');
      return;
    }
    if (!res.ok) return;
    const ticket = await res.json();
    ticket.phone = publicWaitlistTicket.phone;
    renderPublicWaitlistTicket(ticket);
    if (ticket.status === 'SEATED' || ticket.status === 'CANCELLED' || ticket.status === 'NO_SHOW') {
      if (publicWaitlistTimer) window.clearInterval(publicWaitlistTimer);
      publicWaitlistTimer = null;
    }
  } catch (_) {
    // La pantalla conserva el último estado válido y reintenta en el próximo ciclo.
  }
}

async function initWaitlistPublic(slug) {
  publicWaitlistSlug = String(slug || '').trim().toLowerCase();
  if (!publicWaitlistSlug) return;
  setWaitlistPublicMode();
  showWaitlistPublicView('join');

  const stored = window.sessionStorage.getItem(`mesaya_waitlist_${publicWaitlistSlug}`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.id && parsed?.phone) {
        publicWaitlistTicket = parsed;
        showWaitlistPublicView('ticket');
        await refreshPublicWaitlistTicket();
      }
    } catch (_) {
      window.sessionStorage.removeItem(`mesaya_waitlist_${publicWaitlistSlug}`);
    }
  }

  try {
    const [configRes, menuRes] = await Promise.all([
      fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(publicWaitlistSlug)}/config`, {}, 2, 5000),
      fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(publicWaitlistSlug)}/menu`, {}, 2, 5000)
    ]);
    if (!configRes.ok) throw new Error('Restaurante no encontrado');
    const config = await configRes.json();
    if (el.waitlistRestaurantName) el.waitlistRestaurantName.textContent = config.restaurantName || 'Fila virtual';
    if (config.enableWaitlist === false) {
      if (el.waitlistUnavailableText) el.waitlistUnavailableText.textContent = 'El encargado todavía no habilitó el ingreso de grupos.';
      showWaitlistPublicView('unavailable');
      return;
    }
    publicWaitlistPreOrderEnabled = config.enableWaitlistPreOrder === true;
    if (menuRes.ok) {
      const menu = await menuRes.json();
      publicWaitlistMenuItems = (menu.categories || []).flatMap((category) => category.items || []).filter((item) => item.isAvailable);
      renderWaitlistPreOrderMenu();
      if (menu.restaurant?.name && el.waitlistRestaurantName) el.waitlistRestaurantName.textContent = menu.restaurant.name;
    }
  } catch (err) {
    if (el.waitlistUnavailableText) el.waitlistUnavailableText.textContent = 'No pudimos cargar el restaurante. Revisá el enlace o intentá nuevamente.';
    showWaitlistPublicView('unavailable');
  }

  if (!el.waitlistJoinForm || el.waitlistJoinForm.dataset.bound === 'true') return;
  el.waitlistJoinForm.dataset.bound = 'true';
  el.waitlistJoinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (el.waitlistJoinError) el.waitlistJoinError.classList.add('hidden');
    if (el.waitlistJoinButton) { el.waitlistJoinButton.disabled = true; el.waitlistJoinButton.textContent = 'Registrando…'; }
    try {
      const phone = el.waitlistPhone.value.trim();
      const response = await fetchWithRetry(`${API_BASE}/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantSlug: publicWaitlistSlug,
          guestName: el.waitlistGuestName.value.trim(),
          partySize: Number(el.waitlistPartySize.value),
          phone,
          consent: el.waitlistConsent.checked,
          preOrderData: collectWaitlistPreOrder()
        })
      }, 2, 7000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar el turno');
      publicWaitlistTicket = { ...data, phone };
      window.sessionStorage.setItem(`mesaya_waitlist_${publicWaitlistSlug}`, JSON.stringify(publicWaitlistTicket));
      renderPublicWaitlistTicket(publicWaitlistTicket);
      if (publicWaitlistTimer) window.clearInterval(publicWaitlistTimer);
      publicWaitlistTimer = window.setInterval(refreshPublicWaitlistTicket, 10000);
    } catch (err) {
      if (el.waitlistJoinError) { el.waitlistJoinError.textContent = err.message || 'No se pudo registrar el turno.'; el.waitlistJoinError.classList.remove('hidden'); }
    } finally {
      if (el.waitlistJoinButton) { el.waitlistJoinButton.disabled = false; el.waitlistJoinButton.textContent = 'Sumarme a la fila'; }
    }
  });

  el.waitlistNewTicketButton?.addEventListener('click', () => {
    window.sessionStorage.removeItem(`mesaya_waitlist_${publicWaitlistSlug}`);
    publicWaitlistTicket = null;
    el.waitlistJoinForm?.reset();
    if (el.waitlistPartySize) el.waitlistPartySize.value = '2';
    showWaitlistPublicView('join');
  });
  if (publicWaitlistTicket) {
    if (publicWaitlistTimer) window.clearInterval(publicWaitlistTimer);
    publicWaitlistTimer = window.setInterval(refreshPublicWaitlistTicket, 10000);
  }
}

async function init(overrideToken) {
  const tableParams = getTableParams();
  if (tableParams.queueSlug && !overrideToken) {
    await initWaitlistPublic(tableParams.queueSlug);
    return;
  }
  if (tableParams.menuSlug && !overrideToken) {
    await initPublicMenuOnly(tableParams.menuSlug);
    return;
  }
  publicMenuOnly = false;
  staticMenuOnly = false;
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
      renderActiveCalls([]);
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
        if (data.restaurant.slug) {
          loadDynamicMenu(data.restaurant.slug);
          loadRestaurantModuleConfig(data.restaurant.slug);
        }
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
    // E17: si cambió la mesa/restaurante, el estado auxiliar del borrador
    // anterior queda inválido y se limpia sin restaurar pedidos viejos.
    trackCartSessionContext();
    markOnline();
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
    }

    loadActiveOrder({ silent: true });

    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    if (el.stateExpired) el.stateExpired.classList.add('hidden');
    if (el.actionsContainer) el.actionsContainer.classList.remove('hidden');

    const initialActiveCalls = Array.isArray(data.activeCalls)
      ? data.activeCalls
      : (data.activeCall ? [data.activeCall] : []);
    renderActiveCalls(initialActiveCalls);

    // Start background sync
    startPolling();
  } catch (err) {
    console.warn('Falla al conectar sesión:', err);
    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    showConnectionState('No pudimos comprobar la mesa. Revisá la conexión y reintentá; la carta sigue disponible para consultar.');
  }
}

function buildStaticCatalogMenuResponse(catalog, restaurantMeta = null) {
  const catalogRestaurant = catalog.restaurant || {};
  const restaurant = {
    ...catalogRestaurant,
    id: restaurantMeta?.id || catalogRestaurant.id || `${catalogRestaurant.slug || 'menu'}-demo`,
    slug: restaurantMeta?.slug || catalogRestaurant.slug,
    customFont: 'outfit'
  };
  return {
    restaurant,
    categories: (catalog.categories || []).map((category, categoryIndex) => ({
      id: `fauno-category-${categoryIndex + 1}`,
      restaurantId: restaurant.id,
      name: category.name,
      icon: category.icon,
      orderIndex: category.orderIndex,
      items: (category.items || []).map((item, itemIndex) => ({
        id: `fauno-item-${categoryIndex + 1}-${itemIndex + 1}`,
        categoryId: `fauno-category-${categoryIndex + 1}`,
        ...item,
        imageUrl: item.imageUrl || null
      }))
    }))
  };
}

async function initPublicMenuOnly(slug) {
  publicMenuOnly = true;
  staticMenuOnly = true;
  currentSession = null;
  currentToken = null;
  try { sessionStorage.removeItem('mesaya_token'); } catch (_) {}

  if (el.stateLoading) el.stateLoading.classList.remove('hidden');
  if (el.stateExpired) el.stateExpired.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  if (el.activeCallCard) el.activeCallCard.classList.add('hidden');
  if (el.btnOpenCartHeader) el.btnOpenCartHeader.classList.add('hidden');

  if (slug !== 'fauno-olavarria') {
    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    showExpiredState('Carta pública no encontrada.');
    return;
  }

  try {
    const response = await fetch('/demo/fauno-olavarria/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Carta estática ${response.status}`);
    const catalog = await response.json();
    const menuResponse = buildStaticCatalogMenuResponse(catalog);
    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    if (el.restaurantName) el.restaurantName.textContent = catalog.restaurant.name;
    if (el.tableBadge) el.tableBadge.textContent = 'Carta pública';
    if (el.sectorBadge) el.sectorBadge.textContent = 'Olavarría 3232';
    renderDynamicMenu(menuResponse);
    const heading = document.getElementById('menuHeading');
    if (heading) heading.textContent = 'Carta Fauno Olavarría';
    const orderButton = document.getElementById('btnOrderFromMenu');
    if (orderButton) orderButton.classList.add('hidden');
    if (el.modalMenu) {
      el.modalMenu.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalMenu);
    }
  } catch (error) {
    console.warn('No se pudo cargar la carta pública Fauno:', error);
    if (el.stateLoading) el.stateLoading.classList.add('hidden');
    showConnectionState('No se pudo cargar la carta Fauno. Recargá la página para reintentar.');
  }
}

function showInactiveState(message) {
  if (el.stateLoading) el.stateLoading.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  renderActiveCalls([]);
  if (el.stateExpired) {
    el.stateExpired.classList.remove('hidden');
    el.stateExpired.dataset.state = 'inactive';
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
  try {
    sessionStorage.removeItem('mesaya_token');
  } catch (_) {}
  currentToken = null;
  // E17: sesión vencida invalida el estado auxiliar del borrador y libera los
  // mutex. No se restaura nada local al cambiar de mesa o sesión: el borrador
  // se recarga siempre desde el servidor.
  invalidateCartSubmitState();
  dishAddInFlight = false;
  cartRemoveInFlight.clear();
  isCartSubmitting = false;
  activeOrder = null;
  orderHistory = [];
  renderCart();

  if (el.stateLoading) el.stateLoading.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  renderActiveCalls([]);
  if (el.stateExpired) {
    el.stateExpired.classList.remove('hidden');
    el.stateExpired.dataset.state = 'expired';
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

function showConnectionState(message) {
  if (el.stateLoading) el.stateLoading.classList.add('hidden');
  if (el.actionsContainer) el.actionsContainer.classList.add('hidden');
  renderActiveCalls([]);
  if (el.stateExpired) {
    el.stateExpired.classList.remove('hidden');
    el.stateExpired.dataset.state = 'connection';
    const titleEl = el.stateExpired.querySelector('h3');
    if (titleEl) titleEl.textContent = 'Conexión interrumpida';
    if (el.expiredMessageText && message) {
      el.expiredMessageText.textContent = message;
    }
    if (el.btnReactivateSession) {
      el.btnReactivateSession.textContent = 'Reintentar conexión';
    }
  }
}

let selectedDishForOrder = null;

function setDishOrderQuantity(value) {
  const quantity = Math.min(50, Math.max(1, Math.round(Number(value) || 1)));
  if (el.dishOrderQuantity) el.dishOrderQuantity.value = String(quantity);
  if (el.dishOrderQuantityDisplay) el.dishOrderQuantityDisplay.textContent = String(quantity);
  if (el.btnDishOrderQuantityMinus) el.btnDishOrderQuantityMinus.disabled = quantity <= 1;
  if (el.btnDishOrderQuantityPlus) el.btnDishOrderQuantityPlus.disabled = quantity >= 50;
  return quantity;
}

const MENU_TAG_MAP = {
  GLUTEN_FREE: { label: 'Sin TACC', emoji: '🌾', class: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  VEGAN: { label: 'Vegano', emoji: '🌱', class: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  VEGETARIAN: { label: 'Vegetariano', emoji: '🧀', class: 'text-lime-400 bg-lime-400/10 border-lime-400/30' },
  CHEF_PICK: { label: 'Sugerencia', emoji: '⭐', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  SPICY: { label: 'Picante', emoji: '🌶️', class: 'text-rose-400 bg-rose-400/10 border-rose-400/30' },
  POPULAR: { label: 'Más Pedido', emoji: '🔥', class: 'text-orange-400 bg-orange-400/10 border-orange-400/30' }
};

// E19: filtros públicos determinísticos por preferencia dietaria confirmada.
// Sólo usan los tags estructurados declarados por el local (GLUTEN_FREE,
// VEGAN, VEGETARIAN). Nunca se infiere por nombre, descripción, imagen,
// categoría o IA: desconocido no es coincidencia.
const MENU_DIET_FILTERS = [
  { id: 'ALL', label: 'Todas', tag: null },
  { id: 'GLUTEN_FREE', label: 'Sin TACC', tag: 'GLUTEN_FREE' },
  { id: 'VEGAN', label: 'Vegano', tag: 'VEGAN' },
  { id: 'VEGETARIAN', label: 'Vegetariano', tag: 'VEGETARIAN' }
];
const MENU_DIET_TAGS = new Set(['GLUTEN_FREE', 'VEGAN', 'VEGETARIAN']);
const MENU_DIET_UNKNOWN_NOTICE = 'Sin información alimentaria confirmada — consultá al personal antes de pedir.';
const MENU_DIET_BAR_NOTICE = 'Las etiquetas las declara el local y no certifican ausencia de alérgenos ni contaminación cruzada. Si tenés alergia, consultá al personal antes de pedir.';

// E19: estado local pequeño y determinístico. Sobrevive a re-ejecuciones de
// renderDynamicMenu por respuesta de red o cambio de tema.
let menuDietFilter = 'ALL';
let menuCategoryFilter = 'ALL';

function normalizeMenuItemTags(item) {
  if (!item || !Array.isArray(item.tags)) return [];
  return item.tags.filter((tag) => typeof tag === 'string');
}

function getMenuItemDietTags(item) {
  return normalizeMenuItemTags(item).filter((tag) => MENU_DIET_TAGS.has(tag));
}

// E19: el filtro dietario sólo pasa con el tag confirmado presente. En modo
// ALL todo sigue visible, incluidos los productos sin datos dietarios.
function dishMatchesDietFilter(item, dietFilter) {
  const filter = dietFilter || menuDietFilter || 'ALL';
  if (filter === 'ALL') return true;
  if (!MENU_DIET_TAGS.has(filter)) return true;
  return normalizeMenuItemTags(item).includes(filter);
}

function dishMatchesCategoryFilter(categoryKey, categoryFilter) {
  const filter = categoryFilter || menuCategoryFilter || 'ALL';
  if (filter === 'ALL') return true;
  return categoryKey === filter;
}

function getMenuDietNoticeForItem(item) {
  const dietTags = getMenuItemDietTags(item);
  if (dietTags.length === 0) return MENU_DIET_UNKNOWN_NOTICE;
  const labels = dietTags.map((tag) => {
    const known = MENU_TAG_MAP[tag];
    return known ? `${known.emoji} ${known.label}` : tag;
  }).join(' · ');
  return `Etiquetas declaradas por el local: ${labels}. Consultá al personal ante alergias.`;
}

function setMenuDietFilter(filterId) {
  const next = MENU_DIET_FILTERS.some((option) => option.id === filterId) ? filterId : 'ALL';
  menuDietFilter = next;
  syncMenuFilterControls();
  if (lastMenuResponse) renderDynamicMenu(lastMenuResponse);
}

function setMenuCategoryFilter(categoryKey) {
  menuCategoryFilter = categoryKey || 'ALL';
  syncMenuFilterControls();
  if (lastMenuResponse) renderDynamicMenu(lastMenuResponse);
}

function clearMenuFilters() {
  menuDietFilter = 'ALL';
  menuCategoryFilter = 'ALL';
  syncMenuFilterControls();
  if (lastMenuResponse) renderDynamicMenu(lastMenuResponse);
}

function syncMenuFilterControls() {
  document.querySelectorAll('#menuDietFilters [data-diet-filter]').forEach((button) => {
    const active = button.getAttribute('data-diet-filter') === menuDietFilter;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('bg-amber-500/20', active);
    button.classList.toggle('text-amber-200', active);
    button.classList.toggle('border-amber-500/50', active);
  });
  const select = document.getElementById('menuCategoryFilterSelect');
  if (select && select.value !== menuCategoryFilter) {
    const hasOption = Array.from(select.options).some((option) => option.value === menuCategoryFilter);
    select.value = hasOption ? menuCategoryFilter : 'ALL';
    if (!hasOption) menuCategoryFilter = 'ALL';
  }
}

function updateMenuFilterStatus(visibleCount, totalCount) {
  const status = document.getElementById('menuFilterStatus');
  if (!status) return;
  const dietLabel = (MENU_DIET_FILTERS.find((option) => option.id === menuDietFilter) || {}).label || 'Todas';
  const categoryLabel = menuCategoryFilter === 'ALL' ? 'todas las categorías' : 'la categoría elegida';
  status.textContent = visibleCount === 0
    ? `Sin platos para esta combinación (${dietLabel} · ${categoryLabel}). Probá con Todas o limpiá los filtros.`
    : `Mostrando ${visibleCount} de ${totalCount} platos (${dietLabel} · ${categoryLabel}).`;
}

function bindMenuFilterControls() {
  if (bindMenuFilterControls.bound) return;
  bindMenuFilterControls.bound = true;
  document.querySelectorAll('#menuDietFilters [data-diet-filter]').forEach((button) => {
    button.addEventListener('click', () => setMenuDietFilter(button.getAttribute('data-diet-filter')));
  });
  document.getElementById('menuCategoryFilterSelect')?.addEventListener('change', (event) => {
    setMenuCategoryFilter(event.target.value);
  });
  document.getElementById('menuFiltersClear')?.addEventListener('click', clearMenuFilters);
}

function openDishDetailSheet(item, categoryId) {
  const trigger = document.activeElement;
  selectedDishForOrder = item;
  triggerHaptic();
  saveMenuContext(categoryId);

  setDishOrderQuantity(1);
  if (el.dishOrderNote) el.dishOrderNote.value = '';
  const guestNameInput = document.getElementById('dishOrderGuestName');
  if (guestNameInput) guestNameInput.value = getGuestName();
  setDishSheetError('');

  const sheet = document.getElementById('dishDetailSheetBackdrop');
  if (!sheet) return;

  const imgEl = document.getElementById('dishSheetImage');
  const titleEl = document.getElementById('dishSheetTitle');
  const descEl = document.getElementById('dishSheetDescription');
  const priceEl = document.getElementById('dishSheetPrice');
  const tagsEl = document.getElementById('dishSheetTagsContainer');
  const pairingBox = document.getElementById('dishSheetPairingBox');
  const pairingText = document.getElementById('dishSheetPairingText');

  if (imgEl) {
    const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
    imgEl.src = sanitizeUrl(item.imageUrl, defaultImg);
    imgEl.alt = item.name ? `Fotografía de ${item.name}` : 'Plato del menú';
  }
  if (titleEl) titleEl.textContent = item.name;
  if (descEl) descEl.textContent = item.description || 'Elaborado artesanalmente en el momento con ingredientes frescos de primera calidad.';
  if (priceEl) priceEl.textContent = `$${Number(item.price).toLocaleString('es-AR')}`;

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

  // E19: información alimentaria honesta en el detalle. Nunca se inventa una
  // etiqueta: sin tags confirmados se indica desconocido y consulta.
  const dietInfoEl = document.getElementById('dishSheetDietInfo');
  if (dietInfoEl) {
    dietInfoEl.textContent = getMenuDietNoticeForItem(item);
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

  const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
  const dishAvailable = item.isAvailable !== false;
  const availEl = document.getElementById('dishSheetAvailability');
  if (availEl) {
    if (dishAvailable) {
      availEl.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200';
      availEl.textContent = '✅ Disponible — agregar al carrito no cobra. Podés editar cantidad, nota larga y nombre sin perder otro cambio de la mesa.';
      availEl.classList.remove('hidden');
    } else {
      availEl.className = 'rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-[11px] leading-relaxed text-rose-200';
      availEl.textContent = '⛔ No disponible — el plato no se puede agregar ahora. El resto del carrito queda intacto.';
      availEl.classList.remove('hidden');
    }
  }
  if (orderSpecificBtn) {
    const canOrder = dishAvailable && !publicMenuOnly && !staticMenuOnly;
    orderSpecificBtn.disabled = !canOrder;
    orderSpecificBtn.setAttribute('aria-disabled', String(!canOrder));
    orderSpecificBtn.classList.toggle('opacity-50', !canOrder);
    orderSpecificBtn.classList.toggle('cursor-not-allowed', !canOrder);
    const orderLabel = orderSpecificBtn.querySelector('span');
    if (orderLabel) orderLabel.textContent = publicMenuOnly || staticMenuOnly
      ? '📖 Sólo consulta en esta demo'
      : (dishAvailable ? '🛒 Agregar al carrito — no se cobra aún' : '⛔ No disponible');
  }

  rememberModalFocus(trigger);
  sheet.setAttribute('aria-hidden', 'false');
  sheet.removeAttribute('inert');
  sheet.classList.add('active');
  document.body.classList.add('modal-open');
  focusManagedModal(sheet);
}

function closeDishDetailSheet() {
  const sheet = document.getElementById('dishDetailSheetBackdrop');
  if (sheet) {
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.setAttribute('inert', '');
  }
  selectedDishForOrder = null;

  // Only remove modal-open if no other drawer or modal is active
  if (!hasOpenManagedModal()) {
    document.body.classList.remove('modal-open');
  }
  restoreModalFocusIfNone();
  restoreMenuContext();
}

let lastMenuResponse = null;

async function loadDynamicMenu(slug) {
  const staticCatalogUrl = STATIC_CATALOG_BY_RESTAURANT[slug];
  staticMenuOnly = Boolean(staticCatalogUrl);
  if (staticCatalogUrl) {
    try {
      const staticResponse = await fetch(staticCatalogUrl, { cache: 'no-store' });
      if (!staticResponse.ok) throw new Error(`Catálogo estático ${staticResponse.status}`);
      const catalog = await staticResponse.json();
      const restaurantMeta = currentSession?.restaurant || null;
      const menuResponse = buildStaticCatalogMenuResponse(catalog, restaurantMeta);
      lastMenuResponse = menuResponse;
      renderDynamicMenu(menuResponse);
      return;
    } catch (err) {
      console.warn('No se pudo cargar el catálogo Fauno integrado; se intenta la carta del API:', err);
      staticMenuOnly = false;
    }
  }
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

function getGuestSessionId() {
  const key = 'mesaya_guest_session_id';
  let value = null;
  try { value = sessionStorage.getItem(key); } catch (_) {}
  if (value) return value;

  const generated = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try { sessionStorage.setItem(key, generated); } catch (_) {}
  return generated;
}

function orderStatusLabel(status) {
  const labels = {
    DRAFT: 'Borrador colaborativo — no cobrado',
    PENDING_VALIDATION: 'Esperando validación del mozo',
    CONFIRMED: 'Comanda confirmada',
    IN_KITCHEN: 'En cocina',
    READY_TO_SERVE: 'Lista para servir',
    SERVED: 'Servida',
    PAID: 'Cobrada',
    CANCELLED: 'Cancelada'
  };
  return labels[status] || status || 'Sin comanda';
}

function orderHistoryStatus(status, cancellationReason) {
  const labels = {
    PENDING_VALIDATION: 'Esperando confirmación',
    CONFIRMED: 'Recibido para preparar',
    IN_KITCHEN: 'Recibido para preparar — en cocina',
    READY_TO_SERVE: 'Listo para entregar',
    SERVED: 'Entregado',
    PAID: 'Cobrado — entrega no informada',
    CANCELLED: 'Rechazado/cancelado — no se cobra'
  };
  if (status === 'CANCELLED' && cancellationReason) {
    return `${labels[status]} Motivo: ${cancellationReason}`;
  }
  return labels[status] || 'Estado del pedido: ' + (status || 'desconocido');
}

function formatMinorAmount(value) {
  const minor = Number(value);
  if (!Number.isFinite(minor)) return '$0';
  return `$${Math.round(minor / 100).toLocaleString('es-AR')}`;
}

function formatOrderHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderOrderHistory() {
  if (!el.orderHistorySection || !el.orderHistoryList || !el.orderHistoryEmpty) return;
  const history = Array.isArray(orderHistory) ? orderHistory : [];
  el.orderHistoryList.innerHTML = history.map((round, index) => {
    const items = Array.isArray(round.items) ? round.items : [];
    const itemText = items.length
      ? items.map((item) => `
          <li class="flex items-start justify-between gap-2 py-1.5 border-b border-slate-800/60 last:border-0">
            <span class="min-w-0 break-words"><strong class="text-white">${escapeHtml(item.quantity)}x</strong> ${escapeHtml(item.name)}</span>
            <span class="shrink-0 font-semibold text-slate-200">${formatMinorAmount(item.lineTotalMinor)}</span>
          </li>
        `).join('')
      : '<li class="text-slate-500 italic">Sin detalle de ítems disponible.</li>';
    return `
      <article data-order-history-id="${escapeHtmlAttr(round.orderId)}" data-order-status="${escapeHtmlAttr(round.status)}" class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h5 class="text-xs font-black text-white">Tanda ${index + 1}</h5>
            <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(formatOrderHistoryDate(round.createdAt))}</p>
          </div>
          <span class="shrink-0 text-sm font-black text-amber-400">${formatMinorAmount(round.totalMinor)}</span>
        </div>
        <p class="text-xs font-bold leading-relaxed text-indigo-200">${escapeHtml(orderHistoryStatus(round.status, round.cancellationReason))}</p>
        <ul class="text-[11px] text-slate-300 leading-relaxed">${itemText}</ul>
      </article>
    `;
  }).join('');
  el.orderHistoryEmpty.classList.toggle('hidden', history.length > 0);
  el.orderHistoryList.classList.toggle('hidden', history.length === 0);
  el.orderHistorySection.classList.remove('hidden');
}

// C04: nombre del comensal y preservación de contexto de carta
function getGuestName() {
  try { return (sessionStorage.getItem('mesaya_guest_name') || '').trim(); } catch (_) { return ''; }
}
function setGuestName(name) {
  const v = String(name || '').trim();
  try {
    if (!v) sessionStorage.removeItem('mesaya_guest_name');
    else if (v.length <= 40) sessionStorage.setItem('mesaya_guest_name', v);
  } catch (_) {}
  return v;
}
let lastMenuScrollTop = 0;
let lastMenuCategoryId = null;
function getMenuScrollContainer() {
  return document.getElementById('menuScrollContent')
    || document.getElementById('dynamicMenuCategoriesContainer');
}
function saveMenuContext(categoryId) {
  const sc = getMenuScrollContainer();
  if (sc) lastMenuScrollTop = sc.scrollTop;
  if (categoryId) lastMenuCategoryId = categoryId;
}
function restoreMenuContext() {
  const sc = getMenuScrollContainer();
  if (!sc) return;
  requestAnimationFrame(() => {
    sc.scrollTop = lastMenuScrollTop;
    if (!lastMenuCategoryId) return;
    const target = document.getElementById(lastMenuCategoryId);
    if (!target) return;

    // Only repair the anchor when rerendering changed the saved category's
    // visibility; otherwise keep the exact scroll position the guest left.
    const scrollRect = sc.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const stickyInset = 72;
    const outsideViewport = targetRect.top < scrollRect.top + stickyInset
      || targetRect.bottom > scrollRect.bottom;
    if (outsideViewport) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}
function setCartError(msg) {
  const c = document.getElementById('cartError');
  if (!c) return;
  if (!msg) { c.classList.add('hidden'); c.textContent = ''; return; }
  c.textContent = String(msg);
  c.classList.remove('hidden');
}
function setDishSheetError(msg) {
  const c = document.getElementById('dishSheetError');
  if (!c) return;
  if (!msg) { c.classList.add('hidden'); c.textContent = ''; return; }
  c.textContent = String(msg);
  c.classList.remove('hidden');
}

function renderCart() {
  const order = activeOrder;
  const items = order?.items || [];
  // El encabezado representa el borrador editable, no la última tanda
  // enviada. Mostrar allí los ítems de una comanda servida hacía creer que
  // todavía había algo pendiente de enviar.
  const itemCount = order?.status === 'DRAFT'
    ? items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : 0;

  if (el.headerCartCount) {
    el.headerCartCount.textContent = String(itemCount);
    el.headerCartCount.classList.toggle('hidden', itemCount === 0);
  }
  if (el.cartEmptyState) el.cartEmptyState.classList.toggle('hidden', items.length > 0);
  if (el.cartItemsList) {
      el.cartItemsList.innerHTML = items.map((item) => {
      // E13: identidad solo desde guestName (texto escapado); jamás IDs técnicos.
      const displayAddedBy = typeof item.guestName === 'string' ? item.guestName.trim() : '';
      const addedBy = escapeHtml(displayAddedBy);
      const notes = item.notes ? escapeHtml(item.notes) : '';
      return `
      <div class="flex items-start justify-between gap-3 rounded-2xl bg-slate-950/70 border border-slate-800 p-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold text-white break-words"><span class="text-amber-400">${escapeHtml(item.quantity)}x</span> ${escapeHtml(item.name)}</p>
          ${addedBy ? `<p class="text-[10px] font-semibold text-indigo-300 mt-1 break-words">— ${addedBy}</p>` : ''}
          ${notes ? `<p class="text-[11px] text-slate-300 mt-1 whitespace-pre-wrap break-words border-l-2 border-slate-700 pl-2">${notes}</p>` : ''}
          <p class="text-[10px] text-slate-400 mt-1">$${Number(item.unitPrice * item.quantity).toLocaleString('es-AR')} · $${Number(item.unitPrice).toLocaleString('es-AR')} c/u</p>
        </div>
        ${order?.status === 'DRAFT' ? `<button type="button" data-cart-remove="${escapeHtmlAttr(item.id)}" class="shrink-0 min-h-[36px] min-w-[56px] text-[11px] font-bold text-rose-300 hover:text-rose-200 px-3 py-2 rounded-xl border border-rose-500/30 active:scale-95" aria-label="Quitar ${escapeHtmlAttr(item.name)}">Quitar</button>` : ''}
      </div>
    `;
    }).join('');

    el.cartItemsList.querySelectorAll('[data-cart-remove]').forEach((button) => {
      button.addEventListener('click', () => removeCartItem(button.getAttribute('data-cart-remove'), button));
    });
  }

  if (el.cartTotal) el.cartTotal.textContent = `$${Number(order?.totalAmount || 0).toLocaleString('es-AR')}`;
  // C04 UI-state: cart copy reflects draft vs submitted consumption
  const cartHeading = document.getElementById('cartHeading');
  const cartCollaborativeHint = document.getElementById('cartCollaborativeHint');
  const cartNoChargeHint = document.getElementById('cartNoChargeHint');
  const cartTotalLabel = document.getElementById('cartTotalLabel');
  const cartTotalDisclaimer = document.getElementById('cartTotalDisclaimer');
  if (cartHeading || cartCollaborativeHint || cartNoChargeHint || cartTotalLabel || cartTotalDisclaimer) {
    const isDraft = order?.status === 'DRAFT';
    const hasOrder = Boolean(order);
    const isSubmitted = hasOrder && !isDraft;
    if (!hasOrder) {
      if (cartHeading) cartHeading.textContent = 'Carrito';
      if (cartCollaborativeHint) cartCollaborativeHint.textContent = 'Aún no hay borrador. Agregá platos desde la carta para crear uno.';
      if (cartNoChargeHint) cartNoChargeHint.textContent = 'Agregar al carrito no genera cobro. El cobro es presencial con el mozo.';
      if (cartTotalLabel) cartTotalLabel.textContent = 'Total';
      if (cartTotalDisclaimer) cartTotalDisclaimer.textContent = 'Aún no hay tandas enviadas. La cuenta suma todas las tandas y se ve en “Pedir la cuenta”.';
    } else if (isDraft) {
      if (cartHeading) cartHeading.textContent = 'En tu carrito — borrador';
      if (cartCollaborativeHint) cartCollaborativeHint.textContent = 'Carrito común de la mesa: lo que agregue cualquier comensal aparece aquí. La cuenta es por mesa y se pide en “Pedir la cuenta”. Todavía no se cobró nada.';
      if (cartNoChargeHint) cartNoChargeHint.textContent = 'Agregar al carrito no genera cobro. El cobro es presencial con el mozo. El total de abajo es solo de este borrador.';
      if (cartTotalLabel) cartTotalLabel.textContent = 'Total borrador';
      if (cartTotalDisclaimer) cartTotalDisclaimer.textContent = 'Este total no es la cuenta. La cuenta real suma todas las tandas enviadas y se ve en “Pedir la cuenta”.';
    } else if (isSubmitted) {
      if (cartHeading) cartHeading.textContent = 'Última tanda enviada';
      if (cartCollaborativeHint) cartCollaborativeHint.textContent = 'Estas son las líneas de la última tanda enviada. Para agregar más, volvé a la carta y se creará un nuevo borrador.';
      if (cartNoChargeHint) cartNoChargeHint.textContent = 'Esta tanda ya fue enviada y no es un borrador editable. El cobro sigue siendo presencial con el mozo.';
      if (cartTotalLabel) cartTotalLabel.textContent = 'Total de la tanda';
      if (cartTotalDisclaimer) cartTotalDisclaimer.textContent = 'Este total es solo de la última tanda enviada. La cuenta real acumula todas las tandas y se ve en “Pedir la cuenta”.';
    }
  }
  // C04: total de borrador diferenciado; no es la cuenta
  const draftMeta = document.getElementById('cartDraftMeta');
  const draftLabel = document.getElementById('cartDraftStatusLabel');
  if (draftLabel && order) {
    if (order.status === 'DRAFT') draftLabel.textContent = items.length ? `Borrador · ${items.length} ítem${items.length>1?'s':''}` : 'Borrador vacío';
    else draftLabel.textContent = orderStatusLabel(order.status);
  } else if (draftLabel && !order) {
    draftLabel.textContent = 'Sin borrador';
  }
  if (draftMeta) draftMeta.classList.toggle('hidden', false);
  if (el.cartOrderStatus) {
    if (order) {
      const isDraft = order.status === 'DRAFT';
      el.cartOrderStatus.className = isDraft
        ? 'text-xs rounded-xl border px-3 py-2 leading-relaxed border-amber-500/30 bg-amber-500/10 text-amber-200'
        : 'text-xs rounded-xl border px-3 py-2 leading-relaxed border-indigo-500/30 bg-indigo-500/10 text-indigo-200';
      el.cartOrderStatus.textContent = isDraft
        ? `Borrador: ${orderStatusLabel(order.status)} — todavía no enviado a cocina. Volvé a la carta sin perder posición.`
        : orderStatusLabel(order.status);
      el.cartOrderStatus.classList.remove('hidden');
    } else {
      el.cartOrderStatus.classList.add('hidden');
    }
  }

  const canSubmit = Boolean(activeOrderPolicy.allowOrdering !== false && order?.status === 'DRAFT' && items.length > 0);
  if (el.btnSubmitCart) {
    el.btnSubmitCart.disabled = !canSubmit;
    el.btnSubmitCart.classList.toggle('opacity-50', !canSubmit);
    el.btnSubmitCart.classList.toggle('cursor-not-allowed', !canSubmit);
    const label = el.btnSubmitCart.querySelector('span');
    if (label) label.textContent = canSubmit
      ? (activeOrderPolicy.requireWaiterValidation ? 'Enviar pedido — confirmar al mozo' : 'Enviar pedido — confirmar a cocina')
      : 'Enviar pedido — confirmar';
    el.btnSubmitCart.setAttribute('aria-disabled', String(!canSubmit));
  }
  if (el.btnCartCallWaiter) el.btnCartCallWaiter.classList.toggle('hidden', activeOrderPolicy.allowOrdering !== false && canSubmit);
  renderOrderHistory();
}

async function loadActiveOrder(options = {}) {
  if (!currentToken) {
    activeOrder = null;
    orderHistory = [];
    renderCart();
    return;
  }

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/session/${encodeURIComponent(currentToken)}`);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 410) {
        const message = data.error || 'Sesión finalizada o expirada.';
        showExpiredState(message);
      }
      return;
    }
    activeOrder = data.order || null;
    orderHistory = Array.isArray(data.history)
      ? data.history
      : (Array.isArray(data.account?.tandas) ? data.account.tandas : []);
    activeOrderPolicy = {
      allowOrdering: !staticMenuOnly && data.allowOrdering !== false,
      requireWaiterValidation: data.requireWaiterValidation === true
    };
    renderCart();
  } catch (err) {
    if (!options.silent) showToast('No se pudo actualizar el carrito.', 'error');
  }
}

// E17 (intención 4c8d02f): feedback inmediato y reseteo de la acción del
// plato. El botón se bloquea antes de la primera llamada y se restaura en
// `finally`, de modo que un segundo clic durante el envío se ignora y una
// nueva unidad intencional tras el éxito vuelve a estar permitida.
function setDishOrderButtonBusy(busy, busyLabel) {
  const btn = document.getElementById('btnOrderSpecificDish');
  if (!btn) return;
  btn.disabled = busy;
  btn.setAttribute('aria-disabled', String(busy));
  btn.classList.toggle('opacity-50', busy);
  btn.classList.toggle('cursor-not-allowed', busy);
  const label = btn.querySelector('span');
  if (!label) return;
  if (busy) {
    if (!btn.dataset.e17Label) btn.dataset.e17Label = label.textContent;
    label.textContent = busyLabel || 'Agregando…';
  } else if (btn.dataset.e17Label) {
    label.textContent = btn.dataset.e17Label;
    delete btn.dataset.e17Label;
  }
}

async function addDishToCart(item, quantity, notes) {
  // E17: una intención produce una mutación. El mutex lógico es inmediato,
  // antes de la primera llamada: un `disabled` visual solo no alcanza.
  if (dishAddInFlight) return;
  if (!currentToken) {
    showToast('La mesa todavía no tiene una sesión activa.', 'warning');
    return;
  }
  if (activeOrderPolicy.allowOrdering === false || activeRestaurantConfig?.allowOrdering === false) {
    closeDishDetailSheet();
    showToast('Este local usa carta informativa. Llamá al mozo para pedir.', 'info');
    return;
  }

  // E13: nombre separado de la nota; la nota de cocina nunca lleva "Pedido de ...".
  const guestName = getGuestName();
  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  const notesToSend = trimmedNotes ? trimmedNotes.slice(0, 500) : undefined;
  const guestNameToSend = guestName ? guestName.trim() : undefined;
  if (guestNameToSend && guestNameToSend.length > 40) {
    setDishSheetError('El nombre puede tener hasta 40 caracteres.');
    showToast('Acortá el nombre a 40 caracteres para agregar el plato.', 'warning');
    return;
  }
  const guestSessionIdToSend = getGuestSessionId();

  dishAddInFlight = true;
  setDishOrderButtonBusy(true, `Agregando ${quantity}x…`);
  try {
    const res = await fetchMutationOnce(`${API_BASE}/orders/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: currentToken,
        menuItemId: item.id,
        quantity,
        notes: notesToSend,
        guestName: guestNameToSend,
        guestSessionId: guestSessionIdToSend
      })
    }, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // C04 + B06: mensajes accionables sin pérdida silenciosa
      if (res.status === 409 && data.code === 'DRAFT_CONFLICT') {
        setDishSheetError(data.error || 'Otro comensal editó el carrito al mismo tiempo. Se recargó el carrito; reintentá tu agregado.');
        setCartError(data.error || 'Conflicto de carrito colaborativo: otro cambio se guardó primero.');
        await loadActiveOrder({ silent: true });
        showToast('Carrito actualizado por otro comensal. Revisá y reintentá.', 'warning');
        return;
      }
      if (res.status === 422 && data.code === 'ITEM_NOT_AVAILABLE') {
        setDishSheetError(data.error || 'Ese plato ya no está disponible. El resto del carrito queda intacto.');
        setCartError(data.error || 'Un plato ya no está disponible; quitá ese ítem y reintentá.');
        await loadActiveOrder({ silent: true });
        showToast(data.error || 'Plato no disponible — el resto sigue en el carrito.', 'warning');
        return;
      }
      if (res.status === 410) {
        const message = data.error || 'Sesión finalizada o expirada.';
        showExpiredState(message);
        setDishSheetError(message);
        showToast(message, 'error');
        return;
      }
      setDishSheetError(data.error || 'No se pudo agregar el plato.');
      showToast(data.error || 'No se pudo agregar el plato.', res.status === 422 ? 'warning' : 'error');
      return;
    }
    setDishSheetError('');
    setCartError('');
    // El servidor es la fuente de verdad: se adopta su respuesta sin sumar
    // estado local y remoto dos veces. Historial y cuenta se recargan desde
    // la API; guestName se preserva en sessionStorage.
    activeOrder = data;
    renderCart();
    // FIX cliente→API: no expulsar al carrito; cerrar solo el sheet y volver a la carta
    closeDishDetailSheet();
    ensureMenuModalOpen();
    // E17 (intención 4c8d02f): resetear la acción del plato tras el agregado
    // para que una nueva unidad sea una intención nueva y explícita.
    setDishOrderQuantity(1);
    const cartCount = Array.isArray(activeOrder?.items) ? activeOrder.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0) : quantity;
    showToast(`Agregado (${quantity}x ${item.name}) — carrito: ${cartCount}. Seguí agregando o abrí el carrito.`, 'success', 4500);
  } catch (_) {
    // E17: sin retry ciego ni promesa falsa. La mutación fue una sola
    // tentativa y /orders/items no es idempotente: no se puede afirmar que
    // nada se duplicó. Se reconcilia con el servidor y se pide verificación
    // antes de reintentar de forma consciente.
    setDishSheetError('No se pudo confirmar el agregado. Revisá el carrito: si el plato aparece, no lo agregues de nuevo.');
    showToast('No se pudo confirmar el agregado. Revisá el carrito antes de reintentar.', 'warning');
    await loadActiveOrder({ silent: true });
  } finally {
    dishAddInFlight = false;
    setDishOrderButtonBusy(false);
  }
}

async function removeCartItem(itemId, triggerButton) {
  if (!itemId || !currentToken) return;
  // E17: un clic por ítem por vez; el segundo durante el envío se ignora.
  if (cartRemoveInFlight.has(itemId)) return;
  cartRemoveInFlight.add(itemId);
  const btn = triggerButton instanceof Element ? triggerButton : null;
  const priorLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    btn.textContent = 'Quitando…';
  }
  try {
    const res = await fetchMutationOnce(`${API_BASE}/orders/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: { 'x-session-token': currentToken }
    }, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409 || res.status === 404) {
        setCartError(data.error || 'El carrito cambió (otro comensal lo editó o ya fue enviado). Se recargó.');
        await loadActiveOrder({ silent: true });
        showToast(data.error || 'Carrito actualizado por otro cambio. Revisá antes de seguir.', 'warning');
        return;
      }
      if (res.status === 410) {
        const message = data.error || 'Sesión finalizada o expirada.';
        showExpiredState(message);
        setCartError(message);
        showToast(message, 'error');
        return;
      }
      setCartError(data.error || 'No se pudo quitar el plato.');
      showToast(data.error || 'No se pudo quitar el plato.', 'error');
      return;
    }
    setCartError('');
    activeOrder = data;
    renderCart();
    if (!activeOrder || (activeOrder.items || []).length === 0) {
      showToast('Último ítem quitado — borrador vacío, sin pérdida de enviados.', 'info');
    } else {
      showToast('Plato quitado del borrador.', 'info');
    }
  } catch (_) {
    // E17: sin retry ciego. La mutación fue una sola tentativa: se reconcilia
    // con el servidor y se pide verificación antes de reintentar.
    setCartError('No se pudo confirmar si se quitó el plato. Revisá el carrito antes de reintentar.');
    showToast('No se pudo confirmar el cambio. Revisá el carrito antes de reintentar.', 'warning');
    await loadActiveOrder({ silent: true });
  } finally {
    cartRemoveInFlight.delete(itemId);
    // renderCart recrea los botones (restaura su estado); si el botón
    // original sobrevivió, se restaura su estado visible aquí.
    renderCart();
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
      if (btn.textContent === 'Quitando…') btn.textContent = priorLabel || 'Quitar';
    }
  }
}

async function submitCart() {
  if (isCartSubmitting) return;
  if (!currentToken || !activeOrder || activeOrder.status !== 'DRAFT') return;
  const submitBtn = el.btnSubmitCart;
  if (submitBtn && submitBtn.disabled) return;
  isCartSubmitting = true;
  const originalLabelText = submitBtn ? submitBtn.querySelector('span')?.textContent : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    const label = submitBtn.querySelector('span');
    if (label) label.textContent = 'Enviando…';
  }
  // Idempotencia persistida en sessionStorage para sobrevivir reloads; estable por borrador
  const submitStorageKey = getCartSubmitStorageKey();
  const idempotencyKey = getOrCreateCartSubmitIdempotencyKey();
  setCartError('');
  try {
    // E17: el envío es una sola tentativa (1, 10000). La idempotencia la
    // garantiza la clave estable por borrador que el backend pinnea a una
    // tanda (SubmitReceipt): ante timeout se reintenta con la MISMA clave y
    // el replay devuelve la tanda original sin duplicar.
    const res = await fetchMutationOnce(`${API_BASE}/orders/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: currentToken, idempotencyKey })
    }, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 422 && data.code === 'ITEM_NOT_AVAILABLE') {
        const detail = (data.details?.items || []).map(i => i.name).join(', ');
        setCartError((data.error || 'Un plato ya no está disponible.') + (detail ? ` — ${detail}` : '') + ' Quitá ese ítem; el resto queda intacto.');
        showToast(data.error || 'Un plato ya no está disponible. El resto queda en el carrito.', 'warning');
        await loadActiveOrder({ silent: true });
        return;
      }
      if (res.status === 409) {
        setCartError(data.error || 'Envío concurrente o borrador duplicado. Se recargó el carrito.');
        await loadActiveOrder({ silent: true });
        showToast(data.error || 'El pedido ya fue enviado o hay conflicto. Revisá el carrito.', 'warning');
        return;
      }
      if (res.status === 410) {
        const message = data.error || 'Sesión finalizada o expirada.';
        showExpiredState(message);
        setCartError(message);
        showToast(message, 'error');
        return;
      }
      if (res.status === 403) {
        setCartError(data.error || 'No se pudo enviar.');
        showToast(data.error || 'No se pudo enviar la comanda.', 'error');
        return;
      }
      setCartError(data.error || 'No se pudo enviar la comanda.');
      showToast(data.error || 'No se pudo enviar la comanda.', 'error');
      return;
    }
    activeOrder = data;
    // Pedido ya no es borrador: limpiar clave persistida del borrador confirmado; el próximo borrador generará una nueva
    clearPersistedCartSubmitKey(submitStorageKey);
    renderCart();
    // C04: confirmación inequívoca de envío, diferenciada de borrador
    showToast(activeOrderPolicy.requireWaiterValidation
      ? '✅ Pedido enviado — el mozo lo recibió. Ya no es borrador.'
      : '✅ Pedido enviado — cocina lo recibió. Ya no es borrador.', 'success');
    setCartError('');
    // Mantener el carrito abierto para ver el estado enviado, pero actualizar hint
    const statusEl = document.getElementById('cartOrderStatus');
    if (statusEl) statusEl.textContent = activeOrderPolicy.requireWaiterValidation
      ? 'Enviado al mozo — esperando confirmación. Podés seguir navegando la carta.'
      : 'Enviado a cocina — en preparación. Podés seguir navegando la carta.';
  } catch (_) {
    setCartError('No se pudo conectar. Si no ves el pedido como enviado, reintentá con el mismo carrito — no se duplica por clave.');
    showToast('Conexión intermitente. Verificá si el pedido figura como enviado antes de reintentar.', 'warning');
    await loadActiveOrder({ silent: true });
  } finally {
    isCartSubmitting = false;
    // No re-habilitar a ciegas: delegar a renderCart el estado real (DRAFT vs enviado)
    renderCart();
    if (submitBtn && activeOrder && activeOrder.status === 'DRAFT' && originalLabelText && submitBtn.querySelector('span')?.textContent === 'Enviando…') {
      // Si seguimos en borrador y renderCart no cambió el label (caso error), restaurar
      const label = submitBtn.querySelector('span');
      if (label && !label.textContent.includes('Enviar pedido')) {
        // renderCart ya establece el label correcto; no forzar restauración que pise i18n
      }
    }
  }
}

function ensureMenuModalOpen() {
  const menu = document.getElementById('modalMenu');
  if (menu && menu.classList.contains('hidden')) {
    menu.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
  restoreMenuContext();
}

function openCartModal() {
  const trigger = document.activeElement;
  saveMenuContext();
  closeAllModals({ restoreFocus: false });
  if (el.modalCart) {
    rememberModalFocus(trigger);
    setCartError('');
    loadActiveOrder({ silent: true });
    el.modalCart.classList.remove('hidden');
    document.body.classList.add('modal-open');
    focusManagedModal(el.modalCart);
  }
}

function closeCartModal() {
  if (el.modalCart) el.modalCart.classList.add('hidden');
  if (!hasOpenManagedModal()) {
    document.body.classList.remove('modal-open');
  }
  restoreModalFocusIfNone();
  restoreMenuContext();
}

function applyTemplateTheme(templateId, manual = true) {
  const appBody = document.getElementById('appBody');
  const appHtml = document.documentElement;
  const themeClasses = ['theme-gourmet', 'theme-neon', 'theme-coastal', 'theme-minimal', 'theme-fauno'];

  if (appBody) appBody.classList.remove(...themeClasses);
  if (appHtml) appHtml.classList.remove(...themeClasses);

  const themeClassMap = {
    GOURMET_OBSIDIAN: 'theme-gourmet',
    NEON_BURGER: 'theme-neon',
    COASTAL_BEACH: 'theme-coastal',
    MINIMAL_BISTRO: 'theme-minimal',
    FAUNO_NIGHT: 'theme-fauno'
  };
  const targetClass = themeClassMap[templateId] || 'theme-gourmet';
  if (appBody) appBody.classList.add(targetClass);
  if (appHtml) appHtml.classList.add(targetClass);

  // Dedicated high-res culinary image per theme
  const themeImages = {
    GOURMET_OBSIDIAN: '/assets/images/restaurantes/pastas-artesanales-gourmet.jpg',
    NEON_BURGER: '/assets/images/rotiserias-fastfood/hamburguesa-smash-doble-cheddar.jpg',
    COASTAL_BEACH: '/assets/images/restaurantes/banquete-gastronomia-mediterranea.jpg',
    MINIMAL_BISTRO: '/assets/images/cafeterias-bakery/espresso-perfecto-granos-cafe.jpg',
    FAUNO_NIGHT: '/assets/branding/fauno-olavarria-logo.png'
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

function bindDishCardActivation(card, dish) {
  const categoryId = card.getAttribute('data-category') || card.closest('section[id^="dynamic-cat-"]')?.id || null;
  const open = () => openDishDetailSheet(dish, categoryId);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
}

function renderDynamicMenu(menuResponse) {
  lastMenuResponse = menuResponse;
  const { restaurant, categories } = menuResponse;
  if (!categories || categories.length === 0) return;

  // E19: el estado de filtros sobrevive a re-ejecuciones (red/tema). Si la
  // categoría guardada ya no existe en la nueva respuesta, volver a Todas.
  const knownCategoryKeys = new Set(categories.map((_, idx) => `dynamic-cat-${idx}`));
  if (menuCategoryFilter !== 'ALL' && !knownCategoryKeys.has(menuCategoryFilter)) {
    menuCategoryFilter = 'ALL';
  }
  if (!MENU_DIET_FILTERS.some((option) => option.id === menuDietFilter)) {
    menuDietFilter = 'ALL';
  }

  const templateId = restaurant.templateId || 'GOURMET_OBSIDIAN';
  const allItems = categories.flatMap(c => c.items);

  // 0. Apply Dynamic Theme Classes on Body
  applyTemplateTheme(templateId, false);

  if (el.restaurantName && restaurant.name) el.restaurantName.textContent = restaurant.name;
  const logoBadge = document.getElementById('restaurantLogoBadge');
  if (logoBadge) {
    const safeLogoUrl = sanitizeUrl(restaurant.logoUrl, '');
    logoBadge.replaceChildren();
    if (safeLogoUrl) {
      const logo = document.createElement('img');
      logo.src = safeLogoUrl;
      logo.alt = `${restaurant.name || 'Restaurante'} logo`;
      logo.className = 'h-full w-full rounded-xl object-contain';
      logoBadge.appendChild(logo);
    } else {
      logoBadge.textContent = '🍽️';
    }
  }

  const subtitleEl = document.getElementById('menuRestaurantSubtitle');
  if (subtitleEl && restaurant.name) {
    if (templateId === 'NEON_BURGER') {
      subtitleEl.textContent = `${restaurant.name} // STREET FOOD & CRAFT BEER`;
    } else if (templateId === 'COASTAL_BEACH') {
      subtitleEl.textContent = `${restaurant.name} • Selección costera de la casa`;
    } else if (templateId === 'MINIMAL_BISTRO') {
      subtitleEl.textContent = `${restaurant.name} • Specialty Roasters & Bakery`;
    } else if (templateId === 'FAUNO_NIGHT') {
      subtitleEl.textContent = `${restaurant.name} • Mitología cervecera`;
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

  // C02: sección "Platos estrella" eliminada del inicio (sin carrusel sustituto).
  // La carta completa (modal) y sus insignias por plato siguen intactas.
  // (Bloque de story cards removido; ver historial git.)

  // E19: selector de categoría combinable con la preferencia dietaria. Las
  // pills de navegación por scroll se conservan; el select filtra sin
  // depender de scroll y se puede probar de forma determinística.
  const categorySelect = document.getElementById('menuCategoryFilterSelect');
  if (categorySelect) {
    const optionsHtml = ['<option value="ALL">Todas las categorías</option>'].concat(
      categories.map((cat, idx) => `<option value="dynamic-cat-${idx}">${escapeHtml(cat.name)}</option>`)
    ).join('');
    if (categorySelect.dataset.e19Options !== optionsHtml) {
      categorySelect.innerHTML = optionsHtml;
      categorySelect.dataset.e19Options = optionsHtml;
    }
  }
  syncMenuFilterControls();
  bindMenuFilterControls();

  // 3. Render Modal Menu Categories & Food Items by Template
  const menuContainer = el.dynamicMenuCategoriesContainer || document.getElementById('dynamicMenuCategoriesContainer');
  if (menuContainer) {
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const totalItems = categories.reduce((sum, cat) => sum + (Array.isArray(cat.items) ? cat.items.length : 0), 0);
    const filteredCategories = categories
      .map((cat, idx) => ({ cat, idx }))
      .filter(({ idx }) => dishMatchesCategoryFilter(`dynamic-cat-${idx}`, menuCategoryFilter))
      .map(({ cat, idx }) => ({
        cat,
        idx,
        visibleItems: (Array.isArray(cat.items) ? cat.items : []).filter((item) => dishMatchesDietFilter(item, menuDietFilter))
      }));
    const visibleCount = filteredCategories.reduce((sum, entry) => sum + entry.visibleItems.length, 0);

    if (visibleCount === 0) {
      menuContainer.innerHTML = `<div class="space-y-2 py-8 text-center"><p id="menuFilterEmpty" role="status" aria-live="polite" class="text-xs font-bold text-slate-200">Sin platos para esta combinación. Probá con Todas o limpiá los filtros.</p><p class="text-[11px] leading-relaxed text-slate-400">${escapeHtml(MENU_DIET_BAR_NOTICE)}</p></div>`;
    } else {
    menuContainer.innerHTML = filteredCategories.map(({ cat, idx, visibleItems }) => {
      const itemsHtml = visibleItems.map(item => {
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
        const dishActionAttrs = `role="button" tabindex="0" aria-label="${escapeHtmlAttr(`Ver detalle de ${item.name}${item.isAvailable === false ? ' (no disponible)' : ''}`)}"`;
        const rowActionLabel = item.isAvailable === false ? 'No disponible' : 'Ver detalle →';

        const safeImgUrl = item.imageUrl ? sanitizeUrl(item.imageUrl) : '';
        const imageHtml = safeImgUrl ? `
          <div class="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-950 shrink-0 border border-slate-800 shadow-md">
            <img src="${safeImgUrl}" alt="${safeAlt}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
        ` : '';

        if (templateId === 'NEON_BURGER') {
          return `
            <div data-dish-id="${safeDishId}" data-category="dynamic-cat-${idx}" ${dishActionAttrs} class="card-dish-row neon-card-street p-4 rounded-3xl cursor-pointer active:scale-[0.98] transition-all group relative overflow-hidden shadow-xl ${item.isAvailable ? '' : 'opacity-50'} focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400">
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
                      <span class="row-action-label text-[10px] font-black text-lime-300 shrink-0">${rowActionLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else if (templateId === 'COASTAL_BEACH') {
          return `
            <div data-dish-id="${safeDishId}" data-category="dynamic-cat-${idx}" ${dishActionAttrs} class="card-dish-row coastal-card-marine p-4 rounded-3xl cursor-pointer active:scale-[0.98] transition-all group shadow-xl ${item.isAvailable ? '' : 'opacity-50'} focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
              <div class="flex items-start gap-3.5">
                ${imageHtml}
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                  <div>
                    <h5 class="font-heading font-black text-sm sm:text-base text-cyan-100 group-hover:text-cyan-300 transition-colors leading-snug">${safeName}</h5>
                    <p class="text-xs text-slate-300 font-normal leading-relaxed mt-1 line-clamp-2">${safeDesc || 'Especialidad fresca de la casa.'}</p>
                  </div>
                  <div class="flex items-center justify-between gap-2 pt-2.5 mt-auto">
                    <span class="font-mono font-black text-xs text-cyan-300 bg-slate-950/90 px-2.5 py-1 rounded-xl border border-cyan-500/40 shadow-md">${formattedPrice}</span>
                    <div class="flex items-center gap-1.5 flex-wrap justify-end">
                      ${item.isFeatured ? '<span class="coastal-seal-badge text-[9px] px-2 py-0.5 rounded-full font-bold">⚓ Fresco</span>' : ''}
                      ${tagsHtml}
                      <span class="row-action-label text-[10px] font-black text-cyan-300 shrink-0">${rowActionLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else if (templateId === 'MINIMAL_BISTRO') {
          return `
            <div data-dish-id="${safeDishId}" data-category="dynamic-cat-${idx}" ${dishActionAttrs} class="card-dish-row p-4 rounded-3xl bg-neutral-900/90 hover:bg-neutral-850 border border-neutral-800 cursor-pointer active:scale-[0.98] transition-all group shadow-xl ${item.isAvailable ? '' : 'opacity-50'} focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
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
                      <span class="row-action-label text-[10px] font-bold text-neutral-300 shrink-0">${rowActionLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        } else {
          // GOURMET_OBSIDIAN (Default)
          return `
            <div data-dish-id="${safeDishId}" data-category="dynamic-cat-${idx}" ${dishActionAttrs} class="card-dish-row p-4 rounded-3xl bg-slate-900/95 hover:bg-slate-850 border border-amber-500/30 cursor-pointer active:scale-[0.98] transition-all group shadow-xl shadow-amber-950/20 ${item.isAvailable ? '' : 'opacity-50'} focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
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
                      <span class="row-action-label text-[10px] font-black text-amber-300 shrink-0">${rowActionLabel}</span>
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

    // Attach mouse and keyboard listeners to row items.
    menuContainer.querySelectorAll('.card-dish-row').forEach(row => {
      const dishId = row.getAttribute('data-dish-id');
      const dish = allItems.find(i => i.id === dishId);
      if (dish) bindDishCardActivation(row, dish);
      // C03: foto rota = se oculta su marco (sin huecos rotos; sin URL no hay marco).
      row.querySelectorAll('img').forEach(img => {
        img.addEventListener('error', () => {
          const frame = img.closest('div');
          if (frame) frame.style.display = 'none';
        });
      });
    });
    } // E19: cierra la rama con resultados (la rama vacía usa menuFilterEmpty).
    // E19: cantidad/estado anunciado para lector de pantalla.
    updateMenuFilterStatus(visibleCount, totalItems);
  }
}

function getCallTypeLabel(call) {
  if (call.type === 'BILL') {
    return `Cuenta • ${getPaymentMethodLabel(call.paymentMethod)}`;
  }
  if (call.type === 'WAITER') return call.note ? `Mozo • ${call.note}` : 'Mozo a la mesa';
  if (call.type === 'SUPPLIES') return `Insumos • ${call.note || 'Solicitados'}`;
  return call.note ? `Solicitud • ${call.note}` : 'Llamado a la mesa';
}

function getPaymentMethodLabel(method) {
  const payMap = {
    MERCADO_PAGO: 'Mercado Pago / QR',
    CARD: 'Tarjeta (sin especificar)',
    CARD_DEBIT: 'Tarjeta de débito',
    CARD_CREDIT: 'Tarjeta de crédito',
    CASH: 'Efectivo'
  };
  return payMap[method] || 'medio no informado';
}

function getCallStatusLabel(call) {
  if (call.type === 'BILL') {
    return call.status === 'IN_PROGRESS'
      ? `En atención: el mozo recibió la cuenta · ${getPaymentMethodLabel(call.paymentMethod)}`
      : `Pendiente: mozo notificado · ${getPaymentMethodLabel(call.paymentMethod)}`;
  }
  return call.status === 'IN_PROGRESS'
    ? 'En atención: el mozo tomó el pedido'
    : 'Pendiente: el mozo recibió la solicitud';
}

function renderActiveCalls(calls) {
  const nextCalls = Array.isArray(calls) ? calls.filter((call) => call && call.id) : [];
  activeCalls = nextCalls;
  activeCall = nextCalls[0] || null;
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  if (!el.activeCallCard || !el.activeCallList) return;

  if (nextCalls.length === 0) {
    el.activeCallList.innerHTML = '';
    el.activeCallCard.classList.add('hidden');
    return;
  }

  el.activeCallCard.classList.remove('hidden');
  if (el.activeCallTitle) el.activeCallTitle.textContent = nextCalls.length === 1 ? 'Solicitud enviada' : 'Solicitudes enviadas';
  if (el.activeCallSubtitle) el.activeCallSubtitle.textContent = 'El estado de cada motivo se actualiza automáticamente';
  if (el.activeCallBadge) {
    el.activeCallBadge.textContent = `${nextCalls.length} activa${nextCalls.length > 1 ? 's' : ''}`;
    el.activeCallBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30';
  }

  el.activeCallList.innerHTML = nextCalls.map((call) => {
    const inProgress = call.status === 'IN_PROGRESS';
    const statusClass = inProgress
      ? 'border-emerald-500/35 bg-emerald-950/20'
      : 'border-amber-500/30 bg-slate-950/70';
    const badgeClass = inProgress
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-amber-500/15 text-amber-200 border-amber-500/30';
    return `
      <article data-active-call-id="${escapeHtmlAttr(call.id)}" class="rounded-xl border p-2.5 space-y-2 ${statusClass}" aria-live="polite">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-bold text-white break-words">${escapeHtml(getCallTypeLabel(call))}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(getCallStatusLabel(call))}</p>
            ${call.type === 'BILL' ? `<p class="mt-1 text-[10px] font-bold text-emerald-300">Medio solicitado: ${escapeHtml(getPaymentMethodLabel(call.paymentMethod))}</p>${Number(call.tipMinor || 0) > 0 ? `<p class="mt-1 text-[10px] font-bold text-indigo-300">Propina elegida: ${escapeHtml(formatMinorAmount(call.tipMinor))} · se suma al cobro</p>` : ''}` : ''}
          </div>
          <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass}">${inProgress ? 'En atención' : 'Pendiente'}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>Tiempo desde el pedido</span>
          <time data-call-timer data-call-created-at="${escapeHtmlAttr(call.createdAt)}" class="font-mono font-bold text-amber-300">0:00</time>
        </div>
        <button type="button" data-cancel-call="${escapeHtmlAttr(call.id)}" class="w-full min-h-[36px] py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300 active:scale-[0.98] transition-transform">✓ Ya fui atendido / Cancelar</button>
      </article>
    `;
  }).join('');

  el.activeCallList.querySelectorAll('[data-cancel-call]').forEach((button) => {
    button.addEventListener('click', () => cancelCallById(button.getAttribute('data-cancel-call')));
  });
  updateRenderedCallTimers();
  callTimerInterval = setInterval(updateRenderedCallTimers, 1000);
}

// Compatibilidad con cualquier integración anterior que entregue un solo llamado.
function renderActiveCall(call) {
  renderActiveCalls(call ? [call] : []);
}

function updateCallTimer(isoCreatedAt, target) {
  const timer = target || el.activeCallTimer;
  if (!timer) return;
  const created = new Date(isoCreatedAt).getTime();
  const now = Date.now();
  const diffSecs = Math.max(0, Math.floor((now - created) / 1000));

  const mins = Math.floor(diffSecs / 60);
  const secs = diffSecs % 60;
  timer.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateRenderedCallTimers() {
  if (!el.activeCallList) return;
  el.activeCallList.querySelectorAll('[data-call-timer]').forEach((timer) => {
    updateCallTimer(timer.getAttribute('data-call-created-at'), timer);
  });
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
    ...(type === 'BILL' ? { tipMinor: getSelectedTipMinor() } : {}),
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
        showToast(data.error || 'Pagos digitales no disponibles en esta instalación. El cobro se realiza de forma presencial.', 'warning');
        return;
      }
      if (res.status === 403 || data.code === 'GEOFENCE_EXCEEDED') {
        showToast(data.error || 'No se puede solicitar atención fuera del salón.', 'error');
        return;
      }
      showToast(data.error || 'No se pudo enviar el llamado.', 'error');
      return;
    }

    const callForState = type === 'BILL' && !data.paymentMethod
      ? { ...data, paymentMethod }
      : data;
    renderActiveCalls([...activeCalls.filter((call) => call.id !== data.id), callForState]);
    closeAllModals();
    showToast(type === 'BILL'
      ? `¡Pedido de cuenta enviado! Medio solicitado: ${getPaymentMethodLabel(paymentMethod)}${getSelectedTipMinor() > 0 ? ` · propina incluida: ${formatMinorAmount(getSelectedTipMinor())}` : ''}.`
      : '¡Llamado enviado al mozo!', 'success');
  } catch (err) {
    console.error('Error al enviar llamado:', err);
    showToast('No se pudo conectar con el servidor. Por favor verifica tu conexión.', 'error');
  }
}

async function cancelCallById(callId) {
  if (!callId || !currentToken) return;
  triggerHaptic();

  try {
    const res = await fetchWithRetry(`${API_BASE}/calls/${encodeURIComponent(callId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: currentToken })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      renderActiveCalls(activeCalls.filter((call) => call.id !== callId));
      showToast('Llamado cancelado exitosamente.', 'info');
    } else if (res.status === 404 || res.status === 409) {
      showToast(data.error || 'El llamado cambió de estado. Se actualizó la mesa.', 'warning');
      pollFailures = 0;
      scheduleNextPoll(0);
    } else {
      showToast(data.error || 'No se pudo cancelar el llamado.', 'error');
    }
  } catch (err) {
    console.error('Error al cancelar llamado:', err);
    showToast('No se pudo cancelar el llamado.', 'error');
  }
}

async function cancelActiveCall() {
  await cancelCallById(activeCall?.id);
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
    markOnline();
    pollFailures = 0; // Reset backoff tras éxito

    if (data.valid) {
      const nextActiveCalls = Array.isArray(data.activeCalls)
        ? data.activeCalls
        : (data.activeCall ? [data.activeCall] : []);
      renderActiveCalls(nextActiveCalls);
      if (el.modalCart && !el.modalCart.classList.contains('hidden')) loadActiveOrder({ silent: true });
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
    if (isLikelyNetworkError(err)) markOffline();
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
  window.addEventListener('offline', () => {
    markOffline();
    if (currentToken && !isPollingBusy) scheduleNextPoll(10000);
  });

  window.addEventListener('online', () => {
    markOnline();
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

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (currentToken) scheduleNextPoll(0);
    else void init();
  });

  window.addEventListener('popstate', () => {
    closeAllModals();
    void init();
  });
}

function closeAllModals({ restoreFocus = true } = {}) {
  const previousSuppress = suppressModalFocusRestore;
  suppressModalFocusRestore = true;
  if (el.modalBill) el.modalBill.classList.add('hidden');
  if (el.modalWaiter) el.modalWaiter.classList.add('hidden');
  if (el.modalSupplies) el.modalSupplies.classList.add('hidden');
  if (el.modalMenu) el.modalMenu.classList.add('hidden');
  if (el.modalCart) el.modalCart.classList.add('hidden');
  const reviewModal = document.getElementById('modalReviewFair');
  if (reviewModal) {
    reviewModal.classList.add('hidden');
    reviewModal.setAttribute('aria-hidden', 'true');
  }
  if (el.btnOpenReviewFromBill) el.btnOpenReviewFromBill.setAttribute('aria-expanded', 'false');
  closeDishDetailSheet();
  closeSommelierDrawer();
  suppressModalFocusRestore = previousSuppress;
  document.body.classList.remove('modal-open');
  if (restoreFocus) restoreModalFocusIfNone();
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
    const trigger = document.activeElement;
    closeAllModals({ restoreFocus: false });
    if (el.modalMenu) {
      rememberModalFocus(trigger);
      el.modalMenu.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalMenu);
    }
  };

  if (el.btnOpenCartHeader) el.btnOpenCartHeader.addEventListener('click', openCartModal);
  if (el.btnOpenMenuHero) el.btnOpenMenuHero.addEventListener('click', openMenuModal);
  if (el.heroMenuCard) el.heroMenuCard.addEventListener('click', (e) => {
    // Avoid double firing if button was clicked
    if (e.target.closest('#btnOpenMenuHero')) return;
    openMenuModal();
  });

  if (el.btnCloseModalMenu) el.btnCloseModalMenu.addEventListener('click', () => {
    closeManagedModal(el.modalMenu);
  });

  if (el.modalMenu) {
    el.modalMenu.addEventListener('click', (e) => {
      if (e.target === el.modalMenu) {
        closeManagedModal(el.modalMenu);
      }
    });
  }

  if (el.btnOrderFromMenu) el.btnOrderFromMenu.addEventListener('click', openCartModal);

  // E19: filtros dietarios + categoría (controles estáticos; opciones y estado
  // se sincronizan en cada renderDynamicMenu sin perder la selección).
  bindMenuFilterControls();
  syncMenuFilterControls();

  if (el.btnCloseModalCart) el.btnCloseModalCart.addEventListener('click', () => {
    closeCartModal();
  });

  if (el.modalCart) {
    el.modalCart.addEventListener('click', (event) => {
      if (event.target === el.modalCart) {
        closeCartModal();
      }
    });
  }

  if (el.btnSubmitCart) el.btnSubmitCart.addEventListener('click', submitCart);
  if (el.btnCartCallWaiter) el.btnCartCallWaiter.addEventListener('click', () => {
    const trigger = document.activeElement;
    closeAllModals({ restoreFocus: false });
    if (el.modalWaiter) {
      rememberModalFocus(trigger);
      el.modalWaiter.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalWaiter);
    }
  });

async function loadBillDetails() {
  if (!currentToken) return;
  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/session/${encodeURIComponent(currentToken)}`);
    if (res && res.ok) {
      const data = await res.json();
      // C06: la cuenta visible debe venir de la proyección contable de la sesión.
      // No usar la respuesta parcial del borrador/última tanda como fallback.
      const account = data && data.account;
      if (!account || !Array.isArray(account.tandas)) {
        throw new Error('La respuesta no incluye la cuenta acumulada de la sesión');
      }
      const tandas = account.tandas;
      const items = tandas.flatMap((round, roundIndex) => {
        const roundItems = Array.isArray(round.items) ? round.items : [];
        return roundItems.map((item) => ({ ...item, round, roundIndex }));
      });
      const consumoMinor = Number.isFinite(Number(account.consumoMinor)) ? Number(account.consumoMinor) : 0;
      const paidMinor = Number.isFinite(Number(account.paidMinor)) ? Number(account.paidMinor) : 0;
      const tipMinor = Number.isFinite(Number(account.tipMinor)) ? Number(account.tipMinor) : 0;
      const saldoMinor = Number.isFinite(Number(account.saldoMinor)) ? Number(account.saldoMinor) : 0;
      currentBillConsumptionMinor = Math.max(0, Math.round(consumoMinor));
      currentBillBalanceMinor = Math.max(0, Math.round(saldoMinor));
      const pendingValidation = Array.isArray(account.pendingValidation) ? account.pendingValidation : [];
      const draft = account.draft || null;

      if (el.modalBillTotal) {
        el.modalBillTotal.textContent = formatMinorAmount(consumoMinor);
      }
      if (el.modalBillStatusText) {
        el.modalBillStatusText.textContent = tandas.length > 0
          ? `${tandas.length} tanda${tandas.length > 1 ? 's' : ''} incluida${tandas.length > 1 ? 's' : ''} · ${items.length} ítem${items.length !== 1 ? 's' : ''}`
          : 'Todavía no hay consumo aceptado en la mesa';
      }
      if (el.modalBillPaid) el.modalBillPaid.textContent = formatMinorAmount(paidMinor);
      if (el.modalBillTip) el.modalBillTip.textContent = formatMinorAmount(tipMinor);
      if (el.modalBillBalance) el.modalBillBalance.textContent = formatMinorAmount(saldoMinor);
      updateBillTipSummary();
      if (el.modalBillPending) {
        const notices = [];
        if (pendingValidation.length > 0) {
          notices.push(`${pendingValidation.length} tanda${pendingValidation.length > 1 ? 's' : ''} espera${pendingValidation.length > 1 ? 'n' : ''} confirmación del mozo y todavía no integra${pendingValidation.length > 1 ? 'n' : ''} el consumo.`);
        }
        if (draft) {
          notices.push('Tu borrador todavía no forma parte de esta cuenta.');
        }
        el.modalBillPending.textContent = notices.length
          ? notices.join(' ')
          : 'La cuenta muestra solo tandas aceptadas. El mozo confirma el importe final en la mesa.';
        el.modalBillPending.classList.remove('hidden');
      }

      if (el.modalBillItemsList && el.modalBillNoItems) {
        if (items.length > 0) {
          let lastRoundIndex = -1;
          el.modalBillItemsList.innerHTML = items.map(item => {
            const roundHeading = item.roundIndex !== lastRoundIndex
              ? `<div class="flex items-center justify-between gap-2 pt-2 first:pt-0 text-[10px] font-black uppercase tracking-wider text-slate-500"><span>Tanda ${item.roundIndex + 1} · ${escapeHtml(orderHistoryStatus(item.round.status, item.round.cancellationReason))}</span><span>${formatMinorAmount(item.round.totalMinor)}</span></div>`
              : '';
            lastRoundIndex = item.roundIndex;
            return `${roundHeading}
              <div class="flex justify-between items-start gap-2 py-1.5 text-slate-300">
                <span class="min-w-0 break-words"><strong class="text-white">${escapeHtml(item.quantity)}x</strong> ${escapeHtml(item.name)}</span>
                <span class="font-semibold text-white shrink-0">${formatMinorAmount(item.lineTotalMinor)}</span>
              </div>`;
          }).join('');
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
    }
  } catch (err) {
    console.warn('Error al cargar comanda de la sesión:', err);
    if (el.modalBillTotal) el.modalBillTotal.textContent = '$0';
    if (el.modalBillPaid) el.modalBillPaid.textContent = '$0';
    if (el.modalBillTip) el.modalBillTip.textContent = '$0';
    if (el.modalBillRequestedTip) el.modalBillRequestedTip.textContent = '$0';
    if (el.modalBillBalance) el.modalBillBalance.textContent = '$0';
    if (el.modalBillPayableTotal) el.modalBillPayableTotal.textContent = '$0';
    currentBillConsumptionMinor = 0;
    currentBillBalanceMinor = 0;
    if (el.modalBillPending) {
      el.modalBillPending.textContent = 'No se pudo actualizar la cuenta acumulada. Cerrá y volvé a abrir para reintentar.';
      el.modalBillPending.classList.remove('hidden');
    }
    if (el.modalBillStatusText) el.modalBillStatusText.textContent = 'Cuenta no disponible por el momento';
    if (el.modalBillItemsList) el.modalBillItemsList.innerHTML = '';
    if (el.modalBillNoItems) {
      el.modalBillNoItems.textContent = 'No se pudo cargar el consumo acumulado.';
      el.modalBillNoItems.classList.remove('hidden');
    }
    if (el.modalBillItemCount) el.modalBillItemCount.classList.add('hidden');
  }
}

  // Action: Pedir Cuenta
  if (el.btnActionBill) el.btnActionBill.addEventListener('click', () => {
    const trigger = document.activeElement;
    closeAllModals({ restoreFocus: false });
    if (el.modalBill) {
      rememberModalFocus(trigger);
      loadBillDetails();
      el.modalBill.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalBill);
    }
  });

  if (el.btnToggleBillDetails && el.modalBillItemsContainer) {
    el.btnToggleBillDetails.addEventListener('click', () => {
      const isHidden = el.modalBillItemsContainer.classList.contains('hidden');
      if (isHidden) {
        el.modalBillItemsContainer.classList.remove('hidden');
        el.btnToggleBillDetails.setAttribute('aria-expanded', 'true');
        if (el.accordionArrow) el.accordionArrow.style.transform = 'rotate(180deg)';
      } else {
        el.modalBillItemsContainer.classList.add('hidden');
        el.btnToggleBillDetails.setAttribute('aria-expanded', 'false');
        if (el.accordionArrow) el.accordionArrow.style.transform = 'rotate(0deg)';
      }
    });
  }

  if (el.btnCloseModalBill) el.btnCloseModalBill.addEventListener('click', () => {
    closeManagedModal(el.modalBill);
  });

  if (el.modalBill) {
    el.modalBill.addEventListener('click', (e) => {
      if (e.target === el.modalBill) {
        closeManagedModal(el.modalBill);
      }
    });
  }

  document.querySelectorAll('.btn-pay-method').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const method = btn.getAttribute('data-method');
      btn.disabled = true;
      try {
        // Evita enviar un porcentaje calculado sobre un saldo viejo si el
        // cliente toca el medio apenas abre el modal.
        await loadBillDetails();
        const tipNote = getSelectedTipMinor() > 0
          ? `Propina elegida: ${getSelectedTipLabel()}`
          : 'Sin propina elegida';
        await sendCall('BILL', method, tipNote);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Action: Llamar Mozo
  if (el.btnActionWaiter) el.btnActionWaiter.addEventListener('click', () => {
    const trigger = document.activeElement;
    closeAllModals({ restoreFocus: false });
    if (el.modalWaiter) {
      rememberModalFocus(trigger);
      el.modalWaiter.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalWaiter);
    }
  });

  if (el.btnCloseModalWaiter) el.btnCloseModalWaiter.addEventListener('click', () => {
    closeManagedModal(el.modalWaiter);
  });

  if (el.modalWaiter) {
    el.modalWaiter.addEventListener('click', (e) => {
      if (e.target === el.modalWaiter) {
        closeManagedModal(el.modalWaiter);
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
    const trigger = document.activeElement;
    closeAllModals({ restoreFocus: false });
    if (el.modalSupplies) {
      rememberModalFocus(trigger);
      el.modalSupplies.classList.remove('hidden');
      document.body.classList.add('modal-open');
      focusManagedModal(el.modalSupplies);
    }
  });

  if (el.btnCloseModalSupplies) el.btnCloseModalSupplies.addEventListener('click', () => {
    closeManagedModal(el.modalSupplies);
  });

  if (el.modalSupplies) {
    el.modalSupplies.addEventListener('click', (e) => {
      if (e.target === el.modalSupplies) {
        closeManagedModal(el.modalSupplies);
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
  if (el.btnDishOrderQuantityMinus) {
    el.btnDishOrderQuantityMinus.addEventListener('click', () => {
      triggerHaptic();
      setDishOrderQuantity(Number(el.dishOrderQuantity?.value || 1) - 1);
    });
  }
  if (el.btnDishOrderQuantityPlus) {
    el.btnDishOrderQuantityPlus.addEventListener('click', () => {
      triggerHaptic();
      setDishOrderQuantity(Number(el.dishOrderQuantity?.value || 1) + 1);
    });
  }
  if (btnOrderSpecificDish) {
    btnOrderSpecificDish.addEventListener('click', () => {
      if (selectedDishForOrder) {
        const dish = selectedDishForOrder;
        const dishName = dish.name;
        const quantity = setDishOrderQuantity(el.dishOrderQuantity?.value);
        const notes = document.getElementById('dishOrderNote')?.value?.trim() || '';
        const guestNameVal = document.getElementById('dishOrderGuestName')?.value?.trim() || '';
        if (guestNameVal) setGuestName(guestNameVal);
        // No cerrar antes de validar: dejamos el sheet abierto si hay error de disponibilidad
        if (activeRestaurantConfig && activeRestaurantConfig.allowOrdering === false) {
          closeDishDetailSheet();
          closeAllModals();
          showToast('Comandas digitales desactivadas. Solicitud enviada al personal.', 'info');
          sendCall('WAITER', 'NOT_APPLICABLE', `Pedido: ${dishName}${guestNameVal ? ` — ${guestNameVal}` : ''}`);
        } else {
          addDishToCart(dish, quantity, notes);
        }
      }
    });
  }
  const dishGuestNameInput = document.getElementById('dishOrderGuestName');
  if (dishGuestNameInput) {
    dishGuestNameInput.addEventListener('change', () => setGuestName(dishGuestNameInput.value));
    dishGuestNameInput.addEventListener('blur', () => setGuestName(dishGuestNameInput.value));
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
    // Conservar el token permite recuperar una suspensión o caída de red sin
    // convertir el reintento en un callejón sin salida para QR por token.
    void init();
  });
}

function openSommelierDrawer(trigger = document.activeElement) {
  triggerHaptic();
  const drawer = document.getElementById('sommelierSheetBackdrop');
  if (drawer) {
    rememberModalFocus(trigger);
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('inert');
    drawer.classList.add('active');
    document.body.classList.add('modal-open');
    focusManagedModal(drawer);
  }
}

function closeSommelierDrawer() {
  const drawer = document.getElementById('sommelierSheetBackdrop');
  if (drawer) {
    drawer.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
  }
  if (!hasOpenManagedModal()) {
    document.body.classList.remove('modal-open');
  }
  restoreModalFocusIfNone();
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
    const slug = currentSession?.restaurant?.slug;
    if (!slug || !currentToken) {
      loadingBubble.remove();
      throw new Error('La sesión no tiene un restaurante válido para consultar el Sommelier.');
    }
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
let selectedTipPercentage = 0;
let selectedRating = 0;
let selectedTipAmount = 0;
let currentBillConsumptionMinor = 0;
let currentBillBalanceMinor = 0;
let ratingSubmittedForSession = false;

function getSelectedTipMinor() {
  if (selectedTipAmount > 0) return Math.max(0, Math.round(Number(selectedTipAmount) * 100));
  if (selectedTipPercentage > 0) return Math.max(0, Math.round(currentBillConsumptionMinor * selectedTipPercentage / 100));
  return 0;
}

function getSelectedTipLabel() {
  const tipMinor = getSelectedTipMinor();
  if (selectedTipAmount > 0) return formatMinorAmount(tipMinor);
  if (selectedTipPercentage > 0) return `${selectedTipPercentage}% · ${formatMinorAmount(tipMinor)}`;
  return '$0';
}

function updateBillTipSummary() {
  const tipMinor = getSelectedTipMinor();
  const payableTotalMinor = Math.max(0, currentBillBalanceMinor + tipMinor);
  if (el.modalBillRequestedTip) el.modalBillRequestedTip.textContent = formatMinorAmount(tipMinor);
  if (el.modalBillPayableTotal) el.modalBillPayableTotal.textContent = formatMinorAmount(payableTotalMinor);
  const tipSelectedText = document.getElementById('tipSelectedAmount');
  if (tipSelectedText) tipSelectedText.textContent = getSelectedTipLabel();
  if (el.billTipSelection) {
    const hasTip = tipMinor > 0 || selectedTipPercentage > 0 || selectedTipAmount > 0;
    const tipText = hasTip
      ? `Propina seleccionada: ${getSelectedTipLabel()}. Se suma al total: ${formatMinorAmount(payableTotalMinor)}.`
      : 'Podés dejar una propina opcional y una valoración. La propina elegida se suma al total que cobrará el mozo.';
    const ratingText = selectedRating > 0 ? ` Valoración elegida: ${selectedRating}/5.` : '';
    el.billTipSelection.textContent = `${tipText}${ratingText}`;
  }
  if (el.btnOpenReviewFromBill) {
    const hasSelection = selectedTipAmount > 0 || selectedTipPercentage > 0 || selectedRating > 0;
    el.btnOpenReviewFromBill.textContent = hasSelection ? 'Editar →' : 'Elegir →';
    const reviewModal = document.getElementById('modalReviewFair');
    el.btnOpenReviewFromBill.setAttribute(
      'aria-expanded',
      reviewModal && !reviewModal.classList.contains('hidden') ? 'true' : 'false'
    );
  }
}

async function loadRestaurantModuleConfig(slug) {
  try {
    const res = await fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(slug)}/config`);
    if (!res.ok) return;
    const config = await res.json();
    activeRestaurantConfig = config;
    activeOrderPolicy = {
      allowOrdering: !staticMenuOnly && config.allowOrdering !== false,
      requireWaiterValidation: config.requireWaiterValidation === true
    };
    // QR es una preferencia de cobro que se informa al mozo. No representa
    // una integración digital ni debe desaparecer cuando el local cobra de
    // forma presencial (el cobro real se registra luego en el panel del staff).
    renderCart();

    // Adaptar textos y acciones según allowOrdering (Comandas Digitales vs Modo Carta Informativa)
    if (staticMenuOnly || config.allowOrdering === false) {
      if (el.btnOrderFromMenu) {
        el.btnOrderFromMenu.innerHTML = '<span>📖 Modo Carta • Llamar al Mozo</span>';
      }
      const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
      if (orderSpecificBtn) {
        orderSpecificBtn.innerHTML = '<span>🛎️ Solicitar plato al Mozo (Modo Carta)</span>';
      }
    } else {
      if (el.btnOrderFromMenu) {
        el.btnOrderFromMenu.innerHTML = '<span>🛒 Ver carrito colaborativo</span>';
      }
      const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
      if (orderSpecificBtn) {
        orderSpecificBtn.innerHTML = '<span>🛒 Agregar al carrito</span>';
      }
    }

    // Apply Google Review Deep Link only when the instance supplied a valid Place ID.
    const reviewBtn = document.getElementById('btnGoogleReviewDeepLink');
    if (reviewBtn) {
      const safePlaceId = sanitizeGooglePlaceId(config.googlePlaceId);
      if (safePlaceId) {
        reviewBtn.href = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(safePlaceId)}`;
        reviewBtn.classList.remove('hidden', 'pointer-events-none', 'opacity-50');
      } else {
        reviewBtn.removeAttribute('href');
        reviewBtn.classList.add('hidden');
      }
    }

    const reviewOptions = document.getElementById('reviewOptions');
    const internalRatingSection = document.getElementById('internalRatingSection');
    if (config.enableReviews === false) {
      reviewOptions?.classList.add('hidden');
      internalRatingSection?.classList.add('hidden');
    } else {
      reviewOptions?.classList.remove('hidden');
      internalRatingSection?.classList.remove('hidden');
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
    const percentages = Array.isArray(config.suggestedTipPercentages)
      ? config.suggestedTipPercentages.filter((value) => Number.isInteger(value) && value >= 0 && value <= 100).slice(0, 5)
      : [10, 15, 20];
    const tipOptions = document.getElementById('tipOptionsContainer');
    if (tipOptions && percentages.length > 0) {
      tipOptions.innerHTML = [0, ...percentages.filter((value) => value !== 0)].map((value, index) => `
        <button data-tip="${value}" class="btn-tip-pill py-2 rounded-xl ${value === selectedTipPercentage || (index === 0 && selectedTipPercentage === 0) ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} font-bold text-xs active:scale-95 transition-all">${value}%</button>
      `).join('');
      bindTipPills();
    }
    updateBillTipSummary();
  } catch (err) {
    console.warn('Error al cargar configuración modular:', err);
  }
}

function bindTipPills() {
  document.querySelectorAll('.btn-tip-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      selectedTipPercentage = Math.max(0, Number(btn.getAttribute('data-tip')) || 0);
      selectedTipAmount = 0;
      const customInput = document.getElementById('tipCustomAmount');
      if (customInput) customInput.value = '';
      document.querySelectorAll('.btn-tip-pill').forEach((b) => {
        b.className = 'btn-tip-pill py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold text-xs active:scale-95 transition-all';
      });
      btn.className = 'btn-tip-pill py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs active:scale-95 transition-all';
      const tipText = document.getElementById('tipSelectedAmount');
      if (tipText) tipText.textContent = getSelectedTipLabel();
      updateBillTipSummary();
    });
  });
}

function openReviewFairModal(trigger = document.activeElement) {
  triggerHaptic();
  const modal = document.getElementById('modalReviewFair');
  if (modal) {
    rememberModalFocus(trigger);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (el.btnOpenReviewFromBill) el.btnOpenReviewFromBill.setAttribute('aria-expanded', 'true');
    document.body.classList.add('modal-open');
    focusManagedModal(modal);
  }
}

function closeReviewFairModal() {
  const modal = document.getElementById('modalReviewFair');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (el.btnOpenReviewFromBill) el.btnOpenReviewFromBill.setAttribute('aria-expanded', 'false');
  if (!hasOpenManagedModal()) {
    document.body.classList.remove('modal-open');
  }
  restoreModalFocusIfNone();
}

async function submitReviewAndReturnToBill() {
  const button = el.btnSubmitReview;
  if (!button || button.disabled) return;

  triggerHaptic();
  const tipLabel = getSelectedTipLabel();

  // La propina queda seleccionada en este paso y se adjunta al llamado BILL
  // cuando el comensal elige efectivo, tarjeta o QR en la cuenta.
  if (!selectedRating || ratingSubmittedForSession) {
    updateBillTipSummary();
    closeReviewFairModal();
    showToast(
      selectedRating
        ? `Valoración ya guardada. La propina ${tipLabel} se sumará al total al elegir el medio de pago.`
        : `Propina ${tipLabel} guardada. Se sumará al total cuando elijas el medio de pago.`,
      'success'
    );
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando valoración…';

  try {
    const res = await fetchWithRetry(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: currentToken,
        rating: selectedRating
      })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok && !(res.status === 409 && data.code === 'FEEDBACK_ALREADY_EXISTS')) {
      throw new Error(data.error || 'Respuesta no válida del servidor');
    }

    ratingSubmittedForSession = true;
    updateBillTipSummary();
    closeReviewFairModal();
    showToast(
      res.status === 409
        ? `La valoración ya estaba guardada. La propina ${tipLabel} se sumará al total al elegir el medio de pago.`
        : `¡Valoración enviada! La propina ${tipLabel} se incluirá en el total a cobrar.`,
      'success'
    );
  } catch (err) {
    console.warn('Error al enviar valoración:', err);
    showToast('No se pudo enviar la valoración. Revisá la conexión e intentá nuevamente.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel || 'Guardar propina y valoración';
  }
}

// Bind review & tipping listeners
function bindReviewFairEvents() {
  const btnCloseModalReview = document.getElementById('btnCloseModalReview');
  if (btnCloseModalReview) {
    btnCloseModalReview.addEventListener('click', closeReviewFairModal);
  }

  // Tip pills and optional free amount
  bindTipPills();
  const customTipInput = document.getElementById('tipCustomAmount');
  if (customTipInput) {
    customTipInput.addEventListener('input', () => {
      selectedTipAmount = Math.max(0, Number(customTipInput.value) || 0);
      if (customTipInput.value.trim() !== '') {
        selectedTipPercentage = 0;
        document.querySelectorAll('.btn-tip-pill').forEach((b) => {
          b.className = 'btn-tip-pill py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold text-xs active:scale-95 transition-all';
        });
      }
      const tipText = document.getElementById('tipSelectedAmount');
      if (tipText) tipText.textContent = getSelectedTipLabel();
      updateBillTipSummary();
    });
  }

  document.querySelectorAll('.btn-rating').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedRating = Math.min(5, Math.max(1, Number(btn.getAttribute('data-rating')) || 5));
      document.querySelectorAll('.btn-rating').forEach((b) => {
        b.className = 'btn-rating p-2 rounded-xl bg-slate-800 text-slate-300';
      });
      btn.className = 'btn-rating p-2 rounded-xl bg-indigo-600 text-white';
      updateBillTipSummary();
    });
  });

  if (el.btnOpenReviewFromBill) {
    el.btnOpenReviewFromBill.addEventListener('click', () => {
      const trigger = document.activeElement;
      openReviewFairModal(trigger);
    });
  }

  if (el.btnSubmitReview) {
    el.btnSubmitReview.addEventListener('click', submitReviewAndReturnToBill);
  }

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
      if (!selectedRating) {
        showToast('Elegí una calificación de 1 a 5 antes de enviar.', 'warning');
        return;
      }

      try {
        const res = await fetchWithRetry(`${API_BASE}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: currentToken,
            rating: selectedRating,
            comment: text
          })
        });

        if (!res.ok) {
          throw new Error('Respuesta no válida del servidor');
        }

        showToast('¡Gracias! Tu mensaje fue enviado directamente al encargado del local.', 'success');
        privateText.value = '';
        ratingSubmittedForSession = true;
        updateBillTipSummary();
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
