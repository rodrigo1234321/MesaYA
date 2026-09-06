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
  btnCloseModalBill: document.getElementById('btnCloseModalBill'),
  billTotalAmountDisplay: document.getElementById('billTotalAmountDisplay'),
  billPaidAmountDisplay: document.getElementById('billPaidAmountDisplay'),
  billRemainingAmountDisplay: document.getElementById('billRemainingAmountDisplay'),
  billStatusBadge: document.getElementById('billStatusBadge'),
  tabBillMyShareBtn: document.getElementById('tabBillMyShareBtn'),
  tabBillEqualSplitBtn: document.getElementById('tabBillEqualSplitBtn'),
  tabBillAllTableBtn: document.getElementById('tabBillAllTableBtn'),
  billTabContentMyShare: document.getElementById('billTabContentMyShare'),
  billTabContentEqualSplit: document.getElementById('billTabContentEqualSplit'),
  billTabContentAllTable: document.getElementById('billTabContentAllTable'),
  myShareSubtotalDisplay: document.getElementById('myShareSubtotalDisplay'),
  billMyParticipantName: document.getElementById('billMyParticipantName'),
  myShareItemsCount: document.getElementById('myShareItemsCount'),
  myShareItemsList: document.getElementById('myShareItemsList'),
  unclaimedItemsList: document.getElementById('unclaimedItemsList'),
  equalSplitPartAmountDisplay: document.getElementById('equalSplitPartAmountDisplay'),
  equalPartsBreakdownList: document.getElementById('equalPartsBreakdownList'),
  allTableItemsList: document.getElementById('allTableItemsList'),
  btnSubmitBillRequest: document.getElementById('btnSubmitBillRequest'),
  btnSubmitBillAmountBadge: document.getElementById('btnSubmitBillAmountBadge'),
  modalWaiter: document.getElementById('modalWaiter'),
  modalSupplies: document.getElementById('modalSupplies'),
  modalMenu: document.getElementById('modalMenu'),
  menuImage: document.getElementById('menuImage'),
  heroCategoryPillsContainer: document.getElementById('heroCategoryPillsContainer'),
  dynamicMenuCategoriesContainer: document.getElementById('dynamicMenuCategoriesContainer'),
  btnCloseModalWaiter: document.getElementById('btnCloseModalWaiter'),
  btnCloseModalSupplies: document.getElementById('btnCloseModalSupplies'),
  btnCloseModalMenu: document.getElementById('btnCloseModalMenu'),
  btnOrderFromMenu: document.getElementById('btnOrderFromMenu'),
  customSupplyNote: document.getElementById('customSupplyNote'),
  btnSubmitCustomSupply: document.getElementById('btnSubmitCustomSupply'),
  btnParticipantBadge: document.getElementById('btnParticipantBadge'),
  participantDisplayNameText: document.getElementById('participantDisplayNameText'),
  modalParticipant: document.getElementById('modalParticipant'),
  inputParticipantName: document.getElementById('inputParticipantName'),
  btnSaveParticipant: document.getElementById('btnSaveParticipant'),
  btnCloseModalParticipant: document.getElementById('btnCloseModalParticipant'),
  dishSheetQty: document.getElementById('dishSheetQty'),
  btnDishQtyMinus: document.getElementById('btnDishQtyMinus'),
  btnDishQtyPlus: document.getElementById('btnDishQtyPlus'),
  dishSheetNotes: document.getElementById('dishSheetNotes'),
  btnAddToTanda: document.getElementById('btnAddToTanda'),
  floatingCartBar: document.getElementById('floatingCartBar'),
  cartItemCountBadge: document.getElementById('cartItemCountBadge'),
  cartAuthorSubtitle: document.getElementById('cartAuthorSubtitle'),
  cartEstimatedTotal: document.getElementById('cartEstimatedTotal'),
  modalCartSheet: document.getElementById('modalCartSheet'),
  btnCloseCartSheet: document.getElementById('btnCloseCartSheet'),
  tabCartDraftBtn: document.getElementById('tabCartDraftBtn'),
  tabTandasTrackingBtn: document.getElementById('tabTandasTrackingBtn'),
  tabCartDraftCount: document.getElementById('tabCartDraftCount'),
  tabTandasBadge: document.getElementById('tabTandasBadge'),
  viewCartDraft: document.getElementById('viewCartDraft'),
  viewTandasTracking: document.getElementById('viewTandasTracking'),
  cartParticipantNameDisplay: document.getElementById('cartParticipantNameDisplay'),
  btnChangeParticipantFromCart: document.getElementById('btnChangeParticipantFromCart'),
  cartDraftItemsContainer: document.getElementById('cartDraftItemsContainer'),
  cartDraftEmptyNotice: document.getElementById('cartDraftEmptyNotice'),
  cartDraftFooter: document.getElementById('cartDraftFooter'),
  inputTandaNotes: document.getElementById('inputTandaNotes'),
  cartDraftTotalEstimate: document.getElementById('cartDraftTotalEstimate'),
  btnSubmitTanda: document.getElementById('btnSubmitTanda'),
  btnRefreshTandas: document.getElementById('btnRefreshTandas'),
  tandasTrackingListContainer: document.getElementById('tandasTrackingListContainer'),
  tandasTrackingEmptyNotice: document.getElementById('tandasTrackingEmptyNotice'),
  btnOpenCartFromMenu: document.getElementById('btnOpenCartFromMenu'),
  menuCartCountBadge: document.getElementById('menuCartCountBadge')
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

    initParticipantSession(data.token);
    loadDraftCart();

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

  if (imgEl) {
    const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
    imgEl.src = sanitizeUrl(item.imageUrl, defaultImg);
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

  currentDishQty = 1;
  if (el.dishSheetQty) el.dishSheetQty.textContent = '1';
  if (el.dishSheetNotes) el.dishSheetNotes.value = '';

  sheet.classList.add('active');
  document.body.classList.add('modal-open');
}

