import { prisma } from '../lib/prisma';
import {
  GenerateMenuAiDTO,
  GenerateMenuAiResponseDTO,
  MenuTemplateId,
  MenuItemDTO,
  SommelierResponseDTO,
  AiMenuGenerateInputSchema,
  AiMenuGenerateOutputSchema,
  AiSommelierInputSchema,
  AiSommelierOutputSchema,
  AiDiagnosticCategory,
  AiKeySource,
  AiProbeResult,
  AiDiagnosticsDTO,
  sanitizeUrl
} from '@mesaya/shared';

export class AiProviderError extends Error {
  readonly category: AiDiagnosticCategory;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(category: AiDiagnosticCategory, httpStatus: number | null, retryable: boolean) {
    super(`AI_PROVIDER_ERROR_${category}`);
    this.name = 'AiProviderError';
    this.category = category;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export type SommelierCulinaryIntent =
  | 'beer_or_drinks'
  | 'sharing_or_couple'
  | 'pastas'
  | 'carnes'
  | 'pescados_mariscos'
  | 'postres'
  | 'budget_generic'
  | 'general_recommendation'
  | 'off_topic'
  | 'unclear';


function resolveAiKeyInfo(): { apiKey: string | null; source: AiKeySource } {
  // Preferir GOOGLE_API_KEY sobre GEMINI_API_KEY por documentación oficial.
  // Claves de Notion nunca deben enviarse como credencial a otro proveedor.
  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  if (googleKey && googleKey.length > 0) {
    return { apiKey: googleKey, source: 'GOOGLE_API_KEY' };
  }
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey.length > 0) {
    return { apiKey: geminiKey, source: 'GEMINI_API_KEY' };
  }
  return { apiKey: null, source: 'none' };
}

export class AIService {
  static readonly DEFAULT_PRIMARY_MODEL = 'gemini-3.8-flash';
  static readonly DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
  private static readonly MAX_AI_ATTEMPTS = 2;
  private static readonly MAX_RESPONSE_BYTES = 256 * 1024;
  private static readonly MAX_ERROR_RESPONSE_BYTES = 8 * 1024;

  private static readonly ALLOWLISTED_RPC_STATUSES = new Set([
    'INVALID_ARGUMENT',
    'FAILED_PRECONDITION',
    'UNAUTHENTICATED',
    'PERMISSION_DENIED',
    'NOT_FOUND',
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'INTERNAL',
    'UNIMPLEMENTED'
  ]);

  private static readonly ALLOWLISTED_REASONS = new Set([
    'RATE_LIMIT_EXCEEDED',
    'QUOTA_EXCEEDED',
    'BILLING_DISABLED',
    'API_KEY_INVALID',
    'ACCESS_TOKEN_EXPIRED'
  ]);

  private static getAiTimeoutMs(): number {
    const configured = Number(process.env.AI_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(Math.max(Math.floor(configured), 1), 30_000)
      : 8000;
  }

  private static getModels(): string[] {
    const primary = process.env.GEMINI_MODEL?.trim() || this.DEFAULT_PRIMARY_MODEL;
    const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim() || this.DEFAULT_FALLBACK_MODEL;
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(primary)) return [];
    return [...new Set([primary, fallback])]
      .filter((model): model is string => !!model && /^[a-zA-Z0-9._-]{1,128}$/.test(model))
      .slice(0, this.MAX_AI_ATTEMPTS);
  }

