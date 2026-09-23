import type { FloorPlanResponseDTO } from './rtms-types';

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
  CARD_DEBIT = 'CARD_DEBIT',
  CARD_CREDIT = 'CARD_CREDIT',
  NOT_APPLICABLE = 'NOT_APPLICABLE'
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Efectivo',
  [PaymentMethod.MERCADO_PAGO]: 'Mercado Pago (QR)',
  [PaymentMethod.CARD]: 'Tarjeta (Débito/Crédito)',
  [PaymentMethod.CARD_DEBIT]: 'Tarjeta Débito',
  [PaymentMethod.CARD_CREDIT]: 'Tarjeta Crédito',
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
  code?: string;
  details?: any;
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
    /** Propina que el comensal eligió al pedir la cuenta, en centavos. */
    tipMinor?: number;
    note?: string | null;
    status: CallStatus;
    createdAt: string;
  } | null;
  activeCalls?: Array<{
    id: string;
    type: CallType;
    paymentMethod: PaymentMethod;
    /** Propina que el comensal eligió al pedir la cuenta, en centavos. */
    tipMinor?: number;
    note?: string | null;
    status: CallStatus;
    createdAt: string;
  }>;
  expiresAt?: string;
}

export interface CreateCallDTO {
  sessionToken: string;
  type: CallType;
  paymentMethod?: PaymentMethod;
  /** Propina elegida por el comensal para el cobro, en centavos. */
  tipMinor?: number;
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
  /** Propina elegida por el comensal para el cobro, en centavos. */
  tipMinor?: number;
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
  /** Identificador del terminal físico compartido; nunca es un secreto. */
  terminalId?: string;
  isTemporary?: boolean;
  purpose?: string;
  tableId?: string;
  sessionId?: string;
}

export interface StaffUserDTO {
  id: string;
  name: string;
  role: string;
  assignedSector?: Sector | null;
  restaurantId: string;
  restaurantName: string;
}

/**
 * Proyección operativa del terminal compartido (S02).
 * Los identificadores de tarea son estables y no exponen tokens de sesión.
 */
export type ServiceTaskKind =
  | 'CALL'
  | 'ORDER_VALIDATION'
  | 'ORDER_PREPARATION'
  | 'ORDER_DELIVERY'
  | 'ACCOUNT_COLLECTION'
  | 'TABLE_CLEANUP';

export type ServiceTaskAction =
  | 'CLAIM'
  | 'VALIDATE_ORDER'
  | 'MARK_READY'
  | 'SERVE_ORDER'
  | 'COLLECT_ACCOUNT'
  | 'MARK_CLEAN';

export type ServiceTaskIntention = 'COMPLETE' | 'REJECT' | 'UNDO';

/** Ventana corta y fija para deshacer una entrega (E09): 30 segundos. */
export const DELIVERY_UNDO_WINDOW_SECONDS = 30;

export interface ServiceTaskActDTO {
  action?: ServiceTaskIntention;
  reason?: string;
}

export interface ServiceTaskActResultDTO {
  success: boolean;
  taskKey: string;
  taskType: ServiceTaskKind;
  targetId: string;
  action: ServiceTaskIntention;
  status: string;
  idempotentReplay?: boolean;
}

export type OrderReviewReasonCode =
  | 'WAITER_VALIDATION_REQUIRED'
  | 'STOCK_UNAVAILABLE'
  | 'QUANTITY_THRESHOLD';

export interface ServiceTaskClaimDTO {
  id: string;
  taskKey: string;
  taskType: ServiceTaskKind;
  targetId: string;
  staffUserId: string;
  staffName?: string | null;
  terminalId?: string | null;
  claimedAt: string;
  status: 'ACTIVE' | 'RELEASED' | 'RESOLVED';
}

export type ServiceParticipantKind = 'GUEST' | 'STAFF' | 'WAITLIST' | 'UNKNOWN';