function closeDishDetailSheet() {
  const sheet = document.getElementById('dishDetailSheetBackdrop');
  if (sheet) sheet.classList.remove('active');
  selectedDishForOrder = null;
  
  // Only remove modal-open if no other drawer or modal is active
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden), #modalParticipant:not(.hidden)');
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

// ==========================================
// PARTICIPANTES Y TANDAS DE MESA (Etapa 05)
// ==========================================
let currentParticipantToken = null;
let currentParticipantId = null;
let currentParticipantDisplayName = null;
let draftCart = [];
let currentDishQty = 1;
let isSubmittingTanda = false;
let tandasPollTimer = null;

function getParticipantStorageKey(token) {
  return `mesaya_participant_${token || 'anon'}`;
}

function getDraftCartStorageKey(token, participantId) {
  return `mesaya_draft_cart_${token || 'anon'}_${participantId || 'anon'}`;
}

function initParticipantSession(tableToken) {
  if (!tableToken) return;
  const key = getParticipantStorageKey(tableToken);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      currentParticipantToken = parsed.token || null;
      currentParticipantId = parsed.id || null;
      currentParticipantDisplayName = parsed.displayName || null;
    }
  } catch (_) {}

  updateParticipantUI();
}

function updateParticipantUI() {
  const name = currentParticipantDisplayName;
  if (el.participantDisplayNameText) {
    el.participantDisplayNameText.textContent = name ? name : 'Unirme';
  }
  if (el.cartParticipantNameDisplay) {
    el.cartParticipantNameDisplay.textContent = name ? name : 'Sin identificar';
  }
  if (el.cartAuthorSubtitle) {
    el.cartAuthorSubtitle.textContent = name ? `Pedido de ${name}` : 'Toca para revisar y enviar';
  }
}

function openParticipantModal() {
  triggerHaptic();
  closeAllModals();
  if (el.modalParticipant) {
    if (el.inputParticipantName) {
      el.inputParticipantName.value = currentParticipantDisplayName || '';
    }
    el.modalParticipant.classList.remove('hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => el.inputParticipantName?.focus(), 150);
  }
}

function closeParticipantModal() {
  if (el.modalParticipant) el.modalParticipant.classList.add('hidden');
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden)');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

async function handleSaveParticipant() {
  const input = el.inputParticipantName;
  if (!input) return;
  const rawName = input.value.trim();
  if (!rawName) {
    showToast('Por favor ingresá tu nombre o apodo.', 'warning');
    input.focus();
    return;
  }
  if (rawName.length > 40) {
    showToast('El nombre no puede superar los 40 caracteres.', 'warning');
    return;
  }

  const tableToken = currentToken || getToken();
  if (!tableToken) {
    showToast('Sesión de mesa no disponible.', 'error');
    return;
  }

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/participants/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: tableToken,
        displayName: rawName
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'No se pudo registrar participante');
    }

    currentParticipantToken = data.participantToken;
    currentParticipantId = data.participantId;
    currentParticipantDisplayName = data.displayName;

    sessionStorage.setItem(getParticipantStorageKey(tableToken), JSON.stringify({
      token: data.participantToken,
      id: data.participantId,
      displayName: data.displayName
    }));

    updateParticipantUI();
    closeParticipantModal();
    showToast(`¡Hola, ${data.displayName}! Tu lugar en la mesa está listo.`, 'success');

    loadDraftCart();
  } catch (err) {
    console.warn('Error al registrar participante:', err);
    showToast('Error al conectar con la mesa. Por favor reintentá.', 'error');
  }
}

function loadDraftCart() {
  const tableToken = currentToken || getToken();
  const key = getDraftCartStorageKey(tableToken, currentParticipantId);
  try {
    const raw = sessionStorage.getItem(key);
    draftCart = raw ? JSON.parse(raw) : [];
  } catch (_) {
    draftCart = [];
  }
  updateCartBadges();
}

function saveDraftCart() {
  const tableToken = currentToken || getToken();
  const key = getDraftCartStorageKey(tableToken, currentParticipantId);
  try {
    sessionStorage.setItem(key, JSON.stringify(draftCart));
  } catch (_) {}
  updateCartBadges();
  renderCartDraft();
}

function updateCartBadges() {
  const totalCount = draftCart.reduce((sum, item) => sum + item.quantity, 0);
  const estimatedTotal = draftCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (el.tabCartDraftCount) {
    el.tabCartDraftCount.textContent = String(totalCount);
  }
  if (el.menuCartCountBadge) {
    el.menuCartCountBadge.textContent = String(totalCount);
  }
  if (el.cartItemCountBadge) {
    el.cartItemCountBadge.textContent = `${totalCount} ${totalCount === 1 ? 'ítem' : 'ítems'}`;
  }
  if (el.cartEstimatedTotal) {
    el.cartEstimatedTotal.textContent = `$${estimatedTotal.toLocaleString('es-AR')}`;
  }

  if (el.floatingCartBar) {
    if (totalCount > 0) {
      el.floatingCartBar.classList.remove('hidden');
    } else {
      el.floatingCartBar.classList.add('hidden');
    }
  }
}

function addToDraftCart(dishItem, quantity = 1, notes = '') {
  if (!dishItem || !dishItem.id) return;
  const existingIndex = draftCart.findIndex(
    i => i.id === dishItem.id && (i.notes || '') === (notes || '')
  );

  if (existingIndex >= 0) {
    draftCart[existingIndex].quantity += quantity;
  } else {
    draftCart.push({
      id: dishItem.id,
      name: dishItem.name,
      price: Number(dishItem.price) || 0,
      quantity,
      notes: notes || ''
    });
  }

  saveDraftCart();
  triggerHaptic();
  showToast(`Agregado a tu pedido (${quantity}x ${dishItem.name})`, 'success');
}

