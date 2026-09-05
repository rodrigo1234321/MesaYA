# Reporte de etapa 21 — Build del cliente sin dependencias de demo

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Codex (GPT-5)
Ficha: [Etapa 21](../etapas/21-assets.md)
Predecesora aprobada: Etapa 20 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Retirado Tailwind Play CDN y configuración runtime del HTML; Tailwind/PostCSS/autoprefixer quedan en el build local.
- [x] Eliminados el selector de mesa/tema demo y su código consumidor; se conservó únicamente el rechazo de tokens demo como control de seguridad.
- [x] Eliminada la fuente duplicada `@import` de Google Fonts en `styles.css`; las fuentes permanecen declaradas una sola vez en `index.html`.
- [x] Restaurado el zoom del navegador quitando `maximum-scale` y `user-scalable=no`.
- [x] Medidos artefactos locales comprimidos y recursos externos con caché fría; se distinguió el núcleo inicial del pool estático completo.
- [x] Añadida regresión estática aislada para CDN, controles demo, zoom y configuración CSS.

No se modificó el diseño visual ni se introdujeron efectos, animaciones, framework o assets nuevos.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `apps/client-web/index.html` | Retiro CDN/config demo; viewport con zoom | Build productivo y accesibilidad básica |
| `apps/client-web/app.js` | Retiro selector demo y funciones de pills | Separar demo del producto |
| `apps/client-web/styles.css` | Entry points Tailwind local; retiro `@import` duplicado | Compilación CSS compatible |
| `apps/client-web/package.json` | Dependencias de build y `type: module` | PostCSS/Tailwind local |
| `apps/client-web/tailwind.config.js` | Configuración de contenido usada | Purga/compilación local |
| `apps/client-web/postcss.config.js` | Plugins Tailwind + autoprefixer | Pipeline Vite |
| `package-lock.json` | Refleja metadata/dependencias del workspace | Reproducibilidad del build |
| `packages/api/test/client-build-assets.test.ts` | Regresión estática de assets/productivo | Aceptación verificable |
| `scripts/test-isolated.mjs` | Registra la nueva suite aislada | Evidencia ejecutable |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---:|---|
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs client-build-assets` en la raíz | SQLite efímera del runner | 0 | 1 archivo, 3 tests PASS; `dev.db` intacta |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` en la raíz | Build producción, 6 workspaces | 0 | 6/6 workspaces PASS; client: HTML 36.50 KB, JS 50.27 KB, CSS 47.15 KB |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` en la raíz | 22 sandboxes SQLite efímeras | 0 | 22/22 suites PASS, 0 fallas |
| Script Node `fetch` con User-Agent Chrome sobre Google Fonts CSS, WOFF2 y hero Unsplash | HTTP frío, sin cookies/cache del proceso | 0 | CSS Google 15,850 B; 38 WOFF2 declarados 670,652 B; hero 178,839 B; total externo inventariado 865,341 B |
| Inspección de `dist/index.html` y `dist/assets` | Artefactos locales generados | — | Sin `cdn.tailwindcss.com`, sin controles demo; pool completo 7,368,400 B (7.23 MB) |

La medición externa es un inventario conservador de todos los WOFF2 que declara la hoja de Google; el navegador puede solicitar sólo los subconjuntos Unicode usados. Las imágenes de platos se cargan de forma lazy/dinámica y no se contaron como carga inicial; sí se contó el hero eager de Unsplash.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Build producción no carga Tailwind runtime ni presenta controles demo | PASS | Test `client-build-assets` y `dist/index.html` inspeccionados |
| Zoom y navegación por teclado básicos siguen disponibles | PASS | Viewport sin restricciones; controles siguen siendo elementos `button`; no se cambió focus management |
| Métricas incluyen recursos externos; no se afirma <100 KB sin medición | PASS | Tabla de métricas locales, externas y pool completo |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Secciones de evidencia e integridad; no se imprimieron secretos |
| Build completo y suite aislada aprobada ejecutados | PASS | Build 6/6; runner 22/22 |

## Integridad y seguridad

- Base demo intacta: SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` antes/después.
- Cruce tenant A/B: no corresponde a esta ficha; cubierto por suites previas sin regresión.
- Rechazo sin escrituras: no corresponde a esta ficha; cubierto por suites previas sin regresión.
- Build: 6/6 workspaces exitosos.
- Migración/paridad: no corresponde; no se tocó Prisma/schema.
- Ausencia de secretos en diff/logs: verificada por inspección; sólo URLs públicas de fuentes/assets existentes.

## Pendientes, riesgos y decisiones

Qué falta: ninguna tarea de código dentro de la ficha.
Qué impide avanzar: requiere revisión formal de Codex según protocolo.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: self-hosting/optimización adicional de fuentes e imágenes; no se alteró el diseño.

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la siguiente ficha al momento de crear este reporte.
Solicito revisión de Codex.