/**
 * Contexto legible para el personal. No contiene guestSessionId, staffUserId
 * ni ningún otro identificador técnico que deba llegar a la pantalla.
 */
export interface ServiceParticipantDTO {
  kind: ServiceParticipantKind;
  label: string;
}

export interface ServiceTaskItemDTO {
  itemId: string;
  name: string;
  quantity: number;
  notes: string | null;
  unitPriceMinor: number;
  lineTotalMinor: number;
  participant: ServiceParticipantDTO;
}

export interface ServiceReviewReasonDTO {
  code: OrderReviewReasonCode;
  label: string;
  detail?: string | null;
}

export interface ServiceTaskDTO {
  id: string;
  taskKey: string;
  kind: ServiceTaskKind;
  source: 'CALL_REQUEST' | 'ORDER' | 'TABLE_SESSION';
  targetId: string;
  tableId: string;
  tableLabel: string;
  sector: string;
  title: string;
  summary: string;
  status: string;
  priority: number;
  createdAt: string;
  ageSeconds: number;
  action: ServiceTaskAction;
  claim: ServiceTaskClaimDTO | null;
  payload: {
    callType?: CallType;
    callStatus?: CallStatus;
    /** Medio de pago que el comensal eligió al pedir la cuenta. */
    paymentMethod?: PaymentMethod;
    /** Propina elegida al pedir la cuenta, en centavos. */
    requestedTipMinor?: number;
    orderStatus?: string;
    itemCount?: number;
    totalMinor?: number;
    balanceMinor?: number;
    items?: ServiceTaskItemDTO[];
    participants?: ServiceParticipantDTO[];
    notes?: string[];
    /** Notas libres que mencionan una posible alergia/restricción declarada. */
    allergenNotes?: string[];
    reviewReason?: ServiceReviewReasonDTO;
  };
}

