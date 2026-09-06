export enum PlanTier {
  LEAN = 'LEAN',
  SALON_TABLET = 'SALON_TABLET',
  FULL_SMARTBAND = 'FULL_SMARTBAND'
}

export enum Sector {
  SALON_PRINCIPAL = 'SALON_PRINCIPAL',
  TERRAZA = 'TERRAZA',
  PLANTA_ALTA = 'PLANTA_ALTA',
  VEREDA = 'VEREDA',
  BARRA = 'BARRA'
}

export const SECTOR_LABELS: Record<Sector, string> = {
  [Sector.SALON_PRINCIPAL]: 'Salón Principal',
  [Sector.TERRAZA]: 'Terraza',
  [Sector.PLANTA_ALTA]: 'Segundo Piso (Planta Alta)',
  [Sector.VEREDA]: 'Vereda',
  [Sector.BARRA]: 'Barra'
};

export enum CallType {
  BILL = 'BILL',
  WAITER = 'WAITER',
  SUPPLIES = 'SUPPLIES',
  CUSTOM = 'CUSTOM'
}

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  [CallType.BILL]: 'Pedir la Cuenta',
  [CallType.WAITER]: 'Llamar al Mozo',
  [CallType.SUPPLIES]: 'Pedir Insumos',
  [CallType.CUSTOM]: 'Consulta Especial'
};

export enum CallStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED'
}

export enum PaymentMethod {
  CASH = 'CASH',
  MERCADO_PAGO = 'MERCADO_PAGO',
  CARD = 'CARD',
  NOT_APPLICABLE = 'NOT_APPLICABLE'
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Efectivo',
  [PaymentMethod.MERCADO_PAGO]: 'Mercado Pago (QR)',
  [PaymentMethod.CARD]: 'Tarjeta (Débito/Crédito)',
  [PaymentMethod.NOT_APPLICABLE]: 'No Aplica'
};

export enum CallOrigin {
  WEB_DIRECT = 'WEB_DIRECT',
  WHATSAPP_FALLBACK = 'WHATSAPP_FALLBACK'
}

export interface SessionValidationResponse {
  valid: boolean;
  token?: string;
  isClosed?: boolean;
  isExpired?: boolean;
  isActive?: boolean;
  error?: string;
  message?: string;
  table?: {
    id: string;
    label: string;
    sector: Sector;
    isOutdoor: boolean;
    currentState?: string;
  };
  restaurant?: {
    id: string;
    name: string;
    slug: string;
    whatsappPhone?: string | null;
    pdfMenuUrl?: string | null;
    themeColor?: string;
    templateId?: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number;
  };
  activeCall?: {
    id: string;
    type: CallType;
    paymentMethod: PaymentMethod;
    status: CallStatus;
    createdAt: string;
  } | null;
  expiresAt?: string;
}

export interface CreateCallDTO {
  sessionToken: string;
  type: CallType;
  paymentMethod?: PaymentMethod;
  note?: string;
  origin?: CallOrigin;
  latitude?: number;
  longitude?: number;
}

export interface UpdateCallStatusDTO {
  status: CallStatus;
}

export interface CallEventData {
  id: string;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  sector: Sector;
  type: CallType;
  paymentMethod: PaymentMethod;
  note?: string | null;
  origin: CallOrigin;
  status: CallStatus;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
}

export interface StaffLoginDTO {
  restaurantSlug: string;
  pin: string;
}

export interface StaffUserDTO {
  id: string;
  name: string;
  role: string;
  assignedSector?: Sector | null;
  restaurantId: string;
  restaurantName: string;
}

export interface FeedbackDTO {
  sessionToken: string;
  rating: number;
  comment?: string;
}

export interface MetricsDTO {
  avgResponseTimeSeconds: number;
  totalCallsToday: number;
  pendingCallsCount: number;
  callsByType: Record<CallType, number>;
  callsByPaymentMethod: Record<PaymentMethod, number>;
  npsAverage: number;
}

// ==========================================
// CARTA DIGITAL & MENÚ MULTI-TENANT
// ==========================================

export interface MenuItemTag {
  id: string;
  label: string;
  emoji: string;
  colorClass: string;
}

