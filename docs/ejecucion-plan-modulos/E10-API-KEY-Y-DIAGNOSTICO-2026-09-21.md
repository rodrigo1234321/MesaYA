# Informe de Ejecución E10 — Diagnóstico Seguro de API Key, Proveedor, Modelo y Cuota

- **Etapa**: E10 — Diagnóstico seguro de API key / proveedor / modelo / cuota para MesaYA
- **Fecha**: 2026-09-21
- **Branch**: `codex/plan-modulos-20260920` (worktree actual)
- **Estado**: `PASS_E10 / VERIFICADO_LOCAL` (Pase de correcciones tras `NEEDS_REVIEW` previo; 5 correcciones aplicadas, review independiente Antigravity Pro read-only con `PASS_E10`, 57/57 tests y compilación monorepo limpias; sin validación cloud)
- **Autor/Ejecutor**: Agente Antigravity (escritor exclusivo de E10, single writer, sin commits, pushes, deploys ni edición de archivos `.env`)

---

## 1. Alcance y Objetivos

El objetivo de E10 es dotar a MesaYA de un diagnóstico seguro, tipado y exhaustivo de la integración con IA externa (Google Gemini API REST), garantizando:
1. **Contención estricta de credenciales y cuerpos crudos de error**:
   - NUNCA imprimir, loguear, persistir, enmascarar, hashear ni retornar claves de API (`GOOGLE_API_KEY` ni `GEMINI_API_KEY`).
   - NUNCA exponer en logs (`console.warn`, `console.error`) ni en respuestas HTTP los mensajes o cuerpos de error crudos devueltos por el proveedor (que frecuentemente ecoean la clave rechazada o prompts sensibles).
2. **Modelos vigentes y soportados al 2026-09-21**:
   - Reemplazo de los modelos obsoletos y retirados (`gemini-1.5-flash` y `gemini-1.5-pro`) por los modelos estables soportados:
     - Modelo primario por defecto: `gemini-3.8-flash`
     - Modelo fallback por defecto: `gemini-3.5-flash-lite`
   - IDs de modelos totalmente configurables mediante `GEMINI_MODEL` y `GEMINI_FALLBACK_MODEL`, con detección explícita de `usingDefaults`.
3. **Precedencia oficial de credenciales**:
   - Soporte para `GOOGLE_API_KEY` y `GEMINI_API_KEY`.
   - Conforme a la documentación oficial de Google Cloud / Google AI Studio, se da precedencia a `GOOGLE_API_KEY` cuando ambas están configuradas en el entorno.
4. **Clasificación canónica y segura de fallas del proveedor**:
   - Mapeo unificado a categorías tipadas:
     - `DISABLED`: función de IA deshabilitada por configuración (`ENABLE_AI_FEATURES !== 'true'`).
     - `MISSING_KEY`: sin clave de API configurada en el entorno.
     - `INVALID_KEY`: HTTP 401 (`UNAUTHENTICATED`, clave inválida o expirada).
     - `PERMISSION_DENIED`: HTTP 403 (`PERMISSION_DENIED`, API deshabilitada en el proyecto o restricción geográfica/IP).
     - `MODEL_NOT_FOUND`: HTTP 404 (`NOT_FOUND`, modelo inexistente, retirado o mal tipiado).
     - `BILLING_DISABLED`: HTTP 400 con `FAILED_PRECONDITION` o motivo `BILLING_DISABLED`.
     - `INVALID_REQUEST`: HTTP 400 (`INVALID_ARGUMENT` u otro error de formato en la petición).
     - `QUOTA_EXHAUSTED`: HTTP 429 sólo con motivo allowlisted explícito `QUOTA_EXCEEDED`; un 429 ambiguo no se atribuye a cuota.
     - `RATE_LIMITED`: HTTP 429 con motivo `RATE_LIMIT_EXCEEDED`, desconocido o ausente, con reintento seguro.
     - `PROVIDER_UNAVAILABLE`: HTTP 500/502/503/504 o fallas de transporte del proveedor.
     - `TIMEOUT`: límite de tiempo (`AI_TIMEOUT_MS` o deadline de 8s) alcanzado antes de recibir respuesta.
     - `INVALID_RESPONSE`: HTTP 200 pero cuerpo malformado, candidatos ausentes o JSON no analizable.
     - `READY`: probe exitoso con status 200 y candidatos válidos.
     - `NOT_PROBED` / `SKIPPED`: consulta de diagnóstico realizada sin requerir probe activo (`probe=false`).
