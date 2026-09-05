/**
 * MesaYA RTMS (Real-Time Table Management System) — Core Types & Enums
 * Architecture: Zero-Hardware (NFC/QR passive + Shared Salon Tablet + SSE)
 */

export enum TableFSMState {
  AVAILABLE = 'AVAILABLE',                 // S0: Mesa limpia y lista (#22c55e)
  RESERVED = 'RESERVED',                   // S1: Bloqueada para reserva (#3b82f6)
  OCCUPIED_NO_ORDER = 'OCCUPIED_NO_ORDER', // S2: Sentados sin pedir (#eab308)
  ORDER_IN_KITCHEN = 'ORDER_IN_KITCHEN',   // S3: Pedido en cocina (#f97316)
  EATING = 'EATING',                       // S4: Platos servidos (#ef4444)
  BILL_REQUESTED = 'BILL_REQUESTED',       // S5: Cuenta solicitada (#a855f7)
  PAID = 'PAID',                           // S6: Cobrado / comensales sentados (#6b7280)
  TO_CLEAN = 'TO_CLEAN'                    // S7: Mesa desocupada por limpiar (#92400e)
}

export enum SignalSource {
  SYSTEM_TIMEOUT = 'SYSTEM_TIMEOUT',         // Priority 10: Timer automático
  CUSTOMER_QR = 'CUSTOMER_QR',               // Priority 20: Escaneo QR pasivo
  CUSTOMER_NFC = 'CUSTOMER_NFC',             // Priority 25: Tap NFC pasivo
  CUSTOMER_APP = 'CUSTOMER_APP',             // Priority 30: Acciones cliente in-app
  CASHIER_CHECKOUT = 'CASHIER_CHECKOUT',     // Priority 40: Pago confirmado en caja
  STAFF_TERMINAL_TAP = 'STAFF_TERMINAL_TAP', // Priority 50: 1-tap en tablet central de salón
  MANAGER_OVERRIDE = 'MANAGER_OVERRIDE'      // Priority 100: Override administrativo forzado
}

export type TableShape = 'RECT' | 'ROUND' | 'SQUARE' | 'BOOTH';

export interface FloorTableDTO {
  id: string;
  restaurantId: string;
  label: string;
  sector: string;
  isOutdoor: boolean;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: TableShape;
  capacity: number;
  floorZoneId: string | null;
  zoneName?: string | null;
  currentState: TableFSMState;
  stateChangedAt: string;
  stateColor: string;
  stateEmoji: string;
  occupancyMinutes: number | null;
  activeCall?: {
    id: string;
    type: string;
    paymentMethod: string;
    createdAt: string;
  } | null;
  activeSessionToken?: string | null;
  mergedWithLabel?: string | null;
  mergedWithTableId?: string | null;
}

export interface FloorZoneDTO {
  id: string;
  restaurantId: string;
  name: string;
  color: string;
  orderIndex: number;
  polygonPoints: { x: number; y: number }[];
}

export interface FloorLayoutDTO {
  id: string;
  restaurantId: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  backgroundUrl: string | null;
  isActive: boolean;
  version: number;
}

export interface FloorPlanResponseDTO {
  layout: FloorLayoutDTO;
  zones: FloorZoneDTO[];
  tables: FloorTableDTO[];
  stats: {
    totalTables: number;
    availableCount: number;
    occupiedCount: number;
    billRequestedCount: number;
    toCleanCount: number;
    occupancyRatePercentage: number;
  };
}

export interface TableStateChangedEvent {
  tableId: string;
  tableLabel: string;
  restaurantId: string;
  floorZoneId: string | null;
  zoneName: string | null;
  previousState: TableFSMState;
  newState: TableFSMState;
  stateColor: string;
  stateEmoji: string;
  trigger: string;
  source: SignalSource;
  staffUserId: string | null;
  staffName: string | null;
  occupancyMinutes: number | null;
  activeCall: {
    id: string;
    type: string;
    paymentMethod: string;
  } | null;
  timestamp: string;
}

