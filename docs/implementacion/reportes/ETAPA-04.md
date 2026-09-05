# Reporte de etapa 04 — Quitar fallbacks engañosos de IA

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: OpenCode con Muse Spark 1.3 Contributor Free
Ficha: docs/implementacion/etapas/04-ia-contencion.md
Predecesora aprobada: 03 APPROVED (revisiones/ETAPA-03.md)
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas
Commit de base o manifiesto: sin Git (resuelve al home); base intacta verificada por hash dev.db 499c2f9cd68d2207 persistente en los 3 comandos
Cambios previos preservados: ninguno tocado fuera de los 6 archivos autorizados; tests existentes sin modificar

## Alcance realizado

- [x] Paso 1: retirar NOTION_API_KEY y NOTION_TOKEN como credenciales Gemini; sin clave válida, modo degradado explícito (ai.service.ts getGeminiApiKey + degradedMenuPreview).
- [x] Paso 2: sin coincidencias dietarias verificadas no se eligen platos arbitrarios; abstención con derivación al personal; vegano estricto (sólo VEGAN) diferenciado de vegetariano (VEGETARIAN o VEGAN); alergias con abstención completa (detectDietaryIntent + deterministicDietaryAnswer + heurístico corregido).
- [x] Paso 3: eliminadas afirmaciones de ausencia de alérgenos/trazabilidad ("100% libres", "trazabilidad cuidada"); todo match por etiqueta lleva disclaimer de que las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada. Respuesta Gemini validada: IDs desconocidos se descartan y jamás se devuelven platos inexistentes ni fallback arbitrario.
- [x] Paso 4: autoApply desactivado en la ruta ai-generate (se eliminó el bloque $transaction/deleteMany/create): siempre preview con applied=false y reviewNote pendiente de revisión humana. Eliminado el motor curado de respaldo (generateCuratedFallbackMenu) para generateMenu. Suite nueva ai-containment.test.ts con mocks cubre: clave sólo Notion, sin clave, respuesta inválida, respuesta válida (applied=false), sin coincidencias, alergia, tags sin promesa, vegano vs vegetariano, IDs desconocidos y autoApply sin mutaciones.

No copiar criterios como cumplidos sin ejecutarlos.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| packages/api/src/services/ai.service.ts | Sin Notion como clave; degradado explícito en generateMenu; ruta dietaria determinística con abstención; validación de IDs Gemini; heurístico sin garantías ni picks arbitrarios dietarios; eliminado fallback curado | Checklist 1–4 |
| packages/api/src/routes/menu.routes.ts | Eliminado bloque de escritura con autoApply; respuesta siempre preview con applied/degraded/reviewNote | Checklist 4, aceptación autoApply |
| packages/api/test/ai-containment.test.ts | NUEVO: 10 tests con mocks de fetch y Prisma, fixtures ficticias | Evidencia exigida por handoff |
| packages/shared/src/index.ts | Campos opcionales degraded/applied/reviewNote en GenerateMenuAiResponseDTO y degraded en SommelierResponseDTO | Contrato de modo degradado explícito |
| scripts/test-isolated.mjs | Registro de suite ai-containment con needsSeed=false; controles de proceso intactos | Habilitar suite aislada |
| docs/implementacion/CONTROL.md | 04 READY -> IN_PROGRESS -> NEEDS_REVIEW | Protocolo |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| node scripts/test-isolated.mjs packages/api/test/ai-containment.test.ts (cwd proyecto) | SQLite efímera .tmp/qa + mocks, needsSeed=false | 0 (2.º intento; 1.º con 2 fallos de regex propias del test, corregidas) | 10/10 PASS |
| node scripts/build.mjs (cwd proyecto) | producción, 6 workspaces | 0 | 6/6 OK (shared, api+Prisma, client-web, staff-panel, admin-dashboard, qr-generator) |
| node scripts/test-isolated.mjs (cwd proyecto) | SQLite efímera por suite + seed aislado donde corresponde | 0 | 18+10+9+12+39=88/88 PASS, 5/5 suites |

Extractos: dev.db SHA-256 499c2f9cd68d2207… intacta antes/después en los 3 comandos. Quedó sandbox forense dcf10f58… del primer intento fallido (el runner lo conserva; otros sandboxes previos también presentes en .tmp/qa). Sin tokens/PINs en logs (claves de test ficticias: g-ficticia, ntn_ficticia).

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Pedido sin gluten sin datos suficientes no recibe platos arbitrarios ni garantía | PASS | Tests abstención sin coincidencias + tags con disclaimer; sin "100%"/"trazabilidad" en código |
| Variables Notion nunca enviadas como clave de otro proveedor | PASS | getGeminiApiKey sólo GEMINI/GOOGLE; test Notion-only con fetch no llamado |
| Generación con autoApply=true no borra ni publica menú | PASS | Sin $transaction/deleteMany/create/update en handler; test de ruta con autoApply:true y 5 mocks de mutación no llamados; applied=false |
| Reporte distingue ejecutado/no ejecutado/inspección; sin secretos | PASS | Este reporte; sólo fixtures ficticias |
| Build completo y suite aislada aprobados; sin ocultar regresiones | PASS | Build 6/6 exit 0; 88/88 exit 0; tests existentes intactos |

## Integridad y seguridad

- Base demo intacta: sí, hash 499c2f9cd68d2207… verificado por el runner en las 3 ejecuciones.
- Cruce tenant A/B: no aplica (sin tenant nuevo; mocks no tocan Prisma real).
- Rechazo sin escrituras: autoApply=true verificado sin mutaciones vía mocks; abstenciones con arrays vacíos.
- Build: 6/6 workspaces exit 0.
- Migración/paridad si corresponde: no corresponde (sólo campos opcionales añadidos; sin cambios de schema).
- Ausencia de secretos en diff/logs: sí; .env nunca leído por los tests (mocks puros); .env del proyecto sólo cargado por runners de infra.

## Pendientes, riesgos y decisiones

Qué falta: revisión de Codex (APPROVED o CHANGES_REQUESTED).
Qué impide avanzar: nada dentro de la ficha; etapa 05 sigue BLOCKED hasta aprobación.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: validación de secretos/CORS/JWT (etapa 05), matriz de autorización de rutas IA (etapas 06+), persistencia real de menús generados tras revisión humana (requiere diseño y ficha propia); heurístico no dietario conserva sugerencias de destacados (no dietario, sin promesas de seguridad).

## Handoff

CONTROL actualizado sólo para esta etapa (04 NEEDS_REVIEW con reporte).
No se inició siguiente ficha.
Solicito revisión de Codex: «Codex, revisá la etapa 04».