5. **Política de reintentos y contención de cuota**:
   - Los errores no transitorios de autorización, permisos, facturación o cuota agotada (`INVALID_KEY`, `PERMISSION_DENIED`, `BILLING_DISABLED`, `INVALID_REQUEST`, `QUOTA_EXHAUSTED`) **NO se reintentan** contra el modelo fallback. Esto evita multiplicar el consumo de cuota o reintentar inútilmente una credencial inválida.
   - Los errores de modelo no encontrado (`MODEL_NOT_FOUND` / 404) y fallas transitorias de disponibilidad (`PROVIDER_UNAVAILABLE` / 503, `TIMEOUT`) sí prueban el modelo alternativo configurado.
   - En todos los casos se preserva de forma transparente el fallback heurístico local del sommelier y la vista previa degradada del menú.
6. **Atribución honesta (`poweredBy`)**:
   - Ni el Sommelier ni la Generación de Carta indican `gemini` a menos que se haya obtenido y validado una respuesta real del modelo.
   - En fallback local se retorna explícitamente `heuristic-engine` (sommelier) y `local-fallback` (menú).
7. **Endpoint de diagnóstico protegido para Encargados**:
   - `GET /v1/restaurants/:slugOrId/ai/diagnostics?probe=true|false`
   - Protegido por `requireManagedRestaurant` (rol `MANAGER` obligatorio y validación estricta de tenant).
   - Por defecto (`probe=false`) no realiza llamadas salientes al proveedor ni consume cuota; retorna la configuración efectiva y `probe: null`.
   - Con `probe=true` emite un único ping minimal (`ping`, `maxOutputTokens: 5`) para validar conectividad y estado operativo real.

---

## 2. Contrato de Diagnóstico Seguro (E10)

Definido formalmente en `@mesaya/shared` (`packages/shared/src/ai-schemas.ts` e `index.ts`):

```typescript
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

export const AiDiagnosticsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('gemini'),
  keyConfigured: z.boolean(),
  keySource: z.enum(['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'none']),
  primaryModel: z.string(),
  fallbackModel: z.string().nullable(),
  usingDefaults: z.boolean(),
  timeoutMs: z.number().positive(),
  fallbackLocalAvailable: z.boolean(),
  probe: z.object({
    category: AiDiagnosticCategorySchema,
    attemptedModel: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    retryable: z.boolean(),
    checkedAt: z.string()
  }).nullable().optional()
});
```

### Reglas de Seguridad del Contrato
- El campo `keySource` sólo indica `'GOOGLE_API_KEY'`, `'GEMINI_API_KEY'` o `'none'`. **Nunca se incluye el valor ni ningún fragmento/hash de la clave**.
- El objeto `probe` sólo expone categorías safe y metadatos sanitizados (`category`, `attemptedModel`, `httpStatus`, `retryable`, `checkedAt`). **Ningún campo contiene mensajes ni cuerpos devueltos por el proveedor**.
- Ante `probe=false` o sin query parameter, el endpoint retorna `probe: null` y **no realiza ninguna petición de red**.

---

## 3. Archivos Involucrados y Modificados

1. `packages/shared/src/ai-schemas.ts`:
   - Incorporación de `AiDiagnosticCategory`, `AiDiagnosticCategorySchema`, `AiKeySourceSchema`, `AiProbeResultSchema`, `AiDiagnosticsSchema` y sus tipos derivados.
2. `packages/shared/src/index.ts`:
   - Exportación de los nuevos schemas y adición de `poweredBy?: 'gemini' | 'local-fallback'` a `GenerateMenuAiResponseDTO`.
3. `packages/api/src/services/ai.service.ts`:
   - Reemplazo de modelos obsoletos por `gemini-3.8-flash` y `gemini-3.5-flash-lite`.
   - Implementación de `getKeyInfo()` con precedencia de `GOOGLE_API_KEY`.
   - Implementación de `parseSafeProviderError()` y `classifyProviderFailure()` con listas blancas de estados RPC Google y razones.
   - Creación de la clase `AiProviderError` sin campos de cuerpo crudo.
   - Implementación de `probeProvider()` (ping minimal de 5 tokens).
   - Implementación de `AIService.getDiagnostics({ probe })`.
   - Contención de reintentos: no reintentar `INVALID_KEY`, `PERMISSION_DENIED`, `BILLING_DISABLED`, `INVALID_REQUEST` ni `QUOTA_EXHAUSTED` contra el modelo fallback.
   - Eliminación de logs que pudieran imprimir objetos de error con texto del proveedor.