export const MENU_TAGS: Record<string, MenuItemTag> = {
  GLUTEN_FREE: { id: 'GLUTEN_FREE', label: 'Sin TACC', emoji: '🌾', colorClass: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  VEGAN: { id: 'VEGAN', label: 'Vegano', emoji: '🌱', colorClass: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  VEGETARIAN: { id: 'VEGETARIAN', label: 'Vegetariano', emoji: '🧀', colorClass: 'text-lime-400 bg-lime-400/10 border-lime-400/30' },
  CHEF_PICK: { id: 'CHEF_PICK', label: 'Sugerencia', emoji: '⭐', colorClass: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  SPICY: { id: 'SPICY', label: 'Picante', emoji: '🌶️', colorClass: 'text-rose-400 bg-rose-400/10 border-rose-400/30' },
  POPULAR: { id: 'POPULAR', label: 'Más Pedido', emoji: '🔥', colorClass: 'text-orange-400 bg-orange-400/10 border-orange-400/30' }
};

export interface MenuItemDTO {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isAvailable: boolean;
  isFeatured: boolean;
  tags: string[];
  orderIndex: number;
}

export interface MenuCategoryDTO {
  id: string;
  restaurantId: string;
  name: string;
  icon?: string | null;
  orderIndex: number;
  items: MenuItemDTO[];
}

export enum MenuTemplateId {
  GOURMET_OBSIDIAN = 'GOURMET_OBSIDIAN',
  NEON_BURGER = 'NEON_BURGER',
  COASTAL_BEACH = 'COASTAL_BEACH',
  MINIMAL_BISTRO = 'MINIMAL_BISTRO'
}

export interface MenuTemplateConfig {
  id: MenuTemplateId;
  name: string;
  tagline: string;
  recommendedFor: string;
  primaryColor: string;
  accentGlow: string;
  bgClass: string;
  cardClass: string;
  fontFamily: string;
  borderClass: string;
  previewGradient: string;
}

export const MENU_TEMPLATES: Record<MenuTemplateId, MenuTemplateConfig> = {
  [MenuTemplateId.GOURMET_OBSIDIAN]: {
    id: MenuTemplateId.GOURMET_OBSIDIAN,
    name: 'Gourmet Obsidian & Gold',
    tagline: 'Elegancia y calidez artesanal',
    recommendedFor: 'Trattorias, Parrillas, Bodegones, Vinos de autor',
    primaryColor: '#f59e0b',
    accentGlow: 'rgba(245, 158, 11, 0.25)',
    bgClass: 'bg-slate-950 text-slate-100',
    cardClass: 'bg-slate-900/90 border-slate-800 shadow-amber-950/20',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    borderClass: 'border-amber-500/30',
    previewGradient: 'from-amber-900/50 via-slate-900 to-slate-950'
  },
  [MenuTemplateId.NEON_BURGER]: {
    id: MenuTemplateId.NEON_BURGER,
    name: 'Cyber Neon Street',
    tagline: 'Alto contraste y vibra nocturna',
    recommendedFor: 'Hamburgueserías Smash, Cervecerías, Bares, Tacos',
    primaryColor: '#a3e635',
    accentGlow: 'rgba(163, 230, 53, 0.3)',
    bgClass: 'bg-zinc-950 text-zinc-100',
    cardClass: 'bg-zinc-900/95 border-zinc-800 shadow-lime-950/30',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    borderClass: 'border-lime-400/40',
    previewGradient: 'from-lime-950/50 via-zinc-900 to-zinc-950'
  },
  [MenuTemplateId.COASTAL_BEACH]: {
    id: MenuTemplateId.COASTAL_BEACH,
    name: 'Coastal Sun & Sea',
    tagline: 'Frescura marina y luz natural',
    recommendedFor: 'Marisquerías, Paradores de Playa MDP, Terrazas',
    primaryColor: '#06b6d4',
    accentGlow: 'rgba(6, 182, 212, 0.25)',
    bgClass: 'bg-slate-950 text-slate-100',
    cardClass: 'bg-slate-900/90 border-cyan-900/40 shadow-cyan-950/20',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    borderClass: 'border-cyan-500/30',
    previewGradient: 'from-cyan-950/60 via-slate-900 to-slate-950'
  },
  [MenuTemplateId.MINIMAL_BISTRO]: {
    id: MenuTemplateId.MINIMAL_BISTRO,
    name: 'Minimalist Specialty',
    tagline: 'Limpio, sobrio y editorial',
    recommendedFor: 'Cafés de Especialidad, Brunch, Panaderías, Sushi',
    primaryColor: '#e2e8f0',
    accentGlow: 'rgba(226, 232, 240, 0.2)',
    bgClass: 'bg-neutral-950 text-neutral-100',
    cardClass: 'bg-neutral-900/90 border-neutral-800 shadow-neutral-950/20',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    borderClass: 'border-neutral-700/50',
    previewGradient: 'from-neutral-800/40 via-neutral-900 to-neutral-950'
  }
};

export interface RestaurantMenuResponse {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string | null;
    coverImageUrl?: string | null;
    themeColor: string;
    templateId: MenuTemplateId;
    customFont: string;
    whatsappPhone?: string | null;
  };
  categories: MenuCategoryDTO[];
}

export interface BatchMenuImportItem {
  category: string;
  categoryIcon?: string;
  name: string;
  description?: string;
  price: number;
  tags?: string[];
  imageUrl?: string;
  isFeatured?: boolean;
}

export interface BatchMenuImportDTO {
  replaceExisting?: boolean;
  templateId?: MenuTemplateId;
  items: BatchMenuImportItem[];
}

export interface ChefAIGenerateDTO {
  concept: string; // e.g. "Hamburguesería artesanal con smash burgers dobles y cerveza tirada en Mar del Plata"
  gastronomyType?: 'BURGER_BAR' | 'TRATTORIA_PASTA' | 'PARRILLA_STEAK' | 'COASTAL_SEAFOOD' | 'SPECIALTY_CAFE';
  priceLevel?: 'ACCESIBLE' | 'MEDIO' | 'PREMIUM';
}

export interface ChefAIGenerateResponse {
  suggestedName: string;
  suggestedTemplateId: MenuTemplateId;
  suggestedThemeColor: string;
  suggestedCoverUrl: string;
  categories: {
    name: string;
    icon: string;
    items: BatchMenuImportItem[];
  }[];
  // La generación es siempre una vista previa; puede degradarse sin aplicar cambios.
  degraded?: boolean;
  applied?: boolean;
  reviewNote?: string;
}

export interface GenerateMenuAiDTO {
  prompt: string;
  concept?: string;
  templateId?: MenuTemplateId;
  autoApply?: boolean;
  gastronomyType?: string;
}

export interface GenerateMenuAiResponseDTO {
  suggestedTemplateId: MenuTemplateId;
  themeColor: string;
  categories: {
    name: string;
    icon: string;
    items: {
      name: string;
      description?: string | null;
      price: number;
      imageUrl?: string | null;
      tags?: string[];
      isFeatured?: boolean;
    }[];
  }[];
  // Contención etapa 04: modo degradado explícito y vista previa pendiente
  // de revisión humana. `applied` es siempre false desde la API contenida.
  degraded?: boolean;
  applied?: boolean;
  reviewNote?: string;
}

export interface SommelierQueryDTO {
  query: string;
  sessionToken?: string;
}

export interface SommelierResponseDTO {
  answer: string;
  recommendedDishIds: string[];
  suggestedDishes: MenuItemDTO[];
  suggestedPairing?: string;
  poweredBy: 'gemini' | 'heuristic-engine';
  // Contención etapa 04: true cuando la respuesta es degradada explícita
  // (abstención dietaria o IA no disponible) derivando al personal.
  degraded?: boolean;
}

// ==========================================
// MÓDULOS ACTIVABLES (FEATURE FLAGS POR LOCAL)
// ==========================================

export enum PaymentMode {
  WAITER_ONLY = 'WAITER_ONLY',
  DIGITAL_MP = 'DIGITAL_MP',
  HYBRID = 'HYBRID'
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  [PaymentMode.WAITER_ONLY]: 'Solo Mozo Presencial (Efectivo / POS / QR Mozo)',
  [PaymentMode.DIGITAL_MP]: 'Cobro Digital Autónomo (Mercado Pago / Split en Mesa)',
  [PaymentMode.HYBRID]: 'Híbrido (Comensal elige Celular o Mozo)'
};

export interface RestaurantModuleConfigDTO {
  id: string;
  restaurantId: string;
  paymentMode: PaymentMode;
  allowSplitBill: boolean;
  allowOrdering: boolean;
  syncSocialCart: boolean;
  requireWaiterValidation: boolean;
  enableUpsell: boolean;
  enableSmartTips: boolean;
  suggestedTipPercentages: number[];
  enableReviews: boolean;
  googlePlaceId?: string | null;
  enableWaitlist: boolean;
  enableWaitlistPreOrder: boolean;
  enableRewards: boolean;
  pointsPerHundredPesos: number;
}

export interface UpdateModuleConfigDTO {
  paymentMode?: PaymentMode;
  allowSplitBill?: boolean;
  allowOrdering?: boolean;
  syncSocialCart?: boolean;
  requireWaiterValidation?: boolean;
  enableUpsell?: boolean;
  enableSmartTips?: boolean;
  suggestedTipPercentages?: number[];
  enableReviews?: boolean;
  googlePlaceId?: string | null;
  enableWaitlist?: boolean;
  enableWaitlistPreOrder?: boolean;
  enableRewards?: boolean;
  pointsPerHundredPesos?: number;
  changedBy?: string;
}

export interface ModuleConfigAuditDTO {
  id: string;
  restaurantId: string;
  changedBy?: string | null;
  changedField: string;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: string;
}

// ==========================================
// COMANDAS & CARRITO COLABORATIVO (SOCIAL DINING)
// ==========================================

export enum OrderStatus {
  DRAFT = 'DRAFT',
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  CONFIRMED = 'CONFIRMED',
  IN_KITCHEN = 'IN_KITCHEN',
  READY_TO_SERVE = 'READY_TO_SERVE',
  SERVED = 'SERVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED'
}

export interface OrderItemDTO {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
  addedByGuest: string;
  claimedByGuest?: string | null;
  claimVersion: number;
  isPaid: boolean;
}

export interface OrderDTO {
  id: string;
  tableSessionId: string;
  status: OrderStatus;
  totalAmount: number;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface AddOrderItemDTO {
  sessionToken: string;
  guestSessionId: string;
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface RemoveOrderItemDTO {
  sessionToken: string;
  orderItemId: string;
}

// ==========================================
// SPLIT BILL & PAGOS
// ==========================================

export enum SplitMode {
  BY_ITEM = 'BY_ITEM',
  EQUAL_PARTS = 'EQUAL_PARTS'
}

export interface SplitBillSessionDTO {
  id: string;
  orderId: string;
  mode: SplitMode;
  totalParts: number;
  paidParts: number;
  partAmount?: number | null;
  totalAmount: number;
  remainingAmount: number;
  status: 'OPEN' | 'FULLY_PAID' | 'CANCELLED';
  createdAt: string;
}

export interface ClaimItemDTO {
  sessionToken: string;
  orderItemId: string;
  guestSessionId?: string;
  participantId?: string;
  expectedVersion: number;
}

export interface BillItemDTO {
  id: string;
  orderId: string;
  menuItemId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  modifiersPriceCents: number;
  lineTotalCents: number;
  participantId?: string | null;
  participantName?: string | null;
  claimedByParticipantId?: string | null;
  claimVersion: number;
  orderStatus: string;
}

export interface EqualPartSplitDTO {
  part: number;
  totalParts: number;
  amountCents: number;
}

export interface SettledPaymentDTO {
  id: string;
  amountCents: number;
  tipCents: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  idempotencyKey: string;
}

export interface TableBillDTO {
  tableId: string;
  sessionId: string;
  currency: 'ARS';
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  status: 'OPEN' | 'PAID';
  ordersCount: number;
  itemsCount: number;
  items: BillItemDTO[];
  settledPayments: SettledPaymentDTO[];
  equalParts: EqualPartSplitDTO[];
}

export interface ManualPaymentRequestDTO {
  tableId: string;
  amountCents: number;
  paymentMethod: 'WAITER_CASH' | 'WAITER_CARD' | 'WAITER_MP_QR' | string;
  tipCents?: number;
  idempotencyKey?: string;
  participantId?: string;
}

export interface PaymentTransactionDTO {
  id: string;
  orderId: string;
  tableSessionId: string;
  guestSessionId: string;
  method: string;
  amount: number;
  tipAmount: number;
  applicationFee?: number | null;
  mpPaymentId?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REFUNDED';
  idempotencyKey: string;
  createdAt: string;
}

// ==========================================
// FILA VIRTUAL (SMART WAITLIST)
// ==========================================

export enum WaitlistStatus {
  WAITING = 'WAITING',
  CALLED = 'CALLED',
  SEATED = 'SEATED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW'
}

export interface WaitlistEntryDTO {
  id: string;
  restaurantId: string;
  guestName: string;
  partySize: number;
  phone?: string | null;
  status: WaitlistStatus;
  preOrderData?: { menuItemId: string; quantity: number; notes?: string }[] | null;
  estimatedWaitMinutes?: number | null;
  positionInQueue?: number;
  calledAt?: string | null;
  seatedAt?: string | null;
  createdAt: string;
}

export interface JoinWaitlistDTO {
  restaurantSlug: string;
  guestName: string;
  partySize: number;
  phone: string;
  preOrderData?: { menuItemId: string; quantity: number; notes?: string }[];
  consent?: boolean;
}

// ==========================================
// FIDELIZACIÓN (REWARDS)
// ==========================================

export interface CustomerLoyaltyDTO {
  id: string;
  restaurantId: string;
  phone: string;
  points: number;
  verifiedAt?: string | null;
}

export interface RewardItemDTO {
  id: string;
  restaurantId: string;
  name: string;
  description?: string | null;
  pointsCost: number;
  isAvailable: boolean;
}

// ==========================================
// UTILIDADES DE ENRUTAMIENTO Y URLS DE MESAS
// ==========================================

export enum ApiErrorCode {
  GPS_REQUIRED = 'GPS_REQUIRED',
  GEOFENCE_EXCEEDED = 'GEOFENCE_EXCEEDED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_CLOSED = 'SESSION_CLOSED',
  ACTIVE_CALL_EXISTS = 'ACTIVE_CALL_EXISTS',
  RESTAURANT_NOT_FOUND = 'RESTAURANT_NOT_FOUND',
  TABLE_NOT_FOUND = 'TABLE_NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_PAYMENT_METHOD = 'INVALID_PAYMENT_METHOD'
}

export interface ApiErrorResponse {
  error: string;
  code?: ApiErrorCode | string;
  statusCode: number;
  details?: any;
}

export interface ParsedTableUrl {
  restaurantSlug?: string;
  tableLabel?: string;
  token?: string;
}

/**
 * Parsea de forma unificada cualquier URL o pathname de comensal:
 * - /r/:slug/mesa/:label
 * - /mesa/:label?token=...
 * - /?r=:slug&m=:label
 * - /?token=...
 */
export function parseTableUrl(inputUrl: string): ParsedTableUrl {
  const result: ParsedTableUrl = {};
  if (!inputUrl) return result;

  try {
    let pathname = '';
    let search = '';

    if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
      const parsed = new URL(inputUrl);
      pathname = decodeURIComponent(parsed.pathname);
      search = parsed.search;
    } else {
      const parts = inputUrl.split('?');
      pathname = decodeURIComponent(parts[0] || '');
      search = parts[1] ? `?${parts[1]}` : '';
    }

    // 1. Check Query Params
    if (search) {
      const q = new URLSearchParams(search);
      if (q.get('token')) result.token = q.get('token')!;
      if (q.get('r') || q.get('restaurante')) result.restaurantSlug = (q.get('r') || q.get('restaurante'))!;
      if (q.get('m') || q.get('mesa')) result.tableLabel = (q.get('m') || q.get('mesa'))!;
    }

    // 2. Check Pathname: /r/:slug/mesa/:label
    const rMatch = pathname.match(/\/r\/([^\/]+)\/mesa\/([^\/]+)/i);
    if (rMatch) {
      if (!result.restaurantSlug) result.restaurantSlug = rMatch[1];
      if (!result.tableLabel) result.tableLabel = rMatch[2];
    } else {
      // /mesa/:label
      const mMatch = pathname.match(/\/mesa\/([^\/]+)/i);
      if (mMatch && !result.tableLabel) {
        result.tableLabel = mMatch[1];
      }
    }
  } catch (_) {}

  return result;
}

// ==========================================
// RTMS (REAL-TIME TABLE MANAGEMENT SYSTEM)
// ==========================================
export * from './rtms-types';
export * from './fsm';
export * from './rtms-schemas';

// ==========================================
// POLLING COORDINATOR (Etapa 18)
// ==========================================
export * from './polling-coordinator';

// ==========================================
// SEGURIDAD Y SANITIZACIÓN CONTEXTUAL (Etapa 19)
// ==========================================
export * from './security';

// ==========================================
// VALIDACIÓN Y LIMITES DE IA (Etapa 20)
// ==========================================
export * from './ai-schemas';