function removeFromDraftCart(index) {
  if (index >= 0 && index < draftCart.length) {
    draftCart.splice(index, 1);
    saveDraftCart();
    triggerHaptic();
  }
}

function updateDraftCartItemQty(index, delta) {
  if (index >= 0 && index < draftCart.length) {
    draftCart[index].quantity += delta;
    if (draftCart[index].quantity <= 0) {
      draftCart.splice(index, 1);
    }
    saveDraftCart();
  }
}

function openCartSheet(tab = 'draft') {
  triggerHaptic();
  closeAllModals();
  const sheet = el.modalCartSheet;
  if (!sheet) return;

  sheet.classList.add('active');
  document.body.classList.add('modal-open');

  switchCartTab(tab);
}

function closeCartSheet() {
  const sheet = el.modalCartSheet;
  if (sheet) sheet.classList.remove('active');

  stopTandasPolling();

  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden), #modalParticipant:not(.hidden)');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

function switchCartTab(tab) {
  if (tab === 'draft') {
    el.viewCartDraft?.classList.remove('hidden');
    el.viewTandasTracking?.classList.add('hidden');

    el.tabCartDraftBtn?.classList.add('bg-amber-500/20', 'text-amber-300', 'border', 'border-amber-500/30');
    el.tabCartDraftBtn?.classList.remove('text-slate-400');

    el.tabTandasTrackingBtn?.classList.remove('bg-amber-500/20', 'text-amber-300', 'border', 'border-amber-500/30');
    el.tabTandasTrackingBtn?.classList.add('text-slate-400');

    stopTandasPolling();
    renderCartDraft();
  } else {
    el.viewCartDraft?.classList.add('hidden');
    el.viewTandasTracking?.classList.remove('hidden');

    el.tabTandasTrackingBtn?.classList.add('bg-amber-500/20', 'text-amber-300', 'border', 'border-amber-500/30');
    el.tabTandasTrackingBtn?.classList.remove('text-slate-400');

    el.tabCartDraftBtn?.classList.remove('bg-amber-500/20', 'text-amber-300', 'border', 'border-amber-500/30');
    el.tabCartDraftBtn?.classList.add('text-slate-400');

    fetchAndRenderTandas();
    startTandasPolling();
  }
}

function renderCartDraft() {
  const container = el.cartDraftItemsContainer;
  if (!container) return;

  container.innerHTML = '';

  if (draftCart.length === 0) {
    if (el.cartDraftEmptyNotice) el.cartDraftEmptyNotice.classList.remove('hidden');
    if (el.cartDraftFooter) el.cartDraftFooter.classList.add('hidden');
    return;
  }

  if (el.cartDraftEmptyNotice) el.cartDraftEmptyNotice.classList.add('hidden');
  if (el.cartDraftFooter) el.cartDraftFooter.classList.remove('hidden');

  let totalEstimate = 0;

  draftCart.forEach((item, index) => {
    const lineTotal = item.price * item.quantity;
    totalEstimate += lineTotal;

    const card = document.createElement('div');
    card.className = 'p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 shadow-md';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1 min-w-0';

    const nameEl = document.createElement('h5');
    nameEl.className = 'text-xs font-extrabold text-white truncate';
    nameEl.textContent = item.name;

    const priceEl = document.createElement('p');
    priceEl.className = 'text-[11px] font-mono text-amber-400 mt-0.5';
    priceEl.textContent = `$${lineTotal.toLocaleString('es-AR')}`;

    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(priceEl);

    if (item.notes) {
      const noteEl = document.createElement('p');
      noteEl.className = 'text-[10px] text-slate-400 italic mt-0.5 truncate';
      noteEl.textContent = `Aclaración: ${item.notes}`;
      infoDiv.appendChild(noteEl);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'flex items-center gap-1.5 shrink-0';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center border border-slate-700 active:scale-95';
    btnMinus.textContent = '-';
    btnMinus.addEventListener('click', () => updateDraftCartItemQty(index, -1));

    const qtySpan = document.createElement('span');
    qtySpan.className = 'font-mono text-xs font-extrabold text-white w-5 text-center';
    qtySpan.textContent = String(item.quantity);

    const btnPlus = document.createElement('button');
    btnPlus.className = 'w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center border border-slate-700 active:scale-95';
    btnPlus.textContent = '+';
    btnPlus.addEventListener('click', () => updateDraftCartItemQty(index, 1));

    const btnDelete = document.createElement('button');
    btnDelete.className = 'w-7 h-7 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 font-bold text-xs flex items-center justify-center border border-red-800/40 ml-1 active:scale-95';
    btnDelete.textContent = '🗑️';
    btnDelete.title = 'Eliminar ítem';
    btnDelete.addEventListener('click', () => removeFromDraftCart(index));

    actionsDiv.appendChild(btnMinus);
    actionsDiv.appendChild(qtySpan);
    actionsDiv.appendChild(btnPlus);
    actionsDiv.appendChild(btnDelete);

    card.appendChild(infoDiv);
    card.appendChild(actionsDiv);
    container.appendChild(card);
  });

  if (el.cartDraftTotalEstimate) {
    el.cartDraftTotalEstimate.textContent = `$${totalEstimate.toLocaleString('es-AR')}`;
  }

  if (el.btnSubmitTanda) {
    if (activeRestaurantConfig && activeRestaurantConfig.allowOrdering === false) {
      el.btnSubmitTanda.disabled = true;
      el.btnSubmitTanda.className = 'w-full py-3.5 px-4 rounded-2xl bg-slate-800 text-slate-400 font-extrabold text-xs flex items-center justify-center gap-2 cursor-not-allowed';
      el.btnSubmitTanda.textContent = 'Modo Carta Informativa (Sin pedidos)';
    } else if (activeRestaurantConfig && activeRestaurantConfig.requireWaiterValidation) {
      el.btnSubmitTanda.disabled = false;
      el.btnSubmitTanda.className = 'w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 font-extrabold text-xs text-slate-950 flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-98 transition-all';
      el.btnSubmitTanda.textContent = '📝 Solicitar Pedido al Mozo';
    } else {
      el.btnSubmitTanda.disabled = false;
      el.btnSubmitTanda.className = 'w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 font-extrabold text-xs text-slate-950 flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 active:scale-98 transition-all';
      el.btnSubmitTanda.textContent = '🚀 Enviar Pedido a Cocina';
    }
  }
}

async function submitCurrentTanda() {
  if (isSubmittingTanda) return;
  if (draftCart.length === 0) {
    showToast('Tu borrador de pedido está vacío.', 'warning');
    return;
  }

  const tableToken = currentToken || getToken();
  if (!tableToken) {
    showToast('Sesión de mesa no disponible.', 'error');
    return;
  }

  if (!currentParticipantToken) {
    showToast('Por favor indicá tu nombre antes de enviar el pedido.', 'info');
    openParticipantModal();
    return;
  }

  if (activeRestaurantConfig && activeRestaurantConfig.allowOrdering === false) {
    showToast('Comandas digitales desactivadas en este local.', 'info');
    return;
  }

  isSubmittingTanda = true;
  const originalText = el.btnSubmitTanda?.textContent;
  if (el.btnSubmitTanda) {
    el.btnSubmitTanda.disabled = true;
    el.btnSubmitTanda.textContent = 'Enviando comanda...';
  }

  const idempotencyKey = `tanda_${currentParticipantId || 'p'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const generalNotes = el.inputTandaNotes?.value?.trim() || undefined;

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/tandas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: tableToken,
        participantToken: currentParticipantToken,
        idempotencyKey,
        items: draftCart.map(item => ({
          menuItemId: item.id,
          quantity: item.quantity,
          notes: item.notes || undefined
        })),
        notes: generalNotes
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === 'ITEM_UNAVAILABLE') {
        showToast('Uno o más platos de tu pedido ya no están disponibles.', 'error');
      } else if (data.code === 'TABLE_ALREADY_PAID') {
        showToast('La mesa ya fue pagada. No es posible enviar más pedidos.', 'error');
      } else if (data.code === 'ORDERING_DISABLED') {
        showToast('Los pedidos desde el móvil están desactivados.', 'warning');
      } else {
        showToast(data.message || data.error || 'No se pudo enviar el pedido.', 'error');
      }
      return;
    }

    draftCart = [];
    saveDraftCart();
    if (el.inputTandaNotes) el.inputTandaNotes.value = '';

    triggerHaptic();
    showToast(`¡Tanda #${data.seq} enviada con éxito!`, 'success');

    switchCartTab('tracking');
  } catch (err) {
    console.warn('Error al enviar tanda:', err);
    showToast('Error de conexión al enviar el pedido. Tu borrador no se perdió, podés reintentar.', 'error');
  } finally {
    isSubmittingTanda = false;
    if (el.btnSubmitTanda) {
      el.btnSubmitTanda.disabled = false;
      if (originalText) el.btnSubmitTanda.textContent = originalText;
    }
  }
}