4. `packages/api/src/routes/menu.routes.ts`:
   - Montaje del endpoint `GET /restaurants/:slugOrId/ai/diagnostics` protegido con `requireManagedRestaurant`.
   - Propagación de `poweredBy` en la respuesta de generación de carta.
5. `scripts/route-matrix.json`:
   - Clasificación de la ruta `GET /v1/restaurants/:slugOrId/ai/diagnostics` con rol `MANAGER`.
6. `packages/api/test/e10-ai-diagnostics.test.ts`:
   - Suite focal con 26 tests exhaustivos que verifican todos los casos del contrato.
7. `docs/ejecucion-plan-modulos/E10-API-KEY-Y-DIAGNOSTICO-2026-09-21.md`:
   - Este informe técnico de ejecución.

---

## 4. Evidencia de Tests y Verificaciones

### 4.1 Suite Focal E10 (`packages/api/test/e10-ai-diagnostics.test.ts`)
```
npx vitest run packages/api/test/e10-ai-diagnostics.test.ts

 RUN  v4.1.11 C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-plan-20260920

 Test Files  1 passed (1)
      Tests  26 passed (26)
   Duration  647ms
```

Detalle de los 26 tests cubiertos:
1. Sin flag `ENABLE_AI_FEATURES`: diagnóstico sin probe devuelve `enabled=false` y `probe=null` sin fetch.
2. Sin flag `ENABLE_AI_FEATURES`: probe explícito devuelve categoría `DISABLED` sin llamar a fetch.
3. Con flag pero sin clave: probe explícito devuelve categoría `MISSING_KEY` sin llamar a fetch.
4. Precedencia: `GOOGLE_API_KEY` tiene precedencia si ambas claves están presentes; header `x-goog-api-key` recibe `GOOGLE_API_KEY`.
5. Soporte alternativo: `GEMINI_API_KEY` se utiliza correctamente cuando `GOOGLE_API_KEY` no existe.
6. Modelos por defecto vigentes: `gemini-3.8-flash` y `gemini-3.5-flash-lite` con `usingDefaults=true`.
7. Modelos por variables de entorno: detección correcta y `usingDefaults=false`.
8. Probe exitoso: retorno de categoría `READY` con `httpStatus=200` y `retryable=false`.
9. Error HTTP 401: clasificación precisa como `INVALID_KEY`, `retryable=false`.
10. Error HTTP 403: clasificación precisa como `PERMISSION_DENIED`, `retryable=false`.
11. Error HTTP 404: modelo no encontrado/obsoleto clasificado como `MODEL_NOT_FOUND`, `retryable=false`.
12. Error HTTP 400 con `FAILED_PRECONDITION`: clasificación como `BILLING_DISABLED`, `retryable=false`.
13. Error HTTP 400 con `INVALID_ARGUMENT`: clasificación como `INVALID_REQUEST`, `retryable=false`.
14. Error HTTP 429 cuota: clasificación como `QUOTA_EXHAUSTED`, `retryable=false`.
15. Error HTTP 429 tasa: clasificación como `RATE_LIMITED`, `retryable=true`.
16. Error HTTP 503: clasificación como `PROVIDER_UNAVAILABLE`, `retryable=true`.
17. Timeout / Abort: límite de tiempo clasificado como `TIMEOUT`, `httpStatus=null`, `retryable=true`.
18. Respuesta 200 con HTML o JSON malformado: clasificada como `INVALID_RESPONSE`.
19. Aislamiento de reintentos: 401 no reintenta modelo fallback ni duplica llamadas a fetch.
20. Aislamiento de reintentos: 404 (modelo no encontrado) sí prueba el modelo fallback configurado.
21. Fuga de credenciales: inyección de string sensible simulando respuesta de error de Google; verificación estricta de que ni el DTO ni ningún log contienen la clave o el mensaje crudo.
22. Ruta HTTP: rechazo de llamada anónima con 401 UNAUTHORIZED.
23. Ruta HTTP: rechazo de llamada con rol no-manager (WAITER) con 403 FORBIDDEN.
24. Ruta HTTP: rechazo de manager perteneciente a otro tenant con 404 NOT_FOUND.
25. Ruta HTTP: manager autorizado consulta `probe=false` recibiendo 200 OK con `probe=null` sin llamar al proveedor.
26. Ruta HTTP: manager autorizado consulta `probe=true` recibiendo resultado de probe validado.

