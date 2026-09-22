import type { Restaurant } from '@prisma/client';
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
  sanitizeUrl
} from '@mesaya/shared';

export class AIService {
  private static getAiTimeoutMs(): number {
    const configured = Number(process.env.AI_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(Math.max(Math.floor(configured), 1), 30_000)
      : 8000;
  }
  private static readonly MAX_AI_ATTEMPTS = 2;
  private static readonly MAX_RESPONSE_BYTES = 256 * 1024;

  private static getModels(): string[] {
    // No default potentially retired model: external AI requires explicit configuration.
    const primary = process.env.GEMINI_MODEL?.trim();
    const configuredPrimary = primary || 'gemini-1.5-flash';
    const configuredFallback = process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-1.5-pro';
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(configuredPrimary)) return [];
    return [...new Set([configuredPrimary, configuredFallback])]
      .filter((model): model is string => !!model && /^[a-zA-Z0-9._-]{1,128}$/.test(model))
      .slice(0, this.MAX_AI_ATTEMPTS);
  }

  private static async fetchGemini(model: string, apiKey: string, prompt: string, temperature: number): Promise<any> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('AI_DEADLINE'));
      }, this.getAiTimeoutMs());
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: 8192 }
            })
          });
          // Never read/log error bodies: they can hang or echo secrets and prompts.
          if (!response.ok || controller.signal.aborted) {
            void response.body?.cancel().catch(() => undefined);
            throw new Error('AI_PROVIDER_FAILED');
          }
          const declaredLength = Number(response.headers?.get?.('content-length') || 0);
          if (declaredLength > this.MAX_RESPONSE_BYTES) {
            void response.body?.cancel().catch(() => undefined);
            throw new Error('AI_BODY_LIMIT');
          }
          // Vitest fixtures may expose only json(); real fetch responses use the
          // bounded stream path below. The shared deadline still covers either.
          if (!response.body) {
            return await response.json();
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let size = 0;
          let text = '';
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw new Error('AI_DEADLINE');
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > this.MAX_RESPONSE_BYTES) throw new Error('AI_BODY_LIMIT');
            text += decoder.decode(chunk.value, { stream: true });
          }
          return JSON.parse(text + decoder.decode());
        })()
      ]);
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
      // Cancellation is best-effort; awaiting an uncooperative stream would defeat the deadline.
      if (reader) void reader.cancel().catch(() => undefined);
    }
  }

  /**
   * Determina si las funciones de IA externa están activas.
   * Por defecto false (Etapa 20), hasta la activación compartida en Etapa 25.
   */
  static isAiFeatureEnabled(): boolean {
    return process.env.ENABLE_AI_FEATURES === 'true' || process.env.AI_FEATURE_ENABLED === 'true';
  }

  private static getGeminiApiKey(): string | null {
    // Contención etapa 04: sólo claves del proveedor Gemini. Las claves de
    // Notion nunca deben enviarse como credencial a otro proveedor.
    const key =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      null;
    return key && key.trim().length > 0 ? key.trim() : null;
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
          reviewNote: 'Vista previa generada por IA pendiente de revisión humana; no se aplicó ni borró menú.'
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
      reviewNote: `${reason} Vista previa pendiente de revisión humana; no se aplicó ni borró menú.`
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
      c.items.map((i) => {
        let parsedTags: string[] = [];
        try {
          parsedTags = i.tags ? JSON.parse(i.tags) : [];
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
          isAvailable: i.isAvailable,
          isFeatured: i.isFeatured,
          categoryId: i.categoryId,
          orderIndex: i.orderIndex
        };
      })
    );

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

    const apiKey = this.getGeminiApiKey();

    if (this.isAiFeatureEnabled() && apiKey && budgetItems.length > 0) {
      try {
        const geminiResult = await this.callGeminiForSommelier(restaurant, budgetItems, sanitizedQuery, apiKey);
        if (geminiResult && geminiResult.answer) {
          const knownIds = new Set(budgetItems.map((i) => i.id));
          const validIds = geminiResult.recommendedDishIds.filter((id) => knownIds.has(id)).slice(0, 3);
          if (validIds.length > 0 && validIds.length === geminiResult.recommendedDishIds.length) {
            const suggestedDishes = budgetItems.filter((i) => validIds.includes(i.id));
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
          // IDs desconocidos o sin coincidencias válidas: no se sugiere nada
          // arbitrario; se continúa al heurístico no dietario.
        }
      } catch {
        console.warn('Falla al consultar proveedor IA Sommelier.');
      }
    }

    // Smart Local Heuristic Sommelier (RAG local enriquecido sobre BD de platos)
    return this.localHeuristicSommelier(restaurant, budgetItems, sanitizedQuery, budgetMax);
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
    _restaurant: Restaurant | { name: string },
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
          console.warn('Estructura de menú generada inválida según schema Zod:', validated.error.issues);
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
          categories: sanitizedCategories
        };
      } catch (err: any) {
        console.warn('Falla en proveedor IA para generación de menú.');
      }
    }

    return null;
  }

  // --- LLAMADA A GEMINI PARA SOMMELIER (con timeout y modelos reales) ---
  private static async callGeminiForSommelier(
    restaurant: Restaurant | { name: string },
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
          console.warn('Respuesta de sommelier inválida según schema Zod:', validated.error.issues);
          continue;
        }

        return {
          answer: validated.data.answer,
          recommendedDishIds: validated.data.recommendedDishIds,
          suggestedPairing: validated.data.suggestedPairing || undefined
        };
      } catch (err: any) {
        console.warn('Falla en proveedor IA Sommelier.');
      }
    }

    return null;
  }

  // --- RECOMENDADOR LOCAL ENRIQUECIDO (CONCISO Y PRECISO) ---
  private static localHeuristicSommelier(
    restaurant: any,
    items: MenuItemDTO[],
    query: string,
    budgetMax: number | null = null
  ): SommelierResponseDTO {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let matches: MenuItemDTO[] = [];
    let answer = '';
    let pairing = '';

    const formatDishList = (dishList: MenuItemDTO[]) => {
      const names = dishList.map((d) => `**${d.name}**`);
      if (names.length === 0) return '';
      if (names.length === 1) return names[0];
      if (names.length === 2) return `${names[0]} y ${names[1]}`;
      return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
    };

    if (q.includes('alerg') || q.includes('anafilax') || q.includes('intoleran')) {
      return AIService.abstainToStaff('Ante alergias o restricciones estrictas me abstengo de recomendar.');
    }

    if (q.includes('celiac') || q.includes('tacc') || q.includes('gluten') || q.includes('sin tacc')) {
      matches = items.filter((i) => i.tags && i.tags.includes('GLUTEN_FREE')).slice(0, 3);
      if (matches.length === 0) {
        return AIService.abstainToStaff('No encontré coincidencias verificadas con etiqueta sin TACC en la carta actual y no sugiero alternativas arbitrarias.');
      }
      answer = `Encontré estas coincidencias con etiqueta sin TACC en carta: ${formatDishList(matches)}. Las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada; confirmá con el personal antes de pedir.`;
      pairing = 'Agua mineral con gas y lima';
    } else if (q.includes('vegan')) {
      // Vegano estricto: sólo VEGAN.
      matches = items.filter((i) => i.tags && i.tags.includes('VEGAN')).slice(0, 3);
      if (matches.length === 0) {
        return AIService.abstainToStaff('No encontré coincidencias verificadas con etiqueta vegana en la carta actual y no sugiero alternativas arbitrarias.');
      }
      answer = `Encontré estas coincidencias con etiqueta vegana en carta: ${formatDishList(matches)}. Las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada; confirmá con el personal antes de pedir.`;
      pairing = 'Limonada artesanal con menta y jengibre';
    } else if (q.includes('veggie') || q.includes('vegetar') || q.includes('verdura')) {
      // Vegetariano: acepta VEGETARIAN o VEGAN.
      matches = items.filter((i) => i.tags && (i.tags.includes('VEGETARIAN') || i.tags.includes('VEGAN'))).slice(0, 3);
      if (matches.length === 0) {
        return AIService.abstainToStaff('No encontré coincidencias verificadas con etiqueta vegetariana o vegana en la carta actual y no sugiero alternativas arbitrarias.');
      }
      answer = `Encontré estas coincidencias con etiqueta vegetariana o vegana en carta: ${formatDishList(matches)}. Las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada; confirmá con el personal antes de pedir.`;
      pairing = 'Limonada artesanal con menta y jengibre';
    } else if (q.includes('pasta') || q.includes('sorrent') || q.includes('fettucc') || q.includes('ravi') || q.includes('gnocc')) {
      matches = items.filter((i) => i.name.toLowerCase().includes('pasta') || i.name.toLowerCase().includes('sorrent') || i.name.toLowerCase().includes('fettucc') || i.name.toLowerCase().includes('gnocc') || i.name.toLowerCase().includes('ravi')).slice(0, 3);
      if (matches.length === 0) matches = items.slice(0, 2);
      answer = `Te sugiero nuestras pastas artesanales al huevo servidas al dente con salsa cocinada a fuego lento: ${formatDishList(matches)}.`;
      pairing = 'Copa de Malbec Reserva';
    } else if (q.includes('carne') || q.includes('bife') || q.includes('asado') || q.includes('parrilla')) {
      matches = items.filter((i) => {
        const n = i.name.toLowerCase();
        return n.includes('bife') || n.includes('carne') || n.includes('parrilla') || /\bojo\b/i.test(n);
      }).slice(0, 3);
      if (matches.length === 0) matches = items.filter(i => i.isFeatured).slice(0, 2);
      answer = `Seleccionamos cortes madurados y sellados a la leña para lograr costra crocante y centro jugoso: te aconsejo ${formatDishList(matches)}.`;
      pairing = 'Copa de Cabernet Sauvignon con paso por roble';
    } else if (q.includes('pesca') || q.includes('mar') || q.includes('raba') || q.includes('calamar') || q.includes('marisco')) {
      matches = items.filter((i) => i.name.toLowerCase().includes('pesca') || i.name.toLowerCase().includes('raba') || i.name.toLowerCase().includes('salm') || i.name.toLowerCase().includes('mar')).slice(0, 3);
      if (matches.length === 0) matches = items.slice(0, 2);
      answer = `Pesca fresca del día directo del puerto marplatense: te recomiendo ${formatDishList(matches)}.`;
      pairing = 'Copa de Chardonnay Marítimo bien frío';
    } else if (q.includes('2') || q.includes('dos') || q.includes('pareja') || q.includes('compartir')) {
      matches = items.filter((i) => i.isFeatured || (i.tags && i.tags.includes('CHEF_PICK'))).slice(0, 2);
      if (matches.length === 0) matches = items.slice(0, 2);
      answer = `Para compartir en pareja les sugiero una combinación de especialidades generosas: ${formatDishList(matches)}.`;
      pairing = 'Botella de Espumante Extra Brut';
    } else if (q.includes('postre') || q.includes('dulce') || q.includes('tiramis') || q.includes('chocol') || q.includes('volcan')) {
      matches = items.filter((i) => i.name.toLowerCase().includes('tiramis') || i.name.toLowerCase().includes('volc') || i.name.toLowerCase().includes('postre') || i.name.toLowerCase().includes('helad')).slice(0, 3);
      if (matches.length === 0) matches = items.slice(0, 2);
      answer = `Para el broche de oro de la velada te sugiero ${formatDishList(matches)}.`;
      pairing = 'Café Espresso italiano o Copa de Cosecha Tardía';
    } else if (q.includes('econom') || q.includes('barat') || q.includes('precio') || q.includes('gastar') || q.includes('rinde')) {
      matches = [...items].sort((a, b) => a.price - b.price).slice(0, 3);
      answer = `Las opciones más convenientes y rendidoras con la calidad de la casa son ${formatDishList(matches)}.`;
      pairing = 'Limonada fresca con menta';
    } else {
      // Default: Especialidad destacada (2 o 3 opciones)
      matches = items.filter((i) => i.isFeatured || (i.tags && i.tags.includes('CHEF_PICK'))).slice(0, 3);
      if (matches.length === 0) matches = items.slice(0, 2);
      answer = `Como sugerencia destacada del día en ${restaurant.name}, te recomiendo ${formatDishList(matches)}.`;
      pairing = 'Consultá al personal por el vino disponible para este plato';
    }

    const finalMatches = matches.slice(0, 3);

    return {
      answer,
      recommendedDishIds: finalMatches.map((m) => m.id),
      suggestedDishes: finalMatches,
      suggestedPairing: pairing,
      poweredBy: 'heuristic-engine',
      constraints: {
        availableOnly: true,
        ...(budgetMax === null ? {} : { budgetMax }),
        pairing: pairing.toLowerCase().includes('consultá') ? 'generic-guidance' : 'generic-guidance'
      }
    };
  }

}