async function fetchAndRenderTandas() {
  const tableToken = currentToken || getToken();
  if (!tableToken) return;

  const container = el.tandasTrackingListContainer;
  if (!container) return;

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/tandas`, {
      headers: {
        'x-session-token': tableToken
      }
    });

    if (!res.ok) return;
    const tandas = await res.json();

    container.innerHTML = '';

    if (!Array.isArray(tandas) || tandas.length === 0) {
      if (el.tandasTrackingEmptyNotice) el.tandasTrackingEmptyNotice.classList.remove('hidden');
      return;
    }

    if (el.tandasTrackingEmptyNotice) el.tandasTrackingEmptyNotice.classList.add('hidden');

    const statusMap = {
      DRAFT: { label: 'Borrador', class: 'bg-slate-800 text-slate-300 border-slate-700' },
      CONFIRMED: { label: 'Esperando al Mozo ⏳', class: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
      IN_KITCHEN: { label: 'En Cocina 👨‍🍳', class: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
      PREPARING: { label: 'En Preparación 🔥', class: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
      READY: { label: 'Listo para Servir 🍽️', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
      SERVED: { label: 'Servido en Mesa ✅', class: 'bg-slate-800 text-slate-300 border-slate-700' },
      REJECTED: { label: 'Rechazado ❌', class: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
      CANCELLED: { label: 'Cancelado 🚫', class: 'bg-slate-800 text-slate-400 border-slate-700' }
    };

    tandas.forEach((tanda) => {
      const card = document.createElement('div');
      card.className = 'p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 shadow-md';

      const headerRow = document.createElement('div');
      headerRow.className = 'flex items-center justify-between';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'flex items-center gap-2';

      const seqBadge = document.createElement('span');
      seqBadge.className = 'font-mono font-extrabold text-xs text-white bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800';
      seqBadge.textContent = `Tanda #${tanda.seq}`;

      const authorSpan = document.createElement('span');
      authorSpan.className = 'text-[11px] text-slate-400 font-medium';
      const authorName = tanda.participant ? tanda.participant.displayName : 'Personal de mesa';
      authorSpan.textContent = `👤 ${authorName}`;

      titleDiv.appendChild(seqBadge);
      titleDiv.appendChild(authorSpan);

      const stObj = statusMap[tanda.status] || { label: tanda.status, class: 'bg-slate-800 text-slate-300 border-slate-700' };
      const statusBadge = document.createElement('span');
      statusBadge.className = `text-[10px] font-bold px-2 py-0.5 rounded-full border ${stObj.class}`;
      statusBadge.textContent = stObj.label;

      headerRow.appendChild(titleDiv);
      headerRow.appendChild(statusBadge);
      card.appendChild(headerRow);

      if (tanda.rejectionReason) {
        const rejBox = document.createElement('div');
        rejBox.className = 'p-2 rounded-xl bg-rose-950/40 border border-rose-800/40 text-[11px] text-rose-300 flex items-start gap-1.5';
        const icon = document.createElement('span');
        icon.textContent = '⚠️';
        const msg = document.createElement('span');
        msg.textContent = `Motivo: ${tanda.rejectionReason}`;
        rejBox.appendChild(icon);
        rejBox.appendChild(msg);
        card.appendChild(rejBox);
      }

      if (tanda.notes) {
        const noteP = document.createElement('p');
        noteP.className = 'text-[10px] text-slate-400 italic bg-slate-900/60 p-1.5 rounded-lg';
        noteP.textContent = `Nota: ${tanda.notes}`;
        card.appendChild(noteP);
      }

      if (Array.isArray(tanda.items) && tanda.items.length > 0) {
        const itemsList = document.createElement('ul');
        itemsList.className = 'space-y-1 pt-1 border-t border-slate-900 text-xs';

        tanda.items.forEach((item) => {
          const li = document.createElement('li');
          li.className = 'flex items-center justify-between text-slate-300';

          const leftSpan = document.createElement('span');
          leftSpan.textContent = `${item.quantity}x ${item.productNameSnapshot || 'Plato'}`;

          li.appendChild(leftSpan);

          if (item.notes) {
            const noteSpan = document.createElement('span');
            noteSpan.className = 'text-[10px] text-slate-500 italic ml-2 truncate';
            noteSpan.textContent = `(${item.notes})`;
            li.appendChild(noteSpan);
          }

          itemsList.appendChild(li);
        });

        card.appendChild(itemsList);
      }

      container.appendChild(card);
    });
  } catch (err) {
    console.warn('Error al obtener historial de tandas:', err);
  }
}

