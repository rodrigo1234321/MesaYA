# Reporte de etapa 20 — Acotar generación IA y validar respuestas

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Claude Opus 4.6 Thinking / Gemini 3.8 Flash)
Ficha: docs/implementacion/etapas/20-ia-limites.md
Predecesora aprobada: Etapa 19 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 00 a 19 intactas (todas las 21 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Alcance realizado

- [x] **Paso 1: Schemas de validación Zod en `@mesaya/shared` (`packages/shared/src/ai-schemas.ts`)**:
  - `AiMenuGenerateInputSchema`: valida `prompt` (mín. 3, máx. 500 caracteres), `concept` (máx. 500), `templateId` (validado contra `MenuTemplateIdSchema` de 4 plantillas oficiales), `autoApply` (boolean) y `gastronomyType` (máx. 50). Rechaza inputs vacíos o menores a 3 caracteres.
  - `AiMenuItemOutputSchema`: valida plato generado con límites estrictos (`name` máx. 80, `description` máx. 300, `price` positivo máx. 1.000.000, `imageUrl` máx. 500 y sanitizado, `tags` máx. 10 con ítems de máx. 30 caracteres, `isFeatured` boolean).
  - `AiMenuCategoryOutputSchema`: valida categoría con `name` máx. 60, `icon` máx. 10 y entre 1 y 15 platos por categoría.
  - `AiMenuGenerateOutputSchema`: valida estructura completa con máx. 10 categorías, template por defecto seguro `GOURMET_OBSIDIAN` y color temático hexadecimal válido (#RRGGBB).
  - `AiSommelierInputSchema`: exige consulta acotada (1 a 300 caracteres) y presencia obligatoria de `sessionToken`.
  - `AiSommelierOutputSchema`: valida `answer` (máx. 500 caracteres), `recommendedDishIds` (máx. 5 IDs) y `suggestedPairing` (máx. 150 caracteres).
- [x] **Paso 2: Acotamiento y resiliencia en `AIService` (`packages/api/src/services/ai.service.ts`)**:
  - **Feature Flag por defecto**: `isAiFeatureEnabled()` verifica `process.env.ENABLE_AI_FEATURES === 'true' || process.env.AI_FEATURE_ENABLED === 'true'`. Por defecto deshabilitada (`false`). Cuando está inactiva, `generateMenu` retorna vista previa degradada sin tocar `fetch`, y `askSommelier` utiliza directamente el recomendador heurístico local sin llamar al proveedor externo.
  - **Modelos reales y configurables**: Se eliminaron modelos ficticios (`gemini-3.6-flash`, `gemini-3.7-flash`, etc.). Se utilizan modelos reales: primario `process.env.GEMINI_MODEL || 'gemini-1.5-flash'` y secundario `process.env.GEMINI_FALLBACK_MODEL` (si está definido). Se acotan los reintentos a `MAX_AI_ATTEMPTS = 2`.
  - **Timeout y cancelación con `AbortController`**: Cada llamada externa utiliza `timeoutMs = this.getAiTimeoutMs()` (por defecto 8000ms o configurable por `AI_TIMEOUT_MS`). Ante timeout o `AbortError`, se libera el temporizador, se registra la advertencia y se retorna modo degradado limpio sin mutación parcial ni daño en base de datos.
  - **Validación estricta en runtime de salidas LLM**: Las respuestas del modelo se analizan con `AiMenuGenerateOutputSchema` y `AiSommelierOutputSchema`. Si la estructura es malformada o viola restricciones, se descarta limpiamente y se continúa al siguiente modelo o degradado.
  - **Sanitización de URLs**: Todas las `imageUrl` de platos generados son procesadas con `sanitizeUrl(item.imageUrl, '')`, descartando URLs que no pertenezcan a la allowlist autorizada o contengan esquemas inseguros.
- [x] **Paso 3: Validación de rutas, sesiones de mesa y cuotas en `menu.routes.ts`**:
  - `POST /restaurants/:slugOrId/menu/ai-generate`: protegido con `requireManagedRestaurant`. Valida el body con `AiMenuGenerateInputSchema`. Se mantiene la regla de contención: `autoApply` jamás escribe ni borra el menú; devuelve siempre vista previa con `applied: false` para revisión humana obligatoria.
  - `POST /restaurants/:slugOrId/ai-sommelier`: valida el body con `AiSommelierInputSchema`.
    - **Validación de sesión de mesa (`TableSession`)**: Busca la sesión por `token`. Si no existe, devuelve 401; si `closedAt` está presente, devuelve 410 (sesión finalizada); si expiró según `expiresAt`, devuelve 401; si la mesa no pertenece al restaurante consultado (`slugOrId`), devuelve 403.
    - **Control de cuota por comensal (`SommelierQuotaManager`)**: Limita a un máximo de 10 consultas por sesión de mesa en memoria con expiración. Si el comensal excede las 10 consultas, responde HTTP 429 con `{ error: '...', code: 'QUOTA_EXCEEDED', remainingQueries: 0 }`.
- [x] **Paso 4: Prevención y aviso de seguridad en UI de administración (`AIChefAssistantModal.tsx`)**:
  - Incorporación de banner de advertencia sobre seguridad alimentaria y alérgenos: *"Aviso de Seguridad y Alérgenos: Las propuestas generadas por IA son sugerencias creativas y requieren revisión humana obligatoria. Verifica descripciones, precios, alérgenos y trazabilidad de ingredientes antes de publicar en la carta activa."*
  - Reemplazo del botón de acción: de una promesa engañosa de publicación desatendida a *"✓ Importar Propuesta para Revisión Manual en Menú"*, reforzando que no se publican alérgenos ni descripciones sin intervención humana.
- [x] **Paso 5: Batería de pruebas automatizadas con mocks en `ai-containment.test.ts`**:
  - 23 tests automáticos ejecutados con fixtures ficticias y mocks estrictos de `fetch` y `prisma` (cero llamadas a APIs externas pagadas).
  - Cobertura de feature flag apagado por defecto (no llama a fetch con clave válida).
  - Cobertura de rechazo por Zod ante prompt menor a 3 caracteres.
  - Cobertura de timeout AbortController devolviendo degradado limpio sin mutación, incluso cuando se reciben headers y el cuerpo queda colgado.
  - Cobertura de modelos reales configurables y límite a 2 reintentos.
  - Cobertura de validación de salida Zod y sanitización de URLs de platos (anulación de URLs fuera de allowlist).
  - Cobertura de validación de `sessionToken` en Sommelier: rechazo de token faltante (400), inexistente (401), cerrado (410) y pertenencia a otro restaurante (403).
  - Cobertura de cuota de 10 consultas por mesa y respuesta 429 (`QUOTA_EXCEEDED`).
- [x] **Paso 6: Verificación completa del monorepo y base demo**:
  - Compilación exitosa de los 6 workspaces con `build.mjs` (37.84s).
  - Ejecución de las 21 suites en el runner aislado `test-isolated.mjs` (todas PASSED, 0 fallidas); la suite de IA usa Prisma mockeado y no constituye por sí sola una prueba HTTP SQLite real.
  - Verificación del hash SHA-256 de `packages/api/prisma/dev.db`, permaneciendo 100% intacto.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/shared/src/ai-schemas.ts` | **[NUEVO]** Módulo Zod con schemas de entrada y salida para generación de carta y consultas de sommelier (`AiMenuGenerateInputSchema`, `AiMenuGenerateOutputSchema`, `AiSommelierInputSchema`, `AiSommelierOutputSchema`). | Validación en tiempo de ejecución de inputs/outputs con límites estrictos de longitud y formato. |
| `packages/shared/src/index.ts` | Exportación de `* from './ai-schemas'` y tipado opcional `concept` / `gastronomyType` en `GenerateMenuAiDTO`. | Contratos compartidos y tipado estricto entre frontend, backend y pruebas. |
| `packages/api/src/services/ai.service.ts` | Integración de Zod schemas, feature flag `isAiFeatureEnabled()`, timeout configurable vía `AbortController`, modelos reales (`gemini-1.5-flash` / `gemini-1.5-pro`), límite a 2 reintentos y sanitización de imágenes con `sanitizeUrl`. | Acotamiento de llamadas al LLM, cancelación por timeout y descarte de respuestas malformadas o inseguras. |
| `packages/api/src/routes/menu.routes.ts` | Validación Zod en rutas de IA, gestor de cuotas en memoria `SommelierQuotaManager` (máx 10 consultas por sesión), y validación estricta de `TableSession` (activa, no expirada, no cerrada, coincidencia de tenant). | Protección contra abuso, llamadas descontroladas y consultas fuera de mesa autorizada. |
| `apps/admin-dashboard/src/components/AIChefAssistantModal.tsx` | Banner de advertencia de alérgenos/seguridad y cambio de texto del botón para enfatizar revisión manual del manager. | Prevención de publicación desatendida de alérgenos y cumplimiento de seguridad alimentaria. |
| `packages/api/test/ai-containment.test.ts` | Expansión de suite con pruebas específicas para Etapa 20 (23 pruebas totales en la suite) con mocks completos, incluyendo turno ausente/ajeno y deadline durante lectura del cuerpo. | Verificación automatizada sin costo de API externa de todos los controles de contención. |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 20 a `NEEDS_REVIEW`. | Conforme al protocolo de control de etapas. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs ai-containment`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Runner crea SQLite efímera, pero esta suite mockea Prisma; no es evidencia de persistencia HTTP real | 0 | 23 tests passed: clave Notion no usada; sin clave no llama a fetch; respuesta inválida degradada; respuesta válida preview con applied=false; catálogo sin coincidencias abstención; consulta de alergia deriva a personal; catálogo con tags sin promesas absolutas; vegano vs vegetariano diferenciado; respuesta con ID conocido+inventado rechazada íntegramente; autoApply=true no muta DB; feature flag inactivo por defecto no llama a fetch; inputs Zod; timeout durante petición y cuerpo colgado; modelos configurables con máximo 2 intentos; validación Zod y sanitización URL; sommelier rechaza token faltante (400), sesión inexistente (401), cerrada (410), sin turno (410), turno ajeno (403) y tenant ajeno (403); cuota de 10 consultas responde 429. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build completo exitoso en 37.84s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 21 suites ejecutadas, 21 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 23 tests automatizados en `ai-containment.test.ts`; sus adaptadores de Prisma son mocks y no simulan escrituras SQLite. 21 suites completas del runner aislado ejecutadas de punta a punta (todas en verde).
- **Inspección de código y tipos**: Compilación completa de TypeScript en monorepo sin errores ni `any` indebidos; `AIChefAssistantModal.tsx` verificado con advertencia visual de alérgenos y sin claims de publicación desatendida.

## Criterios de aceptación cumplidos

- [x] **Validación de esquema y límites**: Los inputs y outputs de generación y sommelier se validan en tiempo de ejecución con schemas Zod estrictos. Las respuestas malformadas nunca se aplican ni mutan la base de datos.
- [x] **Control de tiempo de espera y cancelación**: Implementado `AbortController` con timeout configurable (por defecto 8000ms), cancelando la petición y retornando un modo degradado limpio sin escrituras parciales.
- [x] **Sin cascadas desmedidas de modelos**: Modelos reales configurables (`gemini-1.5-flash`, `gemini-1.5-pro`), eliminando modelos ficticios y acotando los intentos a un máximo de 2.
- [x] **Autorización y contexto**: La generación de cartas gastronómicas está restringida a roles `MANAGER`. La función de Sommelier exige una sesión de mesa activa (`TableSession`), no expirada, no cerrada y asociada al tenant correcto, con cuota máxima de 10 consultas por sesión (429 al exceder).
- [x] **Feature flag inactivo por defecto**: La funcionalidad de IA externa permanece deshabilitada por defecto (`ENABLE_AI_FEATURES !== 'true'`), retornando preview degradada o recomendador heurístico local sin llamar al proveedor externo.
- [x] **Seguridad alimentaria y alérgenos**: UI de administración advierte explícitamente sobre la necesidad de revisión humana de ingredientes y alérgenos antes de publicar en carta; el sommelier mantiene la abstención determinística ante alergias y celiaquía sin garantías absolutas de modelo.
- [x] **Pruebas sin llamadas a APIs pagadas**: La suite de IA funciona con mocks de `fetch` y Prisma (sin costo); el runner usa SQLite efímera para aislamiento general. No se afirma aquí una prueba HTTP SQLite específica para Sommelier.
- [x] **Base demo intacta**: `packages/api/prisma/dev.db` mantiene su hash SHA-256 canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- [x] **Etapa 21 no iniciada**: Queda habilitada en estado `READY` en `CONTROL.md` después de la aprobación de Codex.

## Conclusión y paso siguiente

Tras la corrección solicitada por la revisión, la Etapa 20 queda implementada y verificada: el deadline cubre headers y cuerpo, Sommelier exige turno operativo del tenant, las respuestas con IDs inventados se descartan completas y la UI permanece en preview. Codex registró `APPROVED` en `revisiones/ETAPA-20.md` y habilitó la Etapa 21 en `READY`.