### 4.2 Suite de Contención de IA Previa (`packages/api/test/ai-containment.test.ts`)
```
npx vitest run packages/api/test/ai-containment.test.ts

 RUN  v4.1.11 C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-plan-20260920

 Test Files  1 passed (1)
      Tests  26 passed (26)
   Duration  891ms
```
Todas las pruebas de contención de alergias, contención dietaria determinística, fallback local, cuotas por comensal y restricciones de sesión permanecen 100% verdes.

### 4.3 Verificación de Matriz de Rutas
```
npm run check:routes
Matriz de rutas OK: 111 rutas clasificadas, sin novedades ni deriva.
```

### 4.4 Verificación de Esquema Supabase
```
npm run check:supabase-schema
schema.supabase.prisma está sincronizado con el schema canónico.
```

### 4.5 Verificación de Formato y Git Diff
```
git diff --check
(Salida limpia, 0 advertencias de espacios en blanco en código fuente)
```

### 4.6 Compilación Completa del Monorepo (`node scripts/build.mjs`)
```
🎉 BUILD COMPLETO EXITOSO (31.51s)
Resumen de compilación por workspace:
  ✓ @mesaya/shared             [OK] (1.15s)
  ✓ @mesaya/api                [OK] (5.16s)
  ✓ @mesaya/client-web         [OK] (2.47s)
  ✓ @mesaya/staff-panel        [OK] (10.25s)
  ✓ @mesaya/admin-dashboard    [OK] (11.02s)
  ✓ @mesaya/qr-generator       [OK] (1.46s)
```

---

## 6. Declaración de Estado Operativo

### PENDING_CLOUD
- **No se declara validación de credenciales en producción/cloud**: Todas las pruebas unitarias y de integración se ejecutaron con mocks herméticos y fixtures locales (`fetchMock`).
- La confirmación del funcionamiento de claves reales de Google Cloud / Gemini en el entorno de despliegue queda expresamente clasificada como **`PENDING_CLOUD`** hasta que un operador con acceso ejecute una prueba controlada con `GET /v1/restaurants/:id/ai/diagnostics?probe=true` contra el entorno real.

### PENDING_HUMAN
- Toda generación de carta gastronómica (`generateMenu`) continúa clasificada como vista previa con `applied: false` y requiere revisión y aprobación humana obligatoria por el encargado antes de impactar en la carta operativa.

---

## 7. Pase de Corrección Post-Revisión Independiente (NEEDS_REVIEW -> PASS_E10)

La revisión independiente previa del módulo E10 retornó dictamen `NEEDS_REVIEW` con cinco correcciones requeridas. Se aplicaron todas las soluciones y se agregaron pruebas de regresión completas:

### 7.1 Detalle de Correcciones Aplicadas

1. **Lector de respuestas acotado en bytes y streaming (`readBoundedJson`)**:
   - `packages/api/src/services/ai.service.ts` parseaba previamente con llamadas directas a `response.json()` o `response.text()` en `parseSafeProviderError` y `probeProvider`.
   - Se implementó un lector streaming unificado `readBoundedJson<T>(response, maxBytes, signal?)` que:
     - Exige la presencia obligatoria de `response.body.getReader()`.
     - Monitorea el tamaño acumulado de chunks decodificados con `TextDecoder`.
     - Si los bytes superan `maxBytes`, aborta inmediatamente el stream con `await reader.cancel()`, lanza `AiProviderError(INVALID_RESPONSE)` y nunca retiene ni loguea el cuerpo crudo.
     - Aplica límite estricto de 8KB (`MAX_ERROR_RESPONSE_BYTES = 8 * 1024`) para parsing de errores y 256KB (`MAX_RESPONSE_BYTES = 256 * 1024`) para probe y generación de menú.