function startTandasPolling() {
  stopTandasPolling();
  tandasPollTimer = setInterval(() => {
    fetchAndRenderTandas();
  }, 7000);
}

function stopTandasPolling() {
  if (tandasPollTimer) {
    clearInterval(tandasPollTimer);
    tandasPollTimer = null;
  }
}

function closeAllModals() {
  if (el.modalBill) el.modalBill.classList.add('hidden');
  if (el.modalWaiter) el.modalWaiter.classList.add('hidden');
  if (el.modalSupplies) el.modalSupplies.classList.add('hidden');
  if (el.modalMenu) el.modalMenu.classList.add('hidden');
  if (el.modalParticipant) el.modalParticipant.classList.add('hidden');
  closeDishDetailSheet();
  closeSommelierDrawer();
  closeCartSheet();
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
    closeAllModals();
    if (el.modalWaiter) {
      el.modalWaiter.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
  });

  // Action: Pedir Cuenta (Etapa 08 — Cuenta dividida y Mi Parte)
  if (el.btnActionBill) el.btnActionBill.addEventListener('click', openBillModal);
  if (el.btnCloseModalBill) el.btnCloseModalBill.addEventListener('click', closeBillModal);

  if (el.modalBill) {
    el.modalBill.addEventListener('click', (e) => {
      if (e.target === el.modalBill) {
        closeBillModal();
      }
    });
  }

  // Split bill tabs
  if (el.tabBillMyShareBtn) el.tabBillMyShareBtn.addEventListener('click', () => switchBillTab('myshare'));
  if (el.tabBillEqualSplitBtn) el.tabBillEqualSplitBtn.addEventListener('click', () => switchBillTab('equalsplit'));
  if (el.tabBillAllTableBtn) el.tabBillAllTableBtn.addEventListener('click', () => switchBillTab('alltable'));

  // Equal split people selector
  document.querySelectorAll('.btn-split-people').forEach(btn => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      const parts = Number(btn.getAttribute('data-parts')) || 2;
      selectedSplitPeople = parts;
      document.querySelectorAll('.btn-split-people').forEach(b => {
        b.className = 'btn-split-people py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-bold text-xs';
      });
      btn.className = 'btn-split-people py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs shadow-sm';
      if (currentTableBill) {
        renderEqualSplitTab(currentTableBill);
        updateSubmitBillButtonAmount();
      }
    });
  });

  // Payment method choices in bill modal
  document.querySelectorAll('.btn-pay-method-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      const method = btn.getAttribute('data-method') || 'MERCADO_PAGO';
      selectedBillPaymentMethod = method;
      document.querySelectorAll('.btn-pay-method-choice').forEach(b => {
        b.className = 'btn-pay-method-choice p-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-all bg-slate-900 text-slate-400 border-slate-800 hover:text-white';
      });
      btn.className = 'btn-pay-method-choice p-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-all bg-indigo-600/20 text-indigo-300 border-indigo-500/60 shadow-sm';
    });
  });

  // Submit bill request button
  if (el.btnSubmitBillRequest) {
    el.btnSubmitBillRequest.addEventListener('click', handleSubmitBillRequest);
  }

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
    btnOrderSpecificDish.addEventListener('click', () => {
      if (selectedDishForOrder) {
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

  // Participant Identity Modals & Badges
  if (el.btnParticipantBadge) {
    el.btnParticipantBadge.addEventListener('click', openParticipantModal);
  }
  if (el.btnCloseModalParticipant) {
    el.btnCloseModalParticipant.addEventListener('click', closeParticipantModal);
  }
  if (el.btnSaveParticipant) {
    el.btnSaveParticipant.addEventListener('click', handleSaveParticipant);
  }
  if (el.modalParticipant) {
    el.modalParticipant.addEventListener('click', (e) => {
      if (e.target === el.modalParticipant) closeParticipantModal();
    });
  }
  if (el.inputParticipantName) {
    el.inputParticipantName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveParticipant();
      }
    });
  }

  // Dish Sheet Quantity Controls & Add to Tanda
  if (el.btnDishQtyMinus) {
    el.btnDishQtyMinus.addEventListener('click', () => {
      if (currentDishQty > 1) {
        currentDishQty--;
        if (el.dishSheetQty) el.dishSheetQty.textContent = String(currentDishQty);
      }
    });
  }
  if (el.btnDishQtyPlus) {
    el.btnDishQtyPlus.addEventListener('click', () => {
      if (currentDishQty < 50) {
        currentDishQty++;
        if (el.dishSheetQty) el.dishSheetQty.textContent = String(currentDishQty);
      }
    });
  }
  if (el.btnAddToTanda) {
    el.btnAddToTanda.addEventListener('click', () => {
      if (!selectedDishForOrder) return;
      if (!currentParticipantToken) {
        showToast('Por favor indicá tu nombre para registrar tu pedido.', 'info');
        openParticipantModal();
        return;
      }
      const notes = el.dishSheetNotes?.value?.trim() || '';
      addToDraftCart(selectedDishForOrder, currentDishQty, notes);
      closeDishDetailSheet();
    });
  }

  // Floating Cart Bar & Menu Cart Button
  if (el.floatingCartBar) {
    el.floatingCartBar.addEventListener('click', () => openCartSheet('draft'));
  }
  if (el.btnOpenCartFromMenu) {
    el.btnOpenCartFromMenu.addEventListener('click', () => {
      closeAllModals();
      openCartSheet('draft');
    });
  }
  if (el.btnCloseCartSheet) {
    el.btnCloseCartSheet.addEventListener('click', closeCartSheet);
  }

  // Cart Sheet Tabs & Actions
  if (el.tabCartDraftBtn) {
    el.tabCartDraftBtn.addEventListener('click', () => switchCartTab('draft'));
  }
  if (el.tabTandasTrackingBtn) {
    el.tabTandasTrackingBtn.addEventListener('click', () => switchCartTab('tracking'));
  }
  if (el.btnChangeParticipantFromCart) {
    el.btnChangeParticipantFromCart.addEventListener('click', openParticipantModal);
  }
  if (el.btnSubmitTanda) {
    el.btnSubmitTanda.addEventListener('click', submitCurrentTanda);
  }
  if (el.btnRefreshTandas) {
    el.btnRefreshTandas.addEventListener('click', fetchAndRenderTandas);
  }

  // Gesture engine for Cart Sheet Drawer
  enableSheetSwipeToDismiss('modalCartSheet', closeCartSheet);
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
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalBill:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden), #modalParticipant:not(.hidden)');
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

