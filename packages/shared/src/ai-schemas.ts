import { z } from 'zod';

export const MenuTemplateIdSchema = z.enum([
  'GOURMET_OBSIDIAN',
  'NEON_BURGER',
  'COASTAL_BEACH',
  'MINIMAL_BISTRO',
  'FAUNO_NIGHT'
]);

/**
 * Schema para validar la entrada de generación de carta con IA.
 * Aplica límites estrictos de longitud y formato.
 */
export const AiMenuGenerateInputSchema = z.object({
  prompt: z.string().trim().min(3, 'El prompt debe tener al menos 3 caracteres').max(500, 'El prompt no puede superar 500 caracteres').optional(),
  concept: z.string().trim().min(3).max(500).optional(),
  templateId: MenuTemplateIdSchema.optional(),
  autoApply: z.boolean().optional(),
  gastronomyType: z.string().max(50).optional()
}).refine(
  (data) => Boolean((data.prompt && data.prompt.trim()) || (data.concept && data.concept.trim())),
  { message: 'Se requiere un prompt o concepto de al menos 3 caracteres' }
);

export type AiMenuGenerateInput = z.infer<typeof AiMenuGenerateInputSchema>;

/**
 * Schema para validar cada plato generado por el modelo de IA.
 */
export const AiMenuItemOutputSchema = z.object({
  name: z.string().min(1, 'El nombre del plato es obligatorio').max(80, 'Nombre demasiado largo'),
  description: z.string().max(300, 'Descripción demasiado larga').optional().nullable(),
  price: z.number().positive('El precio debe ser positivo').max(1_000_000, 'Precio excede el límite razonable'),
  imageUrl: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional().default([]),
  isFeatured: z.boolean().optional().default(false)
});

export type AiMenuItemOutput = z.infer<typeof AiMenuItemOutputSchema>;

/**
 * Schema para validar cada categoría generada por el modelo de IA.
 */
export const AiMenuCategoryOutputSchema = z.object({
  name: z.string().min(1, 'El nombre de la categoría es obligatorio').max(60, 'Nombre de categoría demasiado largo'),
  icon: z.string().max(10).optional().default('🍽️'),
  items: z.array(AiMenuItemOutputSchema).min(1, 'Debe contener al menos 1 plato').max(15, 'Máximo 15 platos por categoría')
});

export type AiMenuCategoryOutput = z.infer<typeof AiMenuCategoryOutputSchema>;

/**
 * Schema de salida de generación de carta de IA.
 * Límite estricto de máximo 10 categorías y valores seguros por defecto.
 */
export const AiMenuGenerateOutputSchema = z.object({
  suggestedTemplateId: MenuTemplateIdSchema.catch('GOURMET_OBSIDIAN'),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal inválido').catch('#f59e0b'),
  categories: z.array(AiMenuCategoryOutputSchema).min(1, 'Debe incluir al menos una categoría').max(10, 'Máximo 10 categorías')
});

export type AiMenuGenerateOutput = z.infer<typeof AiMenuGenerateOutputSchema>;

/**
 * Schema de entrada para consulta al Sommelier IA.
 * Exige consulta acotada y sessionToken para garantizar mesa operativa.
 */
export const AiSommelierInputSchema = z.object({
  query: z.string().trim().min(3, 'La consulta debe tener al menos 3 caracteres').max(300, 'La consulta no puede superar 300 caracteres'),
  sessionToken: z.string().trim().min(1, 'Token de sesión de mesa requerido').max(256)
});

export type AiSommelierInput = z.infer<typeof AiSommelierInputSchema>;

/**
 * Schema de salida devuelto por el modelo para el Sommelier IA.
 */
export const AiSommelierOutputSchema = z.object({
  answer: z.string().min(1, 'La respuesta no puede estar vacía').max(500, 'Respuesta demasiado extensa'),
  recommendedDishIds: z.array(z.string().min(1).max(128)).max(5, 'Máximo 5 platos recomendados'),
  suggestedPairing: z.string().max(150, 'Maridaje demasiado largo').optional().nullable()
});

export type AiSommelierOutput = z.infer<typeof AiSommelierOutputSchema>;

/**
 * Categorías canónicas de diagnóstico seguro de proveedor IA (E10).
 * No exponen cuerpos ni mensajes de error crudos del proveedor externo.
 */
export const AiDiagnosticCategory = {
  DISABLED: 'DISABLED',
  MISSING_KEY: 'MISSING_KEY',
  INVALID_KEY: 'INVALID_KEY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  BILLING_DISABLED: 'BILLING_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  READY: 'READY',
  NOT_PROBED: 'NOT_PROBED',
  // Alias de compatibilidad y contención
  SKIPPED: 'NOT_PROBED',
  BILLING_PRECONDITION: 'BILLING_DISABLED'
} as const;

export const AiDiagnosticCategorySchema = z.enum([
  'DISABLED',
  'MISSING_KEY',
  'INVALID_KEY',
  'PERMISSION_DENIED',
  'MODEL_NOT_FOUND',
  'INVALID_REQUEST',
  'BILLING_DISABLED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_RESPONSE',
  'READY',
  'NOT_PROBED'
]);

export type AiDiagnosticCategory = z.infer<typeof AiDiagnosticCategorySchema>;

export const AiKeySourceSchema = z.enum(['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'none']);
export type AiKeySource = z.infer<typeof AiKeySourceSchema>;

export const AiProbeResultSchema = z.object({
  category: AiDiagnosticCategorySchema,
  attemptedModel: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  checkedAt: z.string()
});

export type AiProbeResult = z.infer<typeof AiProbeResultSchema>;

export const AiDiagnosticsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('gemini'),
  keyConfigured: z.boolean(),
  keySource: AiKeySourceSchema,
  primaryModel: z.string(),
  fallbackModel: z.string().nullable(),
  usingDefaults: z.boolean(),
  timeoutMs: z.number().positive(),
  fallbackLocalAvailable: z.boolean(),
  probe: AiProbeResultSchema.nullable().optional()
});

export type AiDiagnosticsDTO = z.infer<typeof AiDiagnosticsSchema>;