2. **Eliminación de la rama de producción permisiva para fixtures**:
   - Se removió por completo la rama `if (!response.body) return await response.json();` que existía en `fetchGemini` únicamente para compatibilidad con fixtures simplificadas de Vitest.
   - El código en producción exige obligatoriamente stream legible. Las fixtures de tests en `e10-ai-diagnostics.test.ts` y `ai-containment.test.ts` fueron actualizadas para emitir instancias reales de Web Standard `Response` con cuerpo `ReadableStream`.
3. **Clasificación estricta de HTTP 429 sin asunción de cuota**:
   - En `classifyProviderFailure`, **únicamente** la razón explícita permitida en allowlist `QUOTA_EXCEEDED` mapea a `QUOTA_EXHAUSTED` (`retryable: false`).
   - Cualquier HTTP 429 con motivo ausente o desconocido se clasifica de forma segura y conservadora como `RATE_LIMITED` (`retryable: true`), evitando bloquear innecesariamente la función sin confirmación de cuota.
   - Se preserva explícitamente `RATE_LIMIT_EXCEEDED` como `RATE_LIMITED`.
4. **Privacidad de extracción de claves (`resolveAiKeyInfo`)**:
   - Se eliminó el método público estático `AIService.getKeyInfo()`.
   - La extracción de claves reside en la función privada a nivel de módulo `resolveAiKeyInfo()`, inaccesible desde el exterior de la clase.
   - `AIService` expone únicamente el método seguro `AIService.getKeyMetadata(): { configured: boolean; source: AiKeySource }`, sin exponer credenciales crudas.
   - Las pruebas de precedencia de claves fueron actualizadas para verificar a través de `getKeyMetadata()`, `getDiagnostics()` y los headers salientes `x-goog-api-key`.
5. **Nuevas pruebas de regresión agregadas**:
   - Bounded oversized error bodies (> 8KB): cancelación inmediata de stream, sin fugas de cuerpo y clasificación segura (`RATE_LIMITED` en 429, `INVALID_REQUEST` en 400).
   - Bounded oversized probe and generation bodies (> 256KB): cancelación inmediata de stream y degradación segura a `INVALID_RESPONSE` / `local-fallback`.
   - Safe HTTP 429 classification: pruebas para motivo nulo, motivo desconocido (`UNKNOWN_REASON`) y cuerpo vacío verificando clasificación a `RATE_LIMITED`.
   - No public raw key surface: verificación de que `(AIService as any).getKeyInfo` es `undefined` y `getKeyMetadata()` no contiene campos sensibles.
   - Inyección de credenciales simuladas en errores del proveedor verificando contención absoluta en diagnósticos y logs.

### 7.2 Evidencia de Verificación Local Post-Corrección

- **Suites E10 y Contención IA (`node scripts/test-local.mjs e10-ai-diagnostics.test.ts ai-containment.test.ts`)**:
  - `Test Files: 2 passed (2)`
  - `Tests: 57 passed (57)` (26 en containment + 31 en diagnostics)
  - Duración: ~1.48s
- **Matriz de Rutas (`npm run check:routes`)**:
  - 111 rutas clasificadas, 0 deriva.
- **Esquema Supabase (`npm run check:supabase-schema`)**:
  - `schema.supabase.prisma` 100% sincronizado con el esquema canónico.
- **Compilación Completa del Monorepo (`npm run build`)**:
  - 6/6 workspaces compilados con éxito en 25.98s:
    - `@mesaya/shared`: OK (1.16s)
    - `@mesaya/api`: OK (5.20s)
    - `@mesaya/client-web`: OK (1.61s)
    - `@mesaya/staff-panel`: OK (5.36s)
    - `@mesaya/admin-dashboard`: OK (11.25s)
    - `@mesaya/qr-generator`: OK (1.40s)
- **Verificación Git (`git diff --check`)**:
  - Salida limpia, sin errores de formato ni espacios residuales.

### 7.3 Estado de Aprobación y Conclusión

- **Dictamen Previo**: `NEEDS_REVIEW` (revisión independiente).
- **Estado Actual**: `PASS_E10` (revisión independiente final Antigravity Pro, `gemini-3.1-pro-high`, modo plan/sandbox read-only, 2026-09-21: verificó lector acotado, clasificación 429, ausencia de superficie pública de credenciales, modelos, fallback, RBAC/tenant, no fuga y gates locales. No se registraron cambios del worktree durante el review.)