// ==========================================
// CUENTA DIVIDIDA Y MI PARTE (Etapa 08)
// ==========================================
let currentTableBill = null;
let currentBillTab = 'myshare';
let selectedSplitPeople = 2;
let selectedBillPaymentMethod = 'MERCADO_PAGO';

function openBillModal() {
  triggerHaptic();
  closeAllModals();
  if (el.modalBill) {
    el.modalBill.classList.remove('hidden');
    document.body.classList.add('modal-open');
    switchBillTab('myshare');
    fetchAndRenderBill();
  }
}

function closeBillModal() {
  if (el.modalBill) el.modalBill.classList.add('hidden');
  const anyModalActive = document.querySelector('.bottom-sheet-backdrop.active, #modalMenu:not(.hidden), #modalWaiter:not(.hidden), #modalSupplies:not(.hidden), #modalParticipant:not(.hidden), #modalCartSheet.active');
  if (!anyModalActive) {
    document.body.classList.remove('modal-open');
  }
}

function switchBillTab(tabName) {
  currentBillTab = tabName;
  const isMyShare = tabName === 'myshare';
  const isEqual = tabName === 'equalsplit';
  const isAll = tabName === 'alltable';

  if (el.tabBillMyShareBtn) {
    el.tabBillMyShareBtn.className = isMyShare
      ? 'py-2 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center justify-center gap-1 transition-all'
      : 'py-2 rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1 transition-all';
  }
  if (el.tabBillEqualSplitBtn) {
    el.tabBillEqualSplitBtn.className = isEqual
      ? 'py-2 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center justify-center gap-1 transition-all'
      : 'py-2 rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1 transition-all';
  }
  if (el.tabBillAllTableBtn) {
    el.tabBillAllTableBtn.className = isAll
      ? 'py-2 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center justify-center gap-1 transition-all'
      : 'py-2 rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1 transition-all';
  }

  if (el.billTabContentMyShare) el.billTabContentMyShare.classList.toggle('hidden', !isMyShare);
  if (el.billTabContentEqualSplit) el.billTabContentEqualSplit.classList.toggle('hidden', !isEqual);
  if (el.billTabContentAllTable) el.billTabContentAllTable.classList.toggle('hidden', !isAll);

  updateSubmitBillButtonAmount();
}

function updateSubmitBillButtonAmount() {
  if (!el.btnSubmitBillAmountBadge || !currentTableBill) return;
  let targetCents = currentTableBill.remainingCents;

  if (currentBillTab === 'myshare') {
    targetCents = calculateMyShareCents();
  } else if (currentBillTab === 'equalsplit') {
    const ep = (currentTableBill.equalParts || []).find(p => p.totalParts === selectedSplitPeople);
    targetCents = ep ? ep.amountCents : Math.round(currentTableBill.totalCents / selectedSplitPeople);
  }

  el.btnSubmitBillAmountBadge.textContent = `$${(targetCents / 100).toFixed(2)}`;
}