export interface OccupancyCompletedEvent {
  tableId: string;
  tableLabel: string;
  restaurantId: string;
  session: {
    id: string;
    partySize: number | null;
    seatedAt: string;
    orderedAt: string | null;
    servedAt: string | null;
    billAt: string | null;
    paidAt: string | null;
    vacatedAt: string | null;
    cleanedAt: string;
    totalRevenue: number | null;
    durationMinutes: number | null;
    turnTimeMinutes: number | null;
    phases: {
      timeToOrderMinutes: number | null;
      timeToServeMinutes: number | null;
      dwellAfterPayMinutes: number | null;
    };
  };
  timestamp: string;
}

export type TapActionType = 'next' | 'skip_to' | 'revert';

export interface TapStateRequest {
  action: TapActionType;
  targetState?: TableFSMState;
  expectedCurrentState?: TableFSMState;
  staffUserId?: string;
  note?: string;
}

export interface TapStateResponse {
  success: boolean;
  tableId: string;
  previousState: TableFSMState;
  newState: TableFSMState;
  source: SignalSource;
  stateEventId: string;
  timestamp: string;
  message: string;
}

export interface FloorPlanUpdateItem {
  id: string;
  label?: string;
  sector?: string;
  isOutdoor?: boolean;
  posX: number;
  posY: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: TableShape;
  floorZoneId?: string | null;
  capacity?: number;
  mergedWithTableId?: string | null;
}

export interface FloorPlanUpdateDTO {
  canvasWidth?: number;
  canvasHeight?: number;
  gridSize?: number;
  backgroundUrl?: string | null;
  expectedVersion?: number;
  confirmEmptyTables?: boolean;
  tables: FloorPlanUpdateItem[];
}

export interface ZoneCreateDTO {
  name: string;
  color?: string;
  orderIndex?: number;
  polygonPoints?: { x: number; y: number }[];
}

export interface ZoneUpdateDTO {
  name?: string;
  color?: string;
  orderIndex?: number;
  polygonPoints?: { x: number; y: number }[];
}

export interface TablePositionUpdateDTO {
  posX: number;
  posY: number;
  rotation?: number;
  floorZoneId?: string | null;
  expectedVersion: number;
}

// ==========================================
// CAPA 3: ANALYTICS & REVPASH METRICS
// ==========================================

export interface RTMSAnalyticsSummaryDTO {
  restaurantId: string;
  restaurantName: string;
  period: {
    from: string;
    to: string;
    operatingHours: number;
  };
  totalSessions: number;
  totalRevenue: number;
  totalSeats: number;
  totalSeatHours: number;
  revPASH: number; // Revenue Per Available Seat Hour
  averageTurnTimeMinutes: number;
  averageDurationMinutes: number;
  occupancyRatePercentage: number;
  turnsPerTableAverage: number;
}

export interface PhaseMetricsDTO {
  timeToOrderAvgMinutes: number; // Seated -> Ordered
  kitchenPrepAvgMinutes: number; // Ordered -> Served
  eatingDwellAvgMinutes: number; // Served -> Bill Requested
  paymentToVacateAvgMinutes: number; // Bill/Paid -> Vacated (sobremesa)
  cleaningTurnaroundAvgMinutes: number; // Vacated -> Cleaned/Available
}

export interface HeatmapHourCellDTO {
  dayOfWeek: number; // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  dayLabel: string;
  hour: number; // 0..23
  occupancyPercentage: number;
  sessionsCount: number;
  revenue: number;
}

export interface TablePerformanceDTO {
  tableId: string;
  label: string;
  shape: TableShape;
  capacity: number;
  zoneName: string | null;
  totalTurns: number;
  totalRevenue: number;
  averageTurnTimeMinutes: number;
  revPASH: number;
  utilizationPercentage: number;
}
