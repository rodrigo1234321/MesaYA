/**
 * MesaYA RTMS — Finite State Machine (FSM) Engine Specifications
 * Core operational rules for 8-state Zero-Hardware Table Management
 */

import { TableFSMState, SignalSource } from './rtms-types';

/**
 * Priority values for signal arbitration
 */
export const SIGNAL_PRIORITY: Record<SignalSource, number> = {
  [SignalSource.SYSTEM_TIMEOUT]: 10,
  [SignalSource.CUSTOMER_QR]: 20,
  [SignalSource.CUSTOMER_NFC]: 25,
  [SignalSource.CUSTOMER_APP]: 30,
  [SignalSource.CASHIER_CHECKOUT]: 40,
  [SignalSource.STAFF_TERMINAL_TAP]: 50,
  [SignalSource.MANAGER_OVERRIDE]: 100
};

/**
 * Inmutable transition matrix for the 8 table states.
 * Defines all permitted state transitions in regular operation.
 */
export const TRANSITION_MATRIX: Record<TableFSMState, readonly TableFSMState[]> = Object.freeze({
  [TableFSMState.AVAILABLE]: Object.freeze([
    TableFSMState.RESERVED,
    TableFSMState.OCCUPIED_NO_ORDER
  ]),
  [TableFSMState.RESERVED]: Object.freeze([
    TableFSMState.OCCUPIED_NO_ORDER,
    TableFSMState.AVAILABLE // No-show or cancel
  ]),
  [TableFSMState.OCCUPIED_NO_ORDER]: Object.freeze([
    TableFSMState.ORDER_IN_KITCHEN,
    TableFSMState.EATING, // Direct food served without POS integration
    TableFSMState.BILL_REQUESTED, // Customer requests bill directly (drinks, quick coffee, cash desk)
    TableFSMState.TO_CLEAN, // Walkout / abandoned
    TableFSMState.AVAILABLE // False tap cancel
  ]),
  [TableFSMState.ORDER_IN_KITCHEN]: Object.freeze([
    TableFSMState.EATING,
    TableFSMState.BILL_REQUESTED,
    TableFSMState.TO_CLEAN,
    TableFSMState.AVAILABLE // Order canceled
  ]),
  [TableFSMState.EATING]: Object.freeze([
    TableFSMState.ORDER_IN_KITCHEN, // Second rounds, desserts, coffee
    TableFSMState.BILL_REQUESTED,
    TableFSMState.PAID,      // Direct cashier payment
    TableFSMState.TO_CLEAN   // Fast table turnover 1-tap
  ]),
  [TableFSMState.BILL_REQUESTED]: Object.freeze([
    TableFSMState.PAID,
    TableFSMState.TO_CLEAN, // Direct table clearing after cash payment
    TableFSMState.EATING    // Customer continues ordering
  ]),
  [TableFSMState.PAID]: Object.freeze([
    TableFSMState.TO_CLEAN,
    TableFSMState.AVAILABLE, // Direct clean release
    TableFSMState.EATING     // Payment reversal / reopened session
  ]),
  [TableFSMState.TO_CLEAN]: Object.freeze([
    TableFSMState.AVAILABLE,
    TableFSMState.OCCUPIED_NO_ORDER // Immediate seating before explicit clean tap
  ])
});

/**
 * Validates whether transitioning from state `from` to state `to` is permitted.
 */
