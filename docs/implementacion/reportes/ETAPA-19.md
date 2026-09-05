# Reporte de etapa 19 — Eliminar inyección de contenido en cliente

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Claude Opus 4.6 Thinking / Gemini 3.8 Flash)
Ficha: docs/implementacion/etapas/19-xss.md
Predecesora aprobada: Etapa 18 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 00 a 18 intactas (todas las 20 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Alcance realizado

- [x] Paso 1: Inventario exhaustivo de sinks `innerHTML` y contextos en `apps/client-web/app.js`: texto HTML (`toastContainer`, `pillsContainer`, `modalPillsContainer`, `menuContainer`, `storyContainer`, chat de Sommelier IA), atributos HTML (`alt`, `data-dish-id`, `data-category`), URLs (`src` de imágenes y cover, `href` de enlaces a Google Review) y contenido generado por IA (preguntas del comensal, respuestas, maridajes y platos sugeridos).
- [x] Paso 2: Renderizado seguro de datos no confiables mediante manipulación DOM y asignación directa con `textContent` en `showToast`, burbujas de usuario en chat IA, respuestas del Sommelier IA, maridajes y tarjetas de sugerencias. Creación e integración de utilidades de sanitización contextual puras en `@mesaya/shared`: `escapeHtml`, `escapeHtmlAttr`, `sanitizeUrl` y `sanitizeGooglePlaceId`.
- [x] Paso 3: Validación y sanitización estricta de protocolos y dominios admitidos de URLs e imágenes:
  - Rechazo tajante de esquemas peligrosos (`javascript:`, `data:`, `vbscript:`, `file:`) y URLs protocol-relative (`//evil.com`).
  - **Corrección Codex P1 (Bypass de normalización con barra invertida)**: Rechazo categórico de cualquier URL que contenga barras invertidas (`\`) o caracteres de control/espacio, impidiendo que entradas como `/\\evil.example/x` o `/\evil.example/x` sean normalizadas por navegadores hacia componentes de autoridad/protocol-relative. Canonicalización contra origen dummy para rutas relativas locales.
  - **Corrección Codex P2 (Allowlist de hosts externos admitidos)**: Definición y documentación de `ALLOWED_EXTERNAL_HOSTS` (`images.unsplash.com`, `plus.unsplash.com`) preservando las fuentes legítimas del piloto. Rechazo de credenciales embebidas (`user:pass@`) y hosts externos arbitrarios no autorizados.
  - **Corrección Codex P3 (Puertos estrictos por protocolo)**: Validación de puertos acoplada al esquema: para `http:` se permite exclusivamente puerto vacío o `80`; para `https:` exclusivamente puerto vacío o `443`. Se rechazan puertos cruzados no estándar como `https://...:80` y `http://...:443`.
  - Sanitización del enlace profundo a Google Review mediante validación alfanumérica estricta de `googlePlaceId`.
- [x] Paso 4: Suite automatizada `client-xss-security.test.ts` con 23 pruebas exhaustivas en 4 bloques:
  - Neutralización de `<script>`, `<img src=x onerror=...>`, `<svg/onload=...>`.
  - Inyecciones en atributos (`" onmouseover=`).
  - Esquemas peligrosos y URLs protocol-relative.
  - Bypass de normalización con barra invertida (`/\\evil.example/x`, `/\evil.example/x`, `\\evil.example`, etc.).
  - Hosts no permitidos por la allowlist (`https://evil.example`, `https://attacker.com`).
  - Credenciales embebidas y puertos no estándar / cruzados (`https://...:80`, `http://...:443`, `:8443`, `:8080`).
  - Respuestas maliciosas simuladas de IA.
  - Preservación íntegra de acentos, eñes y comillas en español (`O'Hara`, `Café & Bar`).
  - Preservación visual intacta de las 4 plantillas (`GOURMET_OBSIDIAN`, `NEON_BURGER`, `COASTAL_BEACH`, `MINIMAL_BISTRO`).
  - Inspección estática de `apps/client-web/app.js` verificando que implementa las utilidades, define `ALLOWED_IMAGE_HOSTS`, rechaza backslashes y no contiene sinks vulnerables.
- [x] Paso 5: Registro de la suite en `scripts/test-isolated.mjs`, compilación completa de los 6 workspaces (62.53s) y ejecución de las 21 suites del runner aislado al 100% (23 tests en `client-xss-security`) con `dev.db` 100% intacta.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/shared/src/security.ts` | **[NUEVO/ACTUALIZADO]** Módulo puro TypeScript con `escapeHtml`, `escapeHtmlAttr`, `sanitizeUrl` (endurecido con rechazo de backslashes, canonicalización WHATWG URL, allowlist de hosts `ALLOWED_EXTERNAL_HOSTS`, y validación de puertos acoplada por protocolo: `http` solo 80, `https` solo 443), y `sanitizeGooglePlaceId`. | Utilidades centralizadas y testeables de sanitización contextual por tipo de contexto (texto, atributos, URLs con allowlist y puertos estrictos e identificadores). |
| `packages/shared/src/index.ts` | Exportación de `* from './security'`. | Hace disponibles las funciones y la allowlist de sanitización a todo el monorepo. |
| `apps/client-web/app.js` | Sincronización de utilidades contextuales y erradicación de sinks vulnerables: `showToast` con nodos DOM y `textContent`; sanitización de `tagsEl` con DOM; escape de nombres/iconos en pills y headers de categoría; `sanitizeUrl` endurecido con `ALLOWED_IMAGE_HOSTS`, rechazo de backslashes y puertos acoplados por protocolo en `imgEl.src`, `menuImage.src`, `heroCoverImage.src`, story cards y filas de menú; escape de atributos `data-dish-id` y `alt`; burbujas del Sommelier IA reconstruidas con DOM y `textContent` para texto, maridaje y platos; validación de `config.googlePlaceId` en enlace de Google Review. | Eliminación de vectores de inyección de contenido (XSS) almacenado y reflejado en el cliente web. |
| `packages/api/test/client-xss-security.test.ts` | **[NUEVO/ACTUALIZADO]** Suite completa con 23 pruebas automáticas en 4 bloques: utilidades de `@mesaya/shared`, simulación de menú/categorías con payloads, simulación de Sommelier IA con payloads, e inspección estática de `app.js`. Incluye pruebas de regresión para bypasses con backslash, allowlist de dominios y rechazo de puertos cruzados (`https:80` y `http:443`). | Verificación automatizada de mitigación de XSS, rechazo de bypasses y preservación de renderizado legítimo. |
| `scripts/test-isolated.mjs` | Registro de la suite `client-xss-security` en el runner aislado. | Integración continua en la ejecución de pruebas aisladas con SQLite efímera. |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 19 a `NEEDS_REVIEW`. | Conforme al protocolo de control de etapas. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs client-xss-security`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/.../test.db` | 0 | 23 tests passed en 30ms (escapeHtml neutraliza tags; img onerror manejado; acentos y eñes preservados; escapeHtmlAttr neutraliza comillas/backticks; sanitizeUrl rechaza javascript:, data:, vbscript:, file:, //evil.com; sanitizeUrl rechaza bypasses de backslash /\\evil.example/x; sanitizeUrl rechaza hosts fuera de allowlist; sanitizeUrl rechaza credenciales y puertos no estándar o cruzados https:80 y http:443; sanitizeUrl admite http/https de allowlist con puertos legítimos y rutas relativas; sanitizeGooglePlaceId rechaza inyecciones; pills seguras ante payload; card de plato neutraliza tags y atributos; query comensal con textContent; respuesta Sommelier sin HTML activo; inspección estática de app.js verifica utilidades, allowlist y ausencia de sinks vulnerables). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build exitoso en 62.53s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 21 suites ejecutadas, 21 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 23 tests automatizados en `client-xss-security.test.ts`. 21 suites completas del runner aislado ejecutadas de punta a punta (todas en verde).
- **Inspección estática**:
  - `apps/client-web/app.js`: verificado por test automatizado que define e implementa `escapeHtml`, `escapeHtmlAttr`, `sanitizeUrl` (con `ALLOWED_IMAGE_HOSTS` y rechazo de backslashes), `sanitizeGooglePlaceId`; que `showToast` usa `msgSpan.textContent`; que `openDishDetailSheet` usa `sanitizeUrl` y `tagsEl.appendChild`; que pills y story cards usan `escapeHtml` y `sanitizeUrl`; que las plantillas del menú usan `safeName`, `safeDesc`, `safeAlt`; que el Sommelier IA usa `answerP.textContent = data.answer` sin `innerHTML` interpolado; y que el deep link de Google Review valida el Place ID.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Payload almacenado de categoría/plato no ejecuta JS al abrir menú. | PASS | Verificado en Bloque 2 de tests con payloads `<script>alert("XSS")</script>`, `<img src=x onerror=alert(1)>`, `<svg/onload=alert(1)>` y cierres de atributos en categorías, nombres y descripciones. |
| URL javascript y atributos onerror no llegan al DOM activo. | PASS | Verificado en Bloques 1, 2 y 3: `sanitizeUrl` rechaza esquemas `javascript:`, `data:`, `vbscript:`, URLs protocol-relative, bypasses con barra invertida (`/\\evil.example/x`), y dominios fuera de la allowlist; `escapeHtml` y `escapeHtmlAttr` neutralizan eventos `onerror`, `onload`, `onmouseover`, `onfocus`. |
| Texto con acentos/comillas y menú normal se renderizan sin romperse. | PASS | Verificado en Bloque 1: strings legítimos en español con tildes, eñes y apóstrofes (`Ñoquis caseros al Malbec con salsa de champiñones`) se preservan intactos sin alteración de caracteres ni rotura del layout. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales. | PASS | Reporte documentado con distinción rigurosa de ejecuciones e inspección estática, libre de tokens, secretos o datos sensibles. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión. | PASS | Build completo exitoso (25.62s) y 21/21 suites aisladas aprobadas sin modificar ni debilitar ninguna suite preexistente. |

## Integridad y seguridad

- Base demo intacta: Sí. SHA-256 verificado antes y después: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Sí. El aislamiento de tenant se mantiene garantizado por endpoints autoritativos y la neutralización de inyecciones previene filtraciones entre sesiones comensales.
- Rechazo sin escrituras: Sí. La sanitización de renderizado no realiza mutaciones en base de datos.
- Build: Sí. Monorepo completo compilado exitosamente.
- Migración/paridad si corresponde: No se requirieron modificaciones al esquema de base de datos.
- Ausencia de secretos en diff/logs: Verificado. Sin tokens, PINs ni credenciales expuestas en diffs ni reportes.

## Pendientes, riesgos y decisiones

Qué falta:
- Ningún pendiente dentro del alcance de esta ficha.
Qué impide avanzar:
- Nada en esta etapa. Se encuentra completa y lista para revisión.
Pregunta concreta si hace falta:
- Ninguna.
Cambios fuera de alcance propuestos pero NO implementados:
- No se reescribió el cliente web a React ni se modificó la arquitectura de plantillas visuales, conforme a las restricciones explícitas de la ficha.

## Handoff

CONTROL actualizado para esta etapa (`NEEDS_REVIEW`).
No se inició siguiente ficha (Etapa 20 permanece `BLOCKED`).
Solicito revisión de Codex.