  private static async readBoundedJson<T = any>(
    response: any,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<T> {
    if (!response || !response.body || typeof response.body.getReader !== 'function') {
      throw new AiProviderError(AiDiagnosticCategory.INVALID_RESPONSE, response?.status ?? null, false);
    }

    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > maxBytes) {
      await response.body?.cancel?.().catch?.(() => undefined);
      throw new AiProviderError(AiDiagnosticCategory.INVALID_RESPONSE, response?.status ?? null, false);
    }

    if (signal?.aborted) {
      await response.body?.cancel?.().catch?.(() => undefined);
      throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
    }

    const reader = response.body.getReader();
    const abortHandler = () => {
      void reader.cancel?.().catch?.(() => undefined);
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const decoder = new TextDecoder();
    let size = 0;
    let text = '';

    try {
      while (true) {
        if (signal?.aborted) {
          throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
        }
        const chunk = await reader.read();
        if (signal?.aborted) {
          throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
        }
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel?.().catch?.(() => undefined);
          throw new AiProviderError(AiDiagnosticCategory.INVALID_RESPONSE, response?.status ?? null, false);
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch (err: any) {
      await reader.cancel?.().catch?.(() => undefined);
      if (err instanceof AiProviderError) throw err;
      if (signal?.aborted || err?.name === 'AbortError') {
        throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
      }
      throw new AiProviderError(AiDiagnosticCategory.INVALID_RESPONSE, response?.status ?? null, false);
    } finally {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AiProviderError(AiDiagnosticCategory.INVALID_RESPONSE, response?.status ?? null, false);
    }
  }

  static async parseSafeProviderError(
    response: any,
    signal?: AbortSignal
  ): Promise<{
    errorStatus: string | null;
    errorReason: string | null;
  }> {
    let parsed: any = null;
    try {
      parsed = await this.readBoundedJson(response, this.MAX_ERROR_RESPONSE_BYTES, signal);
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return { errorStatus: null, errorReason: null };
    }

    let errorStatus: string | null = null;
    let errorReason: string | null = null;

    if (typeof parsed?.error?.status === 'string') {
      const raw = parsed.error.status.trim().toUpperCase();
      if (this.ALLOWLISTED_RPC_STATUSES.has(raw)) {
        errorStatus = raw;
      }
    }

    const detailsReason = parsed?.error?.details?.[0]?.reason;
    if (typeof detailsReason === 'string') {
      const rawReason = detailsReason.trim().toUpperCase();
      if (this.ALLOWLISTED_REASONS.has(rawReason)) {
        errorReason = rawReason;
      }
    } else if (typeof parsed?.error?.reason === 'string') {
      const rawReason = parsed.error.reason.trim().toUpperCase();
      if (this.ALLOWLISTED_REASONS.has(rawReason)) {
        errorReason = rawReason;
      }
    }

    return { errorStatus, errorReason };
  }

  static classifyProviderFailure(
    statusCode: number,
    errorStatus: string | null,
    errorReason: string | null
  ): { category: AiDiagnosticCategory; retryable: boolean } {
    if (statusCode === 401) {
      return { category: AiDiagnosticCategory.INVALID_KEY, retryable: false };
    }
    if (statusCode === 403) {
      return { category: AiDiagnosticCategory.PERMISSION_DENIED, retryable: false };
    }
    if (statusCode === 404) {
      return { category: AiDiagnosticCategory.MODEL_NOT_FOUND, retryable: false };
    }
    if (statusCode === 400) {
      if (errorStatus === 'FAILED_PRECONDITION' || errorReason === 'BILLING_DISABLED') {
        return { category: AiDiagnosticCategory.BILLING_DISABLED, retryable: false };
      }
      return { category: AiDiagnosticCategory.INVALID_REQUEST, retryable: false };
    }
    if (statusCode === 429) {
      if (errorReason === 'QUOTA_EXCEEDED') {
        return { category: AiDiagnosticCategory.QUOTA_EXHAUSTED, retryable: false };
      }
      // Sólo un motivo explícito QUOTA_EXCEEDED de la lista blanca mapea a QUOTA_EXHAUSTED.
      // Un motivo ausente o desconocido en 429 no debe reclamar cuota; se mapea de forma segura a RATE_LIMITED (retryable: true).
      // Se preserva explícitamente RATE_LIMIT_EXCEEDED como RATE_LIMITED.
      return { category: AiDiagnosticCategory.RATE_LIMITED, retryable: true };
    }
    if (statusCode >= 500 && statusCode < 600) {
      return { category: AiDiagnosticCategory.PROVIDER_UNAVAILABLE, retryable: true };
    }
    if (statusCode >= 400 && statusCode < 500) {
      return { category: AiDiagnosticCategory.INVALID_REQUEST, retryable: false };
    }
    return { category: AiDiagnosticCategory.INVALID_RESPONSE, retryable: false };
  }

  private static async probeProvider(model: string, apiKey: string): Promise<AiProbeResult> {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true));
      }, this.getAiTimeoutMs());
    });

    const probeCall = async (): Promise<AiProbeResult> => {
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        });
      } catch (netErr: any) {
        if (controller.signal.aborted || netErr?.name === 'AbortError') {
          return {
            category: AiDiagnosticCategory.TIMEOUT,
            attemptedModel: model,
            httpStatus: null,
            retryable: true,
            checkedAt
          };
        }
        return {
          category: AiDiagnosticCategory.PROVIDER_UNAVAILABLE,
          attemptedModel: model,
          httpStatus: null,
          retryable: true,
          checkedAt
        };
      }

      if (!response.ok || controller.signal.aborted) {
        if (controller.signal.aborted) {
          void response.body?.cancel?.().catch?.(() => undefined);
          return {
            category: AiDiagnosticCategory.TIMEOUT,
            attemptedModel: model,
            httpStatus: null,
            retryable: true,
            checkedAt
          };
        }
        const { errorStatus, errorReason } = await this.parseSafeProviderError(response, controller.signal);
        const { category, retryable } = this.classifyProviderFailure(response.status, errorStatus, errorReason);
        void response.body?.cancel?.().catch?.(() => undefined);
        return {
          category,
          attemptedModel: model,
          httpStatus: response.status,
          retryable,
          checkedAt
        };
      }

      let data: any;
      try {
        data = await this.readBoundedJson(response, this.MAX_RESPONSE_BYTES, controller.signal);
      } catch {
        return {
          category: AiDiagnosticCategory.INVALID_RESPONSE,
          attemptedModel: model,
          httpStatus: response.status,
          retryable: false,
          checkedAt
        };
      }

      const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof candidateText !== 'string') {
        return {
          category: AiDiagnosticCategory.INVALID_RESPONSE,
          attemptedModel: model,
          httpStatus: response.status,
          retryable: false,
          checkedAt
        };
      }

      return {
        category: AiDiagnosticCategory.READY,
        attemptedModel: model,
        httpStatus: 200,
        retryable: false,
        checkedAt
      };
    };

    try {
      return await Promise.race([deadline, probeCall()]);
    } catch (err: any) {
      if (err instanceof AiProviderError) {
        return {
          category: err.category,
          attemptedModel: model,
          httpStatus: err.httpStatus,
          retryable: err.retryable,
          checkedAt
        };
      }
      return {
        category: AiDiagnosticCategory.TIMEOUT,
        attemptedModel: model,
        httpStatus: null,
        retryable: true,
        checkedAt
      };
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
    }
  }

  static async getDiagnostics(options: { probe?: boolean } = {}): Promise<AiDiagnosticsDTO> {
    const enabled = this.isAiFeatureEnabled();
    const { apiKey, source: keySource } = resolveAiKeyInfo();
    const keyConfigured = apiKey !== null;

    const envPrimary = process.env.GEMINI_MODEL?.trim();
    const envFallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
    const usingDefaults = !envPrimary && !envFallback;
    const primaryModel = envPrimary || this.DEFAULT_PRIMARY_MODEL;
    const fallbackModel = envFallback || this.DEFAULT_FALLBACK_MODEL;
    const timeoutMs = this.getAiTimeoutMs();
    const fallbackLocalAvailable = true;

    let probeResult: AiProbeResult | null = null;
    const shouldProbe = Boolean(options.probe);

    if (shouldProbe) {
      if (!enabled) {
        probeResult = {
          category: AiDiagnosticCategory.DISABLED,
          attemptedModel: null,
          httpStatus: null,
          retryable: false,
          checkedAt: new Date().toISOString()
        };
      } else if (!keyConfigured) {
        probeResult = {
          category: AiDiagnosticCategory.MISSING_KEY,
          attemptedModel: null,
          httpStatus: null,
          retryable: false,
          checkedAt: new Date().toISOString()
        };
      } else {
        probeResult = await this.probeProvider(primaryModel, apiKey);
      }
    }

    return {
      enabled,
      provider: 'gemini',
      keyConfigured,
      keySource,
      primaryModel,
      fallbackModel,
      usingDefaults,
      timeoutMs,
      fallbackLocalAvailable,
      probe: probeResult
    };
  }

  private static async fetchGemini(model: string, apiKey: string, prompt: string, temperature: number): Promise<any> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true));
      }, this.getAiTimeoutMs());
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          let response: Response;
          try {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: 8192 }
              })
            });
          } catch (netErr: any) {
            if (controller.signal.aborted || netErr?.name === 'AbortError') {
              throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
            }
            throw new AiProviderError(AiDiagnosticCategory.PROVIDER_UNAVAILABLE, null, true);
          }

          // Safe provider failure classification without logging raw error bodies.
          if (!response.ok || controller.signal.aborted) {
            if (controller.signal.aborted) {
              void response.body?.cancel?.().catch?.(() => undefined);
              throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
            }
            const { errorStatus, errorReason } = await this.parseSafeProviderError(response, controller.signal);
            const { category, retryable } = this.classifyProviderFailure(response.status, errorStatus, errorReason);
            void response.body?.cancel?.().catch?.(() => undefined);
            throw new AiProviderError(category, response.status, retryable);
          }

          return await this.readBoundedJson(response, this.MAX_RESPONSE_BYTES, controller.signal);
        })()
      ]);
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      if (err?.message === 'AI_DEADLINE' || err?.name === 'AbortError') {
        throw new AiProviderError(AiDiagnosticCategory.TIMEOUT, null, true);
      }
      throw new AiProviderError(AiDiagnosticCategory.PROVIDER_UNAVAILABLE, null, true);
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
    }
  }

  /**
   * Determina si las funciones de IA externa están activas.
   * Por defecto false (Etapa 20), hasta la activación compartida en Etapa 25.
   */
  static isAiFeatureEnabled(): boolean {
    return process.env.ENABLE_AI_FEATURES === 'true' || process.env.AI_FEATURE_ENABLED === 'true';
  }

  static getKeyMetadata(): { configured: boolean; source: AiKeySource } {
    const { apiKey, source } = resolveAiKeyInfo();
    return { configured: apiKey !== null, source };
  }

  private static getGeminiApiKey(): string | null {
    return resolveAiKeyInfo().apiKey;
  }

  /**
   * Helper para extraer y parsear JSON limpio de respuestas de LLM
   */
  private static cleanAndParseJson<T>(rawText: string): T | null {
    try {
      let cleaned = rawText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      // Buscar el bloque { ... } principal si hay texto adicional alrededor
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }

      return JSON.parse(cleaned) as T;
    } catch {
      console.warn('Respuesta JSON inválida del proveedor IA.');
      return null;
    }
  }

  /**
   * Genera una carta gastronómica con IA Gemini.
   * Contención etapa 04 y etapa 20:
   * - Si la función de IA está deshabilitada (por defecto), devuelve vista previa degradada.
   * - Sin clave válida o ante respuesta inválida se devuelve un modo degradado EXPLÍCITO.
   * - El resultado es siempre vista previa: nunca aplica ni borra menú;
   *   la revisión humana por manager es obligatoria antes de cualquier uso.
   */
  static async generateMenu(dto: GenerateMenuAiDTO): Promise<GenerateMenuAiResponseDTO> {
    // Validar input de generación con Zod
    const validatedInput = AiMenuGenerateInputSchema.safeParse(dto);
    if (!validatedInput.success) {
      const firstIssue = validatedInput.error.issues[0];
      return this.degradedMenuPreview(dto, `Entrada inválida: ${firstIssue?.message || 'Parámetros incorrectos'}.`);
    }

    if (!this.isAiFeatureEnabled()) {
      return this.degradedMenuPreview(dto, 'Funcionalidad de IA externa deshabilitada por configuración.');
    }

    const apiKey = this.getGeminiApiKey();

    if (!apiKey) {
      return this.degradedMenuPreview(dto, 'IA no disponible: sin credencial válida.');
    }

    try {
      const generated = await this.callGeminiForMenu({ ...dto, prompt: validatedInput.data.prompt || validatedInput.data.concept! }, apiKey);
      if (generated && Array.isArray(generated.categories) && generated.categories.length > 0) {
        return {
          ...generated,
          degraded: false,
          applied: false,
          reviewNote: 'Vista previa generada por IA pendiente de revisión humana; no se aplicó ni borró menú.',
          poweredBy: 'gemini'
        };
      }
    } catch {
      console.warn('Falla en proveedor IA para menú.');
    }

    // Respuesta inválida o vacía: degradado explícito, sin menú curado de respaldo.
    return this.degradedMenuPreview(dto, 'IA no disponible: respuesta inválida del proveedor.');
  }

  private static degradedMenuPreview(dto: GenerateMenuAiDTO, reason: string): GenerateMenuAiResponseDTO {
    return {
      suggestedTemplateId: dto.templateId || MenuTemplateId.GOURMET_OBSIDIAN,
      themeColor: '#f59e0b',
      categories: [],
      degraded: true,
      applied: false,
      reviewNote: `${reason} Vista previa pendiente de revisión humana; no se aplicó ni borró menú.`,
      poweredBy: 'local-fallback'
    };
  }

  /**
   * Sommelier IA & Guía de Carta para el Comensal en Mesa
   * Conecta en tiempo real con la base de datos real del restaurante
   */
  static async askSommelier(
    restaurantSlugOrId: string,
    userQuery: string
  ): Promise<SommelierResponseDTO> {
    const queryInput = AiSommelierInputSchema.shape.query.safeParse(userQuery);
    if (!queryInput.success) throw new Error('Consulta inválida');
    // Length/shape validation is not a guarantee against prompt injection.
    const sanitizedQuery = queryInput.data
      .replace(/[\r\n]+/g, ' ')
      .replace(/[`"'\\{}]/g, '')
      .trim();

    if (sanitizedQuery.length < 3) {
      throw new Error('La consulta no puede estar vacía');
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantSlugOrId }, { slug: restaurantSlugOrId }] },
      include: {
        categories: {
          include: {
            items: {
              where: { isAvailable: true }
            }
          },
          orderBy: { orderIndex: 'asc' }
        }
      }
    });

    if (!restaurant) {
      throw new Error('Restaurante no encontrado');
    }

    const allActiveItems: MenuItemDTO[] = restaurant.categories.flatMap((c) =>
      c.items
        .filter((i) => i.isAvailable === true)
        .map((i) => {
          let parsedTags: string[] = [];
          try {
            parsedTags = Array.isArray(i.tags)
              ? i.tags
              : (i.tags ? JSON.parse(i.tags) : []);
          } catch (_) {
            parsedTags = [];
          }
          return {
            id: i.id,
            name: i.name,
            description: i.description || undefined,
            price: Number(i.price),
            imageUrl: i.imageUrl || undefined,
            tags: parsedTags,
            isAvailable: true,
            isFeatured: i.isFeatured,
            categoryId: i.categoryId,
            categoryName: c.name || undefined,
            orderIndex: i.orderIndex
          };
        })
    );

    if (allActiveItems.length === 0) {
      return this.abstainToStaff('No hay platos disponibles en la carta activa en este momento.');
    }

    const budgetMax = this.detectBudgetMax(sanitizedQuery);
    const budgetItems = budgetMax === null
      ? allActiveItems
      : allActiveItems.filter((item) => item.price <= budgetMax);
    if (budgetItems.length === 0) {
      return this.abstainToStaff(`No encontré platos disponibles dentro del presupuesto indicado (${this.formatArs(budgetMax!)}).`);
    }

    // Contención etapa 04: las restricciones dietarias se responden de forma
    // determinística sobre etiquetas del catálogo, sin confiar en garantías
    // de texto del modelo. Ante alergias o sin coincidencias verificadas
    // corresponde abstenerse y derivar al personal.
    const dietaryIntent = this.detectDietaryIntent(sanitizedQuery);
    if (dietaryIntent) {
      return this.deterministicDietaryAnswer(restaurant, budgetItems, dietaryIntent, budgetMax);
    }

    const culinaryIntent = this.detectCulinaryIntent(sanitizedQuery);
    if (culinaryIntent === 'off_topic' || culinaryIntent === 'unclear') {
      return this.abstainToStaff(
        `Soy el sommelier y asistente gastronómico de ${restaurant.name}. Solo puedo responder consultas sobre nuestra carta y maridajes disponibles. Para otras consultas o asesoramiento personalizado, por favor consultá a nuestro personal de salón.`
      );
    }

    const matchingItems = this.getMatchingItemsForIntent(culinaryIntent, budgetItems, sanitizedQuery);
    const isSpecificIntent = culinaryIntent !== 'general_recommendation' && culinaryIntent !== 'budget_generic';
    if (isSpecificIntent && matchingItems.length === 0) {
      return this.abstainForMissingIntent(culinaryIntent, restaurant.name);
    }

    const apiKey = this.getGeminiApiKey();

    if (this.isAiFeatureEnabled() && apiKey && budgetItems.length > 0) {
      try {
        const geminiResult = await this.callGeminiForSommelier(restaurant, budgetItems, sanitizedQuery, apiKey);
        if (geminiResult && geminiResult.answer) {
          const knownIds = new Set(budgetItems.map((i) => i.id));
          const validIds = geminiResult.recommendedDishIds.filter((id) => knownIds.has(id)).slice(0, 3);
          const idsAreStrictlyValid = validIds.length > 0 && validIds.length === geminiResult.recommendedDishIds.length;

          let semanticMatchValid = true;
          if (isSpecificIntent && matchingItems.length > 0) {
            const matchingIds = new Set(matchingItems.map((i) => i.id));
            semanticMatchValid = validIds.every((id) => matchingIds.has(id));
          }

          if (idsAreStrictlyValid && semanticMatchValid) {
            const itemMap = new Map(budgetItems.map((i) => [i.id, i]));
            const suggestedDishes = validIds.map((id) => itemMap.get(id)!).filter(Boolean);
            return {
              answer: geminiResult.answer,
              recommendedDishIds: validIds,
              suggestedDishes,
              suggestedPairing: geminiResult.suggestedPairing,
              poweredBy: 'gemini',
              constraints: {
                availableOnly: true,
                ...(budgetMax === null ? {} : { budgetMax }),
                pairing: geminiResult.suggestedPairing ? 'generic-guidance' : 'abstained'
              }
            };
          }
          // IDs desconocidos, mezcla de catálogo o recomendación semánticamente inconsistente:
          // Se degrada a las reglas locales seguras del catálogo activo.
        }
      } catch {
        console.warn('Falla al consultar proveedor IA Sommelier.');
      }
    }

    // Smart Local Heuristic Sommelier (RAG local enriquecido sobre BD de platos)
    return this.localHeuristicSommelier(restaurant, budgetItems, sanitizedQuery, budgetMax, culinaryIntent, matchingItems);
  }

  // --- CONTENCIÓN DIETARIA (determinística, sin garantías de seguridad) ---
  private static detectDietaryIntent(query: string): 'allergy' | 'gluten' | 'vegan' | 'vegetarian' | null {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (
      q.includes('alerg') ||
      q.includes('anafilax') ||
      q.includes('intoleran') ||
      q.includes('shock')
    ) {
      return 'allergy';
    }
    if (q.includes('celiac') || q.includes('tacc') || q.includes('gluten') || q.includes('sin tacc')) {
      return 'gluten';
    }
    if (q.includes('vegan')) {
      return 'vegan';
    }
    if (q.includes('veggie') || q.includes('vegetar') || q.includes('verdura')) {
      return 'vegetarian';
    }
    return null;
  }

  private static detectBudgetMax(query: string): number | null {
    const match = query.match(/(?:hasta|max(?:imo)?|presupuesto(?:\s+de)?|gastar(?:\s+menos\s+de)?)\s*\$?\s*([0-9][0-9.,]*)/i);
    if (!match) return null;
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null;
  }

  private static formatArs(value: number): string {
    return `$${Math.round(value).toLocaleString('es-AR')}`;
  }

  private static abstainToStaff(reason: string): SommelierResponseDTO {
    return {
      answer: `${reason} Por seguridad no sugiero platos por este medio. Las etiquetas del catálogo no garantizan ausencia de alérgenos ni contaminación cruzada. Consultá al personal de salón antes de pedir.`,
      recommendedDishIds: [],
      suggestedDishes: [],
      suggestedPairing: undefined,
      poweredBy: 'heuristic-engine',
      constraints: { availableOnly: true, pairing: 'abstained' },
      degraded: true
    };
  }

  private static deterministicDietaryAnswer(
    restaurant: any,
    items: MenuItemDTO[],
    intent: 'allergy' | 'gluten' | 'vegan' | 'vegetarian',
    budgetMax: number | null = null
  ): SommelierResponseDTO {
    if (intent === 'allergy') {
      return this.abstainToStaff('Ante alergias o restricciones estrictas me abstengo de recomendar.');
    }

    let matches: MenuItemDTO[] = [];
    let label = '';
    if (intent === 'gluten') {
      label = 'con etiqueta sin TACC';
      matches = items.filter((i) => i.tags && i.tags.includes('GLUTEN_FREE')).slice(0, 3);
    } else if (intent === 'vegan') {
      // Vegano estricto: sólo VEGAN, nunca sólo VEGETARIAN.
      label = 'con etiqueta vegana';
      matches = items.filter((i) => i.tags && i.tags.includes('VEGAN')).slice(0, 3);
    } else {
      // Vegetariano: acepta VEGETARIAN o VEGAN (lo vegano es apto vegetariano).
      label = 'con etiqueta vegetariana o vegana';
      matches = items.filter((i) => i.tags && (i.tags.includes('VEGETARIAN') || i.tags.includes('VEGAN'))).slice(0, 3);
    }

    if (matches.length === 0) {
      return this.abstainToStaff(`No encontré coincidencias verificadas ${label} en la carta actual y no sugiero alternativas arbitrarias.`);
    }

    const names = matches.map((d) => `**${d.name}**`);
    const dishList = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} y ${names[1]}` : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
    return {
      answer: `Encontré estas coincidencias ${label} en carta: ${dishList}. Las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada; confirmá con el personal antes de pedir.`,
      recommendedDishIds: matches.map((m) => m.id),
      suggestedDishes: matches,
      suggestedPairing: undefined,
      poweredBy: 'heuristic-engine',
      constraints: {
        availableOnly: true,
        ...(budgetMax === null ? {} : { budgetMax }),
        dietaryIntent: intent,
        pairing: 'abstained'
      }
    };
  }

  // --- LLAMADAS A GEMINI REST API (con reintento entre modelos reales flash/pro y timeout) ---
  private static async callGeminiForMenu(dto: GenerateMenuAiDTO, apiKey: string): Promise<GenerateMenuAiResponseDTO | null> {
    const systemInstruction = `Eres un Chef Ejecutivo y Diseñador Gastronómico Estrella.
Tu tarea es generar un menú completo, seductor y comercial para un restaurante.
Devuelve EXCLUSIVAMENTE un objeto JSON válido con este formato:
{
  "suggestedTemplateId": "GOURMET_OBSIDIAN" | "NEON_BURGER" | "COASTAL_BEACH" | "MINIMAL_BISTRO",
  "themeColor": "#f59e0b",
  "categories": [
    {
      "name": "Nombre de la Categoría",
      "icon": "🍽️",
      "items": [
        {
          "name": "Nombre del Plato",
          "description": "Descripción culinaria atractiva y apetitosa detallando ingredientes y método de cocción",
          "price": 14500,
          "imageUrl": "https://images.unsplash.com/...",
          "tags": ["CHEF_PICK", "GLUTEN_FREE", "POPULAR", "VEGETARIAN"],
          "isFeatured": true
        }
      ]
    }
  ]
}`;

    const sanitizedPrompt = (dto.prompt || '').slice(0, 500).replace(/[`\\]/g, '');
    const userPrompt = `Genera un menú completo con 4 a 5 categorías y 3 a 5 platos por categoría para:
Concepto / Pedido: "${sanitizedPrompt}"
Estilo o Template preferido: ${dto.templateId || 'Auto-detectar'}
Moneda / Precios: Pesos Argentinos (ARS) en escala realista actual de restaurante ($5.000 a $22.000).`;

    // Modelos configurables y reales. Máximo 2 intentos.
    const models = this.getModels();

    for (const model of models) {
      try {
        const data: any = await this.fetchGemini(model, apiKey, `${systemInstruction}\n\n${userPrompt}`, 0.7);
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) continue;

        const rawParsed = this.cleanAndParseJson<unknown>(candidateText);
        if (!rawParsed) continue;

        // Validar estrictamente con Zod en runtime
        const validated = AiMenuGenerateOutputSchema.safeParse(rawParsed);
        if (!validated.success) {
          console.warn('Estructura de menú generada inválida según schema Zod.');
          continue;
        }

        // Sanitizar URLs de imágenes de los items
        const sanitizedCategories = validated.data.categories.map((cat) => ({
          ...cat,
          items: cat.items.map((item) => ({
            ...item,
            imageUrl: item.imageUrl ? (sanitizeUrl(item.imageUrl, '') || null) : null
          }))
        }));

        return {
          suggestedTemplateId: validated.data.suggestedTemplateId as MenuTemplateId,
          themeColor: validated.data.themeColor,
          categories: sanitizedCategories,
          poweredBy: 'gemini'
        };
      } catch (err: any) {
        if (err instanceof AiProviderError) {
          if (!err.retryable && err.category !== AiDiagnosticCategory.MODEL_NOT_FOUND) {
            break;
          }
        }
        console.warn('Falla en proveedor IA para generación de menú.');
      }
    }

    return null;
  }

  // --- LLAMADA A GEMINI PARA SOMMELIER (con timeout y modelos reales) ---
  private static async callGeminiForSommelier(
    restaurant: any,
    activeItems: MenuItemDTO[],
    query: string,
    apiKey: string
  ): Promise<{ answer: string; recommendedDishIds: string[]; suggestedPairing?: string } | null> {
    const menuSummary = activeItems
      .map(
        (i) =>
          `* [ID: "${i.id}"] Plato: "${i.name}" | Precio: $${i.price} | Descripción: ${i.description || 'Especialidad de la casa'} | Tags: ${(i.tags || []).join(', ')}`
      )
      .join('\n');

    const prompt = `Eres el Sommelier y Asistente Gastronómico de "${restaurant.name}".
IMPORTANTE: Eres estrictamente un sommelier gastronómico. Recomienda ÚNICAMENTE platos y bebidas del menú listado a continuación.

Un comensal en su mesa consulta: "${query}"

Platos y bebidas disponibles hoy:
${menuSummary}

REGLAS OBLIGATORIAS:
1. MUY CORTO Y CONCISO: Tu recomendación debe tener MÁXIMO 2 ORACIONES amables y directas al grano, explicando brevemente por qué estas 2 o 3 opciones son ideales. Prohibido escribir parrafadas largas o introducciones extensas.
2. Recomienda EXACTAMENTE entre 2 y 3 platos que respondan fielmente al pedido del cliente (si pide pasta, recomienda pastas; si pide carnes, recomienda carnes; si pide sin tacc, solo opciones aptas).
3. Devuelve los IDs exactos de la lista en "recommendedDishIds".
4. Sugiere un maridaje breve y preciso (ej: "Copa de Malbec Reserva" o "Limonada con menta").

Responde ÚNICAMENTE con este JSON:
{
  "answer": "Respuesta corta y concisa de 1 a 2 oraciones recomendando las opciones ideales...",
  "recommendedDishIds": ["id_plato_1", "id_plato_2"],
  "suggestedPairing": "Bebida o vino sugerido para maridar"
}`;

    const models = this.getModels();

    for (const model of models) {
      try {
        const data: any = await this.fetchGemini(model, apiKey, prompt, 0.3);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) continue;

        const rawParsed = this.cleanAndParseJson<unknown>(text);
        if (!rawParsed) continue;

        // Validar con Zod
        const validated = AiSommelierOutputSchema.safeParse(rawParsed);
        if (!validated.success) {
          console.warn('Respuesta de sommelier inválida según schema Zod.');
          continue;
        }

        return {
          answer: validated.data.answer,
          recommendedDishIds: validated.data.recommendedDishIds,
          suggestedPairing: validated.data.suggestedPairing || undefined
        };
      } catch (err: any) {
        if (err instanceof AiProviderError) {
          if (!err.retryable && err.category !== AiDiagnosticCategory.MODEL_NOT_FOUND) {
            break;
          }
        }
        console.warn('Falla en proveedor IA Sommelier.');
      }
    }

    return null;
  }

  private static detectCulinaryIntent(query: string): SommelierCulinaryIntent {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // 1. Off-topic explícito
    const offTopicKeywords = [
      'clima', 'tiempo', 'temperatura', 'pronostico', 'llueve', 'lluvia',
      'futbol', 'partido', 'gol', 'maradona', 'messi', 'chiste', 'broma',
      'politica', 'presidente', 'eleccion', 'noticia', 'dolar', 'euro',
      'cripto', 'bitcoin', 'cotizacion', 'codigo', 'programacion', 'javascript',
      'python', 'software', 'computadora', 'hotel', 'alojamiento', 'vuelo',
      'avion', 'auto', 'mecanico', 'taller', 'farmacia', 'remedio', 'pelicula',
      'cine', 'serie', 'musica', 'recital'
    ];
    if (offTopicKeywords.some((kw) => q.includes(kw))) {
      return 'off_topic';
    }

    // 2. Intents gastronómicos específicos verificables
    if (
      q.includes('cervez') || q.includes('birra') || /\bipa\b/.test(q) ||
      /\bapa\b/.test(q) || q.includes('stout') || q.includes('lager') ||
      q.includes('pilsen') || q.includes('golden') || q.includes('porter') ||
      q.includes('tirada') || q.includes('trago') || q.includes('cocktail') ||
      q.includes('coctel') || q.includes('vino') || q.includes('copa') ||
      q.includes('bebida') || q.includes('gaseosa') || q.includes('limonada') ||
      q.includes('aperitivo') || q.includes('vermut') || q.includes('vermouth') ||
      q.includes('champagne') || q.includes('espumante') || /\btomar\b/.test(q)
    ) {
      return 'beer_or_drinks';
    }

    if (
      q.includes('compartir') || q.includes('para dos') || q.includes('para 2') ||
      q.includes('pareja') || q.includes('entre dos') || q.includes('picada') ||
      q.includes('picar') || q.includes('tapeo') || q.includes('degustar juntos') ||
      /\b(2|dos)\s*(personas?|comensales?)\b/.test(q)
    ) {
      return 'sharing_or_couple';
    }

    if (
      q.includes('pasta') || q.includes('sorrent') || q.includes('fettucc') ||
      q.includes('ravi') || q.includes('gnocc') || q.includes('noqui') ||
      q.includes('tallarin') || q.includes('lasag') || q.includes('lasana') ||
      q.includes('cappelletti') || q.includes('canelon') || q.includes('spaghetti') ||
      q.includes('spaguetti') || q.includes('fusilli') || q.includes('penne')
    ) {
      return 'pastas';
    }

    if (
      q.includes('carne') || q.includes('bife') || q.includes('asado') ||
      q.includes('parrilla') || q.includes('ojo de bife') || q.includes('vacio') ||
      q.includes('entrana') || q.includes('lomo') || q.includes('matambre') ||
      q.includes('costilla') || q.includes('ribs') || q.includes('milanesa') ||
      q.includes('pollo') || q.includes('cerdo') || q.includes('churrasco') ||
      /\bcortes?\b/.test(q)
    ) {
      return 'carnes';
    }

    if (
      q.includes('pesca') || q.includes('pescado') || /\bmar\b/.test(q) ||
      q.includes('raba') || q.includes('calamar') || q.includes('marisco') ||
      q.includes('salmon') || q.includes('camaron') || q.includes('langostino') ||
      q.includes('pulpo') || q.includes('merluza') || q.includes('abadejo') ||
      q.includes('corvina')
    ) {
      return 'pescados_mariscos';
    }

    if (
      q.includes('postre') || q.includes('dulce') || q.includes('tiramis') ||
      q.includes('volcan') || q.includes('volc') || q.includes('chocolat') ||
      q.includes('helad') || q.includes('flan') || q.includes('cheesecake') ||
      q.includes('panqueque') || q.includes('cafe') || q.includes('cafeteria')
    ) {
      return 'postres';
    }

    if (
      q.includes('econom') || q.includes('barat') || q.includes('precio') ||
      q.includes('gastar') || q.includes('rinde') || q.includes('accesible')
    ) {
      return 'budget_generic';
    }

    // 3. Recomendación general de la casa
    if (
      q.includes('recomend') || q.includes('sugier') || q.includes('sugerencia') ||
      q.includes('estrella') || q.includes('especialidad') || q.includes('de la casa') ||
      q.includes('que tienen') || q.includes('carta') || q.includes('para comer') ||
      q.includes('menu') || q.includes('que pido') || q.includes('platos') ||
      q.includes('rico') || q.includes('almorzar') || q.includes('cenar') ||
      q.includes('probar') || q.includes('hoy')
    ) {
      return 'general_recommendation';
    }

    // 4. Si la consulta no coincide con ningún concepto gastronómico: ambigua / fuera de tema
    return 'unclear';
  }

  private static getMatchingItemsForIntent(
    intent: SommelierCulinaryIntent,
    items: MenuItemDTO[],
    query: string
  ): MenuItemDTO[] {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalize = (str: string) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (intent === 'off_topic' || intent === 'unclear') {
      return [];
    }

    if (intent === 'beer_or_drinks') {
      const isSpecificBeer = q.includes('cervez') || q.includes('birra') || /\bipa\b/.test(q) ||
        /\bapa\b/.test(q) || q.includes('stout') || q.includes('lager') || q.includes('pilsen') ||
        q.includes('porter') || q.includes('tirad') || q.includes('artesanal');

      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');
        const t = (i.tags || []).join(' ').toLowerCase();

        const matchBeer = (s: string) =>
          s.includes('cervez') || s.includes('birra') || /\bipa\b/.test(s) ||
          /\bapa\b/.test(s) || s.includes('stout') || s.includes('lager') ||
          s.includes('pilsen') || s.includes('porter') || s.includes('golden') ||
          s.includes('tirada') || s.includes('beer');

        const matchDrink = (s: string) =>
          matchBeer(s) || s.includes('bebid') || s.includes('trago') ||
          s.includes('cocktail') || s.includes('coctel') || s.includes('vino') ||
          s.includes('copa') || s.includes('malbec') || s.includes('cabernet') ||
          s.includes('chardonnay') || s.includes('gaseosa') || s.includes('limonad') ||
          s.includes('agua') || s.includes('vermut') || s.includes('aperitivo') ||
          s.includes('barra') || s.includes('drink');

        if (isSpecificBeer) {
          return matchBeer(n) || matchBeer(c) || matchBeer(d) || matchBeer(t);
        }
        return matchDrink(n) || matchDrink(c) || matchDrink(d) || matchDrink(t);
      });
    }

    if (intent === 'sharing_or_couple') {
      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');
        const t = (i.tags || []).join(' ').toLowerCase();

        const matchSharing = (s: string) =>
          s.includes('compartir') || s.includes('picada') || s.includes('tabla') ||
          s.includes('para dos') || s.includes('para 2') || s.includes('pareja') ||
          s.includes('tapeo') || s.includes('abundante') || s.includes('degustacion') ||
          s.includes('sharing');

        return matchSharing(n) || matchSharing(c) || matchSharing(d) || matchSharing(t);
      });
    }

    if (intent === 'pastas') {
      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');

        const matchPasta = (s: string) =>
          s.includes('pasta') || s.includes('sorrent') || s.includes('fettucc') ||
          s.includes('gnocc') || s.includes('noqui') || s.includes('ravi') ||
          s.includes('tallarin') || s.includes('lasag') || s.includes('lasana') ||
          s.includes('cappelletti') || s.includes('canelon') || s.includes('fusilli') ||
          s.includes('penne');

        if (q.includes('spaghe') && (n.includes('spaghe') || d.includes('spaghe'))) {
          return true;
        }

        return matchPasta(n) || matchPasta(c) || matchPasta(d);
      });
    }

    if (intent === 'carnes') {
      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');
        const t = (i.tags || []).join(' ').toLowerCase();

        const matchMeat = (s: string) =>
          s.includes('carne') || s.includes('bife') || s.includes('asado') ||
          s.includes('parrilla') || s.includes('vacio') || s.includes('entrana') ||
          s.includes('lomo') || s.includes('matambre') || s.includes('costilla') ||
          s.includes('ribs') || s.includes('milanesa') || s.includes('pollo') ||
          s.includes('cerdo') || s.includes('churrasco') || /\bojo\b/.test(s) ||
          /\bcortes?\b/.test(s);

        return matchMeat(n) || matchMeat(c) || matchMeat(d) || matchMeat(t);
      });
    }

    if (intent === 'pescados_mariscos') {
      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');

        const matchFish = (s: string) =>
          s.includes('pesca') || s.includes('pescado') || s.includes('raba') ||
          s.includes('calamar') || s.includes('salmon') || s.includes('marisco') ||
          s.includes('camaron') || s.includes('langostino') || s.includes('pulpo') ||
          s.includes('merluza') || s.includes('abadejo') || s.includes('corvina') ||
          s.includes('marino') || s.includes('maritimo') || /\bmar\b/.test(s);

        return matchFish(n) || matchFish(c) || matchFish(d);
      });
    }

    if (intent === 'postres') {
      return items.filter((i) => {
        const n = normalize(i.name);
        const c = normalize(i.categoryName || '');
        const d = normalize(i.description || '');

        const matchDessert = (s: string) =>
          s.includes('postre') || s.includes('dulce') || s.includes('tiramis') ||
          s.includes('volcan') || s.includes('volc') || s.includes('chocolat') ||
          s.includes('helad') || s.includes('flan') || s.includes('cheesecake') ||
          s.includes('panqueque') || s.includes('cafe') || s.includes('cafeteria');

        return matchDessert(n) || matchDessert(c) || matchDessert(d);
      });
    }

    if (intent === 'budget_generic') {
      return [...items].sort((a, b) => a.price - b.price);
    }

    if (intent === 'general_recommendation') {
      const featured = items.filter((i) => i.isFeatured || (i.tags && (i.tags.includes('CHEF_PICK') || i.tags.includes('POPULAR'))));
      return featured.length > 0 ? featured : items;
    }

    return [];
  }

  private static abstainForMissingIntent(intent: SommelierCulinaryIntent, restaurantName: string): SommelierResponseDTO {
    const messages: Record<string, string> = {
      beer_or_drinks: 'No encontré opciones de cerveza o bebidas disponibles en la carta actual y no sugiero alternativas arbitrarias.',
      sharing_or_couple: 'No encontré opciones específicas para compartir en la carta actual y no sugiero alternativas arbitrarias.',
      pastas: 'No encontré platos de pastas disponibles en la carta actual y no sugiero alternativas arbitrarias.',
      carnes: 'No encontré opciones de carnes disponibles en la carta actual y no sugiero alternativas arbitrarias.',
      pescados_mariscos: 'No encontré opciones de pescados o mariscos disponibles en la carta actual y no sugiero alternativas arbitrarias.',
      postres: 'No encontré postres disponibles en la carta actual y no sugiero alternativas arbitrarias.'
    };
    const reason = messages[intent] || 'No encontré opciones verificadas para tu búsqueda en la carta actual y no sugiero alternativas arbitrarias.';
    return this.abstainToStaff(reason);
  }

  // --- RECOMENDADOR LOCAL ENRIQUECIDO (CONCISO, PRECISO Y SIN SLICES ARBITRARIOS) ---
  private static localHeuristicSommelier(
    restaurant: any,
    items: MenuItemDTO[],
    query: string,
    budgetMax: number | null = null,
    culinaryIntent?: SommelierCulinaryIntent,
    prefilteredMatches?: MenuItemDTO[]
  ): SommelierResponseDTO {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Verificación preventiva de seguridad: alergias siempre abstención determinística
    if (q.includes('alerg') || q.includes('anafilax') || q.includes('intoleran')) {
      return AIService.abstainToStaff('Ante alergias o restricciones estrictas me abstengo de recomendar.');
    }

    // Si hubo intento dietario (celiaco, vegano, vegetariano), delegar a respuesta determinística
    const dietary = this.detectDietaryIntent(query);
    if (dietary) {
      return this.deterministicDietaryAnswer(restaurant, items, dietary, budgetMax);
    }

    const intent = culinaryIntent || this.detectCulinaryIntent(query);

    if (intent === 'off_topic' || intent === 'unclear') {
      return this.abstainToStaff(
        `Soy el sommelier y asistente gastronómico de ${restaurant.name}. Solo puedo responder consultas sobre nuestra carta y maridajes disponibles. Para otras consultas o asesoramiento personalizado, por favor consultá a nuestro personal de salón.`
      );
    }

    const matches = prefilteredMatches ?? this.getMatchingItemsForIntent(intent, items, query);

    const formatDishList = (dishList: MenuItemDTO[]) => {
      const names = dishList.map((d) => `**${d.name}**`);
      if (names.length === 0) return '';
      if (names.length === 1) return names[0];
      if (names.length === 2) return `${names[0]} y ${names[1]}`;
      return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
    };

    if (matches.length === 0 && intent !== 'budget_generic' && intent !== 'general_recommendation') {
      return this.abstainForMissingIntent(intent, restaurant.name);
    }

    let answer = '';
    let pairing = '';
    let finalMatches: MenuItemDTO[] = [];

    if (intent === 'beer_or_drinks') {
      finalMatches = matches.slice(0, 3);
      answer = `Para acompañar tu momento te recomiendo nuestras opciones de bebidas: ${formatDishList(finalMatches)}.`;
      pairing = 'Consultá al personal por maridajes recomendados para este plato';
    } else if (intent === 'sharing_or_couple') {
      finalMatches = matches.slice(0, 3);
      answer = `Para compartir en pareja les sugiero nuestras opciones generosas: ${formatDishList(finalMatches)}.`;
      pairing = 'Botella de Espumante Extra Brut o vino de la casa';
    } else if (intent === 'pastas') {
      finalMatches = matches.slice(0, 3);
      answer = `Te sugiero nuestras pastas artesanales al huevo servidas al dente con salsa cocinada a fuego lento: ${formatDishList(finalMatches)}.`;
      pairing = 'Copa de Malbec Reserva';
    } else if (intent === 'carnes') {
      finalMatches = matches.slice(0, 3);
      answer = `Seleccionamos cortes madurados y sellados a la leña para lograr costra crocante y centro jugoso: te aconsejo ${formatDishList(finalMatches)}.`;
      pairing = 'Copa de Cabernet Sauvignon con paso por roble';
    } else if (intent === 'pescados_mariscos') {
      finalMatches = matches.slice(0, 3);
      answer = `Pesca fresca del día directo del puerto marplatense: te recomiendo ${formatDishList(finalMatches)}.`;
      pairing = 'Copa de Chardonnay Marítimo bien frío';
    } else if (intent === 'postres') {
      finalMatches = matches.slice(0, 3);
      answer = `Para el broche de oro de la velada te sugiero ${formatDishList(finalMatches)}.`;
      pairing = 'Café Espresso italiano o Copa de Cosecha Tardía';
    } else if (intent === 'budget_generic') {
      finalMatches = [...items].sort((a, b) => a.price - b.price).slice(0, 3);
      answer = `Las opciones más convenientes y rendidoras con la calidad de la casa son ${formatDishList(finalMatches)}.`;
      pairing = 'Limonada fresca con menta';
    } else {
      // General recommendation
      finalMatches = items.filter((i) => i.isFeatured || (i.tags && (i.tags.includes('CHEF_PICK') || i.tags.includes('POPULAR')))).slice(0, 3);
      if (finalMatches.length === 0) finalMatches = items.slice(0, 3);
      answer = `Como sugerencia destacada del día en ${restaurant.name}, te recomiendo ${formatDishList(finalMatches)}.`;
      pairing = 'Consultá al personal por el vino disponible para este plato';
    }

    if (finalMatches.length === 0) {
      return this.abstainToStaff('No encontré platos disponibles en la carta activa para sugerir en este momento.');
    }

    return {
      answer,
      recommendedDishIds: finalMatches.map((m) => m.id),
      suggestedDishes: finalMatches,
      suggestedPairing: pairing,
      poweredBy: 'heuristic-engine',
      constraints: {
        availableOnly: true,
        ...(budgetMax === null ? {} : { budgetMax }),
        pairing: 'generic-guidance'
      }
    };
  }

}