export function isValidTransition(
  from: TableFSMState,
  to: TableFSMState,
  isOverride = false
): boolean {
  if (from === to) return true;
  if (isOverride) return true; // MANAGER_OVERRIDE can force any transition

  const allowed = TRANSITION_MATRIX[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Provides the optimal next state for the 1-Tap shared tablet action.
 * Reduces staff interaction time to under 1 second.
 */
export function getNextState(current: TableFSMState): TableFSMState {
  switch (current) {
    case TableFSMState.AVAILABLE:
      return TableFSMState.OCCUPIED_NO_ORDER;
    case TableFSMState.RESERVED:
      return TableFSMState.OCCUPIED_NO_ORDER;
    case TableFSMState.OCCUPIED_NO_ORDER:
      return TableFSMState.ORDER_IN_KITCHEN;
    case TableFSMState.ORDER_IN_KITCHEN:
      return TableFSMState.EATING;
    case TableFSMState.EATING:
      return TableFSMState.TO_CLEAN;
    case TableFSMState.BILL_REQUESTED:
      return TableFSMState.TO_CLEAN;
    case TableFSMState.PAID:
      return TableFSMState.TO_CLEAN;
    case TableFSMState.TO_CLEAN:
      return TableFSMState.AVAILABLE;
    default:
      return TableFSMState.AVAILABLE;
  }
}

/**
 * Resolves concurrency conflicts when two sources attempt conflicting updates.
 * Higher numerical priority wins.
 */
export function resolveConflict(signalA: SignalSource, signalB: SignalSource): SignalSource {
  const priorityA = SIGNAL_PRIORITY[signalA] ?? 0;
  const priorityB = SIGNAL_PRIORITY[signalB] ?? 0;
  return priorityA >= priorityB ? signalA : signalB;
}

// ─── UI & Visual Language Constants ─────────────────────────────────

export interface StateVisualConfig {
  hex: string;
  tailwindBg: string;
  tailwindText: string;
  tailwindBorder: string;
  badgeBg: string;
}

export const STATE_COLORS: Record<TableFSMState, StateVisualConfig> = Object.freeze({
  [TableFSMState.AVAILABLE]: {
    hex: '#22c55e',
    tailwindBg: 'bg-emerald-500',
    tailwindText: 'text-emerald-400',
    tailwindBorder: 'border-emerald-500/40',
    badgeBg: 'bg-emerald-500/10'
  },
  [TableFSMState.RESERVED]: {
    hex: '#3b82f6',
    tailwindBg: 'bg-blue-500',
    tailwindText: 'text-blue-400',
    tailwindBorder: 'border-blue-500/40',
    badgeBg: 'bg-blue-500/10'
  },
  [TableFSMState.OCCUPIED_NO_ORDER]: {
    hex: '#eab308',
    tailwindBg: 'bg-amber-400',
    tailwindText: 'text-amber-300',
    tailwindBorder: 'border-amber-400/40',
    badgeBg: 'bg-amber-400/10'
  },
  [TableFSMState.ORDER_IN_KITCHEN]: {
    hex: '#f97316',
    tailwindBg: 'bg-orange-500',
    tailwindText: 'text-orange-400',
    tailwindBorder: 'border-orange-500/40',
    badgeBg: 'bg-orange-500/10'
  },
  [TableFSMState.EATING]: {
    hex: '#ef4444',
    tailwindBg: 'bg-rose-500',
    tailwindText: 'text-rose-400',
    tailwindBorder: 'border-rose-500/40',
    badgeBg: 'bg-rose-500/10'
  },
  [TableFSMState.BILL_REQUESTED]: {
    hex: '#a855f7',
    tailwindBg: 'bg-purple-500',
    tailwindText: 'text-purple-300',
    tailwindBorder: 'border-purple-500/40',
    badgeBg: 'bg-purple-500/10'
  },
  [TableFSMState.PAID]: {
    hex: '#6b7280',
    tailwindBg: 'bg-slate-500',
    tailwindText: 'text-slate-300',
    tailwindBorder: 'border-slate-500/40',
    badgeBg: 'bg-slate-500/10'
  },
  [TableFSMState.TO_CLEAN]: {
    hex: '#92400e',
    tailwindBg: 'bg-amber-800',
    tailwindText: 'text-amber-400',
    tailwindBorder: 'border-amber-700/50',
    badgeBg: 'bg-amber-900/30'
  }
});

export const STATE_LABELS: Record<TableFSMState, string> = Object.freeze({
  [TableFSMState.AVAILABLE]: 'Disponible',
  [TableFSMState.RESERVED]: 'Reservada',
  [TableFSMState.OCCUPIED_NO_ORDER]: 'Sentados (Sin Pedir)',
  [TableFSMState.ORDER_IN_KITCHEN]: 'En Cocina',
  [TableFSMState.EATING]: 'Comiendo / Servido',
  [TableFSMState.BILL_REQUESTED]: 'Cuenta Pedida',
  [TableFSMState.PAID]: 'Cobrado',
  [TableFSMState.TO_CLEAN]: 'Por Limpiar'
});

export const STATE_EMOJIS: Record<TableFSMState, string> = Object.freeze({
  [TableFSMState.AVAILABLE]: '🟢',
  [TableFSMState.RESERVED]: '🔵',
  [TableFSMState.OCCUPIED_NO_ORDER]: '🟡',
  [TableFSMState.ORDER_IN_KITCHEN]: '🟠',
  [TableFSMState.EATING]: '🔴',
  [TableFSMState.BILL_REQUESTED]: '🟣',
  [TableFSMState.PAID]: '⚪',
  [TableFSMState.TO_CLEAN]: '🟤'
});

export const NEXT_STATE_BUTTON_LABELS: Record<TableFSMState, string> = Object.freeze({
  [TableFSMState.AVAILABLE]: 'Asignar Mesa',
  [TableFSMState.RESERVED]: 'Confirmar Llegada',
  [TableFSMState.OCCUPIED_NO_ORDER]: 'Comanda a Cocina',
  [TableFSMState.ORDER_IN_KITCHEN]: 'Marcar Servido',
  [TableFSMState.EATING]: 'Cobrar y Liberar',
  [TableFSMState.BILL_REQUESTED]: 'Confirmar Cobro',
  [TableFSMState.PAID]: 'Mesa Libre (Por Limpiar)',
  [TableFSMState.TO_CLEAN]: 'Mesa Limpia ✓'
});
