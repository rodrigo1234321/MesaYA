/**
 * MesaYA RTMS — Validation Schemas using Zod
 * Strict validation for all REST requests in Floor Plan & FSM
 */

import { z } from 'zod';
import { TableFSMState } from './rtms-types';

export const TableFSMStateSchema = z.nativeEnum(TableFSMState);

export const TableShapeSchema = z.enum(['RECT', 'ROUND', 'SQUARE', 'BOOTH']);

export const TapStateRequestSchema = z.object({
  action: z.enum(['next', 'skip_to', 'revert']),
  targetState: TableFSMStateSchema.optional(),
  expectedCurrentState: TableFSMStateSchema.optional(),
  staffUserId: z.string().optional(),
  note: z.string().max(255).optional()
}).refine(
  (data) => {
    if (data.action === 'skip_to' && !data.targetState) {
      return false;
    }
    return true;
  },
  {
    message: "targetState is required when action is 'skip_to'",
    path: ['targetState']
  }
);

export const FloorPlanTableItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  sector: z.string().optional(),
  isOutdoor: z.boolean().optional(),
  posX: z.number(),
  posY: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  rotation: z.number().min(0).max(360).optional(),
  shape: TableShapeSchema.optional(),
  floorZoneId: z.string().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  mergedWithTableId: z.string().nullable().optional()
});

export const FloorPlanUpdateSchema = z.object({
  canvasWidth: z.number().int().positive().optional(),
  canvasHeight: z.number().int().positive().optional(),
  gridSize: z.number().int().positive().optional(),
  backgroundUrl: z.string().url().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  confirmEmptyTables: z.boolean().optional(),
  tables: z.array(FloorPlanTableItemSchema)
}).superRefine((data, ctx) => {
  const seenIds = new Set<string>();
  for (const t of data.tables) {
    if (seenIds.has(t.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ID de mesa duplicado en payload: '${t.id}'`, path: ['tables'] });
      break;
    }
    seenIds.add(t.id);
  }
  const seenLabels = new Set<string>();
  for (const t of data.tables) {
    if (t.label === undefined) continue;
    if (seenLabels.has(t.label)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Etiqueta de mesa duplicada en payload: '${t.label}'`, path: ['tables'] });
      break;
    }
    seenLabels.add(t.label);
  }
  for (const t of data.tables) {
    if (t.mergedWithTableId !== undefined && t.mergedWithTableId !== null && t.mergedWithTableId === t.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La mesa '${t.id}' no puede combinarse consigo misma`, path: ['tables'] });
      break;
    }
    if (t.floorZoneId !== undefined && t.floorZoneId !== null && t.floorZoneId.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Zona inválida en mesa '${t.id}'`, path: ['tables'] });
      break;
    }
  }
});

export const PolygonPointSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const ZoneCreateSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (#RRGGBB)').optional(),
  orderIndex: z.number().int().optional(),
  polygonPoints: z.array(PolygonPointSchema).optional()
});

export const ZoneUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (#RRGGBB)').optional(),
  orderIndex: z.number().int().optional(),
  polygonPoints: z.array(PolygonPointSchema).optional()
});

export const TablePositionUpdateSchema = z.object({
  posX: z.number(),
  posY: z.number(),
  rotation: z.number().min(0).max(360).optional(),
  floorZoneId: z.string().nullable().optional(),
  expectedVersion: z.number().int().nonnegative()
});