function calculateMyShareCents() {
  if (!currentTableBill || !currentTableBill.items) return 0;
  let sum = 0;
  for (const it of currentTableBill.items) {
    const isMine = (currentParticipantId && it.participantId === currentParticipantId) ||
                   (currentParticipantId && it.claimedByParticipantId === currentParticipantId);
    if (isMine) {
      sum += it.lineTotalCents || 0;
    }
  }
  return sum;
}

async function fetchAndRenderBill() {
  const token = currentToken || getToken();
  if (!token) return;

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/bills/session/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('Error al consultar cuenta');
    const data = await res.json();
    currentTableBill = data;
    renderBillUI(data);
  } catch (err) {
    console.warn('Error al cargar la cuenta:', err);
  }
}

function renderBillUI(bill) {
  if (!bill) return;

  // 1. Balance
  if (el.billTotalAmountDisplay) {
    el.billTotalAmountDisplay.textContent = `$${(bill.totalCents / 100).toFixed(2)}`;
  }
  if (el.billPaidAmountDisplay) {
    el.billPaidAmountDisplay.textContent = `$${(bill.paidCents / 100).toFixed(2)}`;
  }
  if (el.billRemainingAmountDisplay) {
    el.billRemainingAmountDisplay.textContent = `$${(bill.remainingCents / 100).toFixed(2)}`;
  }
  if (el.billStatusBadge) {
    if (bill.status === 'PAID' || bill.remainingCents === 0) {
      el.billStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      el.billStatusBadge.textContent = 'SALDADA ✓';
    } else {
      el.billStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      el.billStatusBadge.textContent = 'PENDIENTE';
    }
  }

  // Participant name in share
  if (el.billMyParticipantName) {
    el.billMyParticipantName.textContent = currentParticipantDisplayName || 'Comensal';
  }

  // 2. Render Tab 1: Mi Parte
  renderMyShareTab(bill);

  // 3. Render Tab 2: Partes Iguales
  renderEqualSplitTab(bill);

  // 4. Render Tab 3: Toda la Mesa
  renderAllTableTab(bill);

  // 5. Update Submit button badge
  updateSubmitBillButtonAmount();
}

function renderMyShareTab(bill) {
  if (!el.myShareItemsList || !el.unclaimedItemsList) return;
  el.myShareItemsList.innerHTML = '';
  el.unclaimedItemsList.innerHTML = '';

  const myItems = [];
  const otherUnclaimedItems = [];

  for (const item of (bill.items || [])) {
    const isMine = (currentParticipantId && item.participantId === currentParticipantId) ||
                   (currentParticipantId && item.claimedByParticipantId === currentParticipantId);
    if (isMine) {
      myItems.push(item);
    } else if (!item.claimedByParticipantId) {
      otherUnclaimedItems.push(item);
    }
  }

  const myShareCents = myItems.reduce((acc, it) => acc + (it.lineTotalCents || 0), 0);
  if (el.myShareSubtotalDisplay) {
    el.myShareSubtotalDisplay.textContent = `$${(myShareCents / 100).toFixed(2)}`;
  }
  if (el.myShareItemsCount) {
    el.myShareItemsCount.textContent = `${myItems.length} ítem${myItems.length === 1 ? '' : 's'}`;
  }

  if (myItems.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'p-3 rounded-xl bg-slate-900 border border-slate-800 text-center text-slate-400 text-xs';
    emptyNotice.textContent = 'Aún no tienes platos asignados a tu parte. Puedes asignar platos de la lista inferior.';
    el.myShareItemsList.appendChild(emptyNotice);
  } else {
    myItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'p-2.5 rounded-xl bg-slate-950/80 border border-indigo-500/30 flex items-center justify-between gap-2';

      const left = document.createElement('div');
      left.className = 'min-w-0';
      const nameP = document.createElement('p');
      nameP.className = 'font-bold text-white truncate text-xs';
      nameP.textContent = `${item.productName} ×${item.quantity}`;
      left.appendChild(nameP);

      const priceSpan = document.createElement('span');
      priceSpan.className = 'text-[11px] font-mono text-indigo-300 font-bold';
      priceSpan.textContent = `$${(item.lineTotalCents / 100).toFixed(2)}`;
      left.appendChild(priceSpan);
      row.appendChild(left);

      // Unclaim button
      const unclaimBtn = document.createElement('button');
      unclaimBtn.type = 'button';
      unclaimBtn.className = 'px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold shrink-0 border border-slate-700';
      unclaimBtn.textContent = 'Liberar';
      unclaimBtn.addEventListener('click', () => handleClaimToggle(item.id, null, item.claimVersion));
      row.appendChild(unclaimBtn);

      el.myShareItemsList.appendChild(row);
    });
  }

  // Unclaimed items section
  if (otherUnclaimedItems.length === 0) {
    const noUnclaimed = document.createElement('div');
    noUnclaimed.className = 'p-2 text-center text-[11px] text-slate-500 italic';
    noUnclaimed.textContent = 'No hay otros platos sin asignar en la mesa.';
    el.unclaimedItemsList.appendChild(noUnclaimed);
  } else {
    otherUnclaimedItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'p-2 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center justify-between gap-2';

      const left = document.createElement('div');
      left.className = 'min-w-0';
      const nameP = document.createElement('p');
      nameP.className = 'text-xs text-slate-300 truncate';
      nameP.textContent = `${item.productName} ×${item.quantity} ($${(item.lineTotalCents / 100).toFixed(2)})`;
      left.appendChild(nameP);
      row.appendChild(left);

      const claimBtn = document.createElement('button');
      claimBtn.type = 'button';
      claimBtn.className = 'px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-[10px] font-bold shrink-0';
      claimBtn.textContent = '+ Consumí esto';
      claimBtn.addEventListener('click', () => {
        if (!currentParticipantId) {
          showToast('Primero identifícate en la mesa.', 'info');
          openParticipantModal();
          return;
        }
        handleClaimToggle(item.id, currentParticipantId, item.claimVersion);
      });
      row.appendChild(claimBtn);

      el.unclaimedItemsList.appendChild(row);
    });
  }
}