export interface ServiceAccountDTO {
  tableSessionId: string;
  tableId: string;
  tableLabel: string;
  sector: string;
  currentState: string;
  /** Último medio elegido para pedir la cuenta dentro de esta ocupación. */
  requestedPaymentMethod?: PaymentMethod;
  /** Última propina elegida para pedir la cuenta dentro de esta ocupación, en centavos. */
  requestedTipMinor?: number;
  /** Mozo que atendió/reclamó la cuenta por defecto o asignado. */
  responsibleStaffUserId?: string | null;
  /** Nombre visible del mozo responsable. */
  responsibleStaffName?: string | null;
  account: {
    version: string;
    consumoMinor: number;
    paidMinor: number;
    tipMinor: number;
    saldoMinor: number;
    pendingValidation: Array<{ orderId: string; totalMinor: number; createdAt: string; updatedAt: string }>;
    draft: { orderId: string; totalMinor: number; createdAt: string; updatedAt: string } | null;
    tandas: Array<{
      orderId: string;
      status: string;
      totalMinor: number;
      createdAt: string;
      updatedAt: string;
      items: Array<{ itemId: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
    }>;
  };
}

export type SettleSplitMode = 'FIXED' | 'PERCENTAGE' | 'EQUAL_PARTS';

export interface SplitOperation {
  mode: SettleSplitMode;
  amountMinor?: number;
  percentage?: number;
  parts?: number;
  partIndex?: number;
}

export interface ServiceWorkspaceDTO {
  restaurantId: string;
  generatedAt: string;
  staleAfterSeconds: number;
  floorPlan: FloorPlanResponseDTO;
  tasks: ServiceTaskDTO[];
  accounts: ServiceAccountDTO[];
  allowWaitersToCollectCash?: boolean;
  allowSplitBill?: boolean;
  summary: {
    totalTasks: number;
    pendingCalls: number;
    ordersToValidate: number;
    ordersInPreparation: number;
    ordersToDeliver: number;
    accountsToCollect: number;
    activeClaims: number;
  };
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
  /** Promedio real de rating 1–5; npsAverage se conserva por compatibilidad histórica. */
  ratingAverage?: number;
  ratingSampleSize?: number;
  avgResponseSampleSize?: number;
  npsSampleSize?: number;
  quality?: import('./rtms-types').AnalyticsQualityDTO;
  metrics?: Record<string, import('./rtms-types').AnalyticsMetricDTO>;
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
  categoryName?: string;
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
  MINIMAL_BISTRO = 'MINIMAL_BISTRO',
  FAUNO_NIGHT = 'FAUNO_NIGHT'
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
  },
  [MenuTemplateId.FAUNO_NIGHT]: {
    id: MenuTemplateId.FAUNO_NIGHT,
    name: 'Fauno Night Craft',
    tagline: 'Mitología cervecera, barra y platos abundantes',
    recommendedFor: 'Cervecerías artesanales, bares nocturnos y cartas para compartir',
    primaryColor: '#16c5df',
    accentGlow: 'rgba(22, 197, 223, 0.28)',
    bgClass: 'bg-[#071517] text-slate-100',
    cardClass: 'bg-[#0d2224]/95 border-cyan-400/30 shadow-cyan-950/30',
    fontFamily: 'Outfit, sans-serif',
    borderClass: 'border-cyan-400/35',
    previewGradient: 'from-cyan-950/70 via-[#10282a] to-[#071517]'
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
  isAvailable?: boolean;
  source?: string;
  externalId?: string;
}

export interface BatchMenuImportDTO {
  replaceExisting?: boolean;
  dryRun?: boolean;
  templateId?: MenuTemplateId;
  items: BatchMenuImportItem[];
}

export interface BatchMenuImportSummary {
  categoriesCreated: number;
  categoriesUpdated: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsDeactivated: number;
}

export interface BatchMenuImportResponseDTO {
  success: boolean;
  dryRun: boolean;
  message: string;
  categoriesCount: number;
  itemsCount: number;
  summary: BatchMenuImportSummary;
  warnings: string[];
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
  poweredBy?: 'gemini' | 'local-fallback';
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
  poweredBy?: 'gemini' | 'local-fallback';
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
  constraints?: {
    availableOnly: true;
    budgetMax?: number;
    dietaryIntent?: 'allergy' | 'gluten' | 'vegan' | 'vegetarian';
    pairing: 'catalog-aware' | 'generic-guidance' | 'abstained';
  };
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
  [PaymentMode.DIGITAL_MP]: 'Ofrecer Mercado Pago como opción (cobro presencial)',
  [PaymentMode.HYBRID]: 'Híbrido: informar Mercado Pago + medios presenciales'
};

export enum CapabilityState {
  AVAILABLE = 'AVAILABLE',
  PILOT_ONLY = 'PILOT_ONLY',
  COMING_SOON = 'COMING_SOON',
  MISCONFIGURED = 'MISCONFIGURED'
}

export const CAPABILITY_STATE_LABELS: Record<CapabilityState, string> = {
  [CapabilityState.AVAILABLE]: 'Disponible',
  // Se conserva el valor por compatibilidad con instalaciones anteriores;
  // las capacidades de la release actual usan AVAILABLE/COMING_SOON.
  [CapabilityState.PILOT_ONLY]: 'Restringida',
  [CapabilityState.COMING_SOON]: 'Próximamente',
  [CapabilityState.MISCONFIGURED]: 'Requiere Configuración'
};

export type CapabilityKey =
  | 'ordering'
  | 'waiter_validation'
  | 'manual_payment'
  | 'digital_payment'
  | 'waiter_cash_collection'
  | 'split_bill'
  | 'waitlist'
  | 'waitlist_preorder'
  | 'rewards'
  | 'upsell'
  | 'smart_tips'
  | 'reviews';

export interface CapabilityEntry {
  key: CapabilityKey;
  label?: string;
  state: CapabilityState;
  configuredEnabled: boolean;
  effectiveEnabled: boolean;
  /** Código estable para decisiones de interfaz y soporte. */
  reasonCode: string;
  /** Explicación breve para el panel administrativo. */
  message: string;
}

export interface RestaurantCapabilitiesDTO {
  restaurantId: string;
  capabilities: Record<CapabilityKey, CapabilityEntry>;
}

export interface RestaurantModuleConfigDTO {
  id: string;
  restaurantId: string;
  paymentMode: PaymentMode;
  allowSplitBill: boolean;
  allowWaitersToCollectCash: boolean;
  allowOrdering: boolean;
  /**
   * @deprecated El carrito colaborativo por TableSession es el comportamiento canónico permanente.
   * Este campo se mantiene por compatibilidad histórica de esquema/DTO y siempre retorna true.
   */
  syncSocialCart: boolean;
  requireWaiterValidation: boolean;
  /** Más de esta cantidad por línea genera revisión en modo automático. */
  reviewQuantityThreshold?: number;
  enableUpsell: boolean;
  enableSmartTips: boolean;
  suggestedTipPercentages: number[];
  enableReviews: boolean;
  googlePlaceId?: string | null;
  enableWaitlist: boolean;
  enableWaitlistPreOrder: boolean;
  enableRewards: boolean;
  pointsPerHundredPesos: number;
  /** Estado funcional calculado; no contiene credenciales ni secretos. */
  capabilities?: Record<CapabilityKey, CapabilityEntry>;
}

export interface UpdateModuleConfigDTO {
  paymentMode?: PaymentMode;
  allowSplitBill?: boolean;
  allowWaitersToCollectCash?: boolean;
  allowOrdering?: boolean;
  /**
   * @deprecated El carrito colaborativo es canónico por mesa; no se admiten modos individuales ficticios.
   */
  syncSocialCart?: boolean;
  requireWaiterValidation?: boolean;
  reviewQuantityThreshold?: number;
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

/** Valor inicial conservador: uno o dos productos iguales no interrumpen el flujo. */
export const DEFAULT_REVIEW_QUANTITY_THRESHOLD = 6;

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
  guestName?: string | null;
}

export interface OrderDTO {
  id: string;
  tableSessionId: string;
  status: OrderStatus;
  totalAmount: number;
  source?: 'GUEST_QR' | 'STAFF_TERMINAL' | 'WAITLIST' | string | null;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
  reviewReason?: ServiceReviewReasonDTO | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
}

export interface AddOrderItemDTO {
  sessionToken: string;
  guestSessionId: string;
  menuItemId: string;
  quantity: number;
  notes?: string;
  guestName?: string;
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
  guestSessionId: string;
  expectedVersion: number;
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
  consentAt?: string | null;
  verifiedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RewardItemDTO {
  id: string;
  restaurantId: string;
  name: string;
  description?: string | null;
  pointsCost: number;
  isAvailable: boolean;
}

export interface RewardLedgerEntryDTO {
  id: string;
  customerLoyaltyId: string;
  pointsDelta: number;
  balanceAfter: number;
  entryType: 'ACCRUAL' | 'REDEMPTION' | 'REVERSAL' | 'ADJUSTMENT' | 'EXPIRATION' | string;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  ruleVersion: string;
  idempotencyKey: string;
  approvedBy?: string | null;
  createdAt: string;
}

export interface RewardRedemptionDTO {
  id: string;
  customerLoyaltyId: string;
  rewardItemId: string;
  pointsCost: number;
  status: 'PENDING' | 'REDEEMED' | 'CANCELLED' | string;
  approvedBy?: string | null;
  redeemedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
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

// ==========================================
// VENTAS, COBROS Y REPORTES (Etapas 1–5)
// ==========================================
export * from './sales-types';

// ==========================================
// CONTRATOS CANÓNICOS DE DOMINIO (E01)
// ==========================================
export * from './contracts';