function renderEqualSplitTab(bill) {
  if (!el.equalPartsBreakdownList) return;
  el.equalPartsBreakdownList.innerHTML = '';

  const ep = (bill.equalParts || []).filter(p => p.totalParts === selectedSplitPeople);
  if (ep.length > 0) {
    if (el.equalSplitPartAmountDisplay) {
      el.equalSplitPartAmountDisplay.textContent = `$${(ep[0].amountCents / 100).toFixed(2)}`;
    }

    ep.forEach((part) => {
      const pRow = document.createElement('div');
      pRow.className = 'flex items-center justify-between py-1 border-b border-slate-900 last:border-0';
      const pLabel = document.createElement('span');
      pLabel.className = 'text-slate-400 font-semibold';
      pLabel.textContent = `Persona ${part.part} de ${part.totalParts}:`;
      const pVal = document.createElement('span');
      pVal.className = 'font-mono font-bold text-white';
      pVal.textContent = `$${(part.amountCents / 100).toFixed(2)}`;
      pRow.appendChild(pLabel);
      pRow.appendChild(pVal);
      el.equalPartsBreakdownList.appendChild(pRow);
    });
  }
}

function renderAllTableTab(bill) {
  if (!el.allTableItemsList) return;
  el.allTableItemsList.innerHTML = '';

  if (!bill.items || bill.items.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'p-4 rounded-xl bg-slate-900 text-center text-xs text-slate-400';
    emptyNotice.textContent = 'No hay consumos confirmados en la mesa todavía.';
    el.allTableItemsList.appendChild(emptyNotice);
    return;
  }

  bill.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2';

    const left = document.createElement('div');
    left.className = 'min-w-0';
    const nameP = document.createElement('p');
    nameP.className = 'font-bold text-white truncate text-xs';
    nameP.textContent = `${item.productName} ×${item.quantity}`;
    left.appendChild(nameP);

    const authorSpan = document.createElement('span');
    authorSpan.className = 'text-[10px] text-slate-400 block mt-0.5';
    const authorName = item.participantName || (item.participantId ? 'Comensal' : 'Mesa');
    authorSpan.textContent = `Pedido por: ${authorName}`;
    left.appendChild(authorSpan);
    row.appendChild(left);

    const priceSpan = document.createElement('span');
    priceSpan.className = 'text-xs font-mono font-bold text-slate-200 shrink-0';
    priceSpan.textContent = `$${(item.lineTotalCents / 100).toFixed(2)}`;
    row.appendChild(priceSpan);

    el.allTableItemsList.appendChild(row);
  });
}

async function handleClaimToggle(orderItemId, targetParticipantId, claimVersion) {
  const token = currentToken || getToken();
  if (!token) return;

  try {
    const res = await fetchWithRetry(`${API_BASE}/orders/bills/claim-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: token,
        orderItemId,
        participantId: targetParticipantId,
        expectedVersion: claimVersion
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        showToast('Conflicto: otro comensal actualizó la asignación del plato.', 'warning');
      } else {
        throw new Error(data.message || data.error || 'No se pudo actualizar plato');
      }
    } else {
      triggerHaptic();
    }
    await fetchAndRenderBill();
  } catch (err) {
    showToast(err.message || 'Error al actualizar asignación', 'error');
  }
}

async function handleSubmitBillRequest() {
  if (!currentTableBill) return;
  let targetCents = currentTableBill.remainingCents;
  let desc = 'Saldo Total de Mesa';

  if (currentBillTab === 'myshare') {
    targetCents = calculateMyShareCents();
    desc = `Mi Parte (${currentParticipantDisplayName || 'Comensal'})`;
  } else if (currentBillTab === 'equalsplit') {
    const ep = (currentTableBill.equalParts || []).find(p => p.totalParts === selectedSplitPeople);
    targetCents = ep ? ep.amountCents : Math.round(currentTableBill.totalCents / selectedSplitPeople);
    desc = `1 Cuota de ${selectedSplitPeople} personas`;
  }

  const formattedAmount = `$${(targetCents / 100).toFixed(2)}`;
  const methodLabel = selectedBillPaymentMethod === 'MERCADO_PAGO'
    ? 'Mercado Pago (QR)'
    : selectedBillPaymentMethod === 'CARD'
    ? 'Tarjeta'
    : 'Efectivo';

  const note = `Cobro Solicitado: ${formattedAmount} [${desc}] • Medio: ${methodLabel}`;

  triggerHaptic();
  sendCall('BILL', selectedBillPaymentMethod, note);
  closeBillModal();
  showToast(`¡Pedido de cuenta enviado! El mozo se acercará para cobrar ${formattedAmount} con ${methodLabel}.`, 'success');
}

let activeRestaurantConfig = null;
let selectedTipPercentage = 10;

async function loadRestaurantModuleConfig(slug) {
  try {
    const res = await fetchWithRetry(`${API_BASE}/restaurants/${encodeURIComponent(slug)}/config`);
    if (!res.ok) return;
    const config = await res.json();
    activeRestaurantConfig = config;

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
        el.btnOrderFromMenu.innerHTML = '<span>🙋 Llamar al Mozo para Pedir</span>';
      }
      const orderSpecificBtn = document.getElementById('btnOrderSpecificDish');
      if (orderSpecificBtn) {
        orderSpecificBtn.innerHTML = '<span>🛎️ Pedir este plato al Mozo</span>';
      }
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

