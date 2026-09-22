# Registro de Hallazgos — Remediación MesaYA

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## Estado de los hallazgos:
- `CONFIRMED`: Reproducido en el candidato.
- `ALREADY_FIXED_VERIFIED`: Ya resuelto en la línea canónica (`origin/main`), verificado con evidencia.
- `FALSE_POSITIVE_EVIDENCED`: Falso positivo demostrado mediante código y tests.
- `FIXED_VERIFIED`: Corregido en este ciclo y verificado fehacientemente mediante pruebas automatizadas/reales.
- `REOPENED`: Reabierto tras revisión independiente por falta de cobertura, brecha de seguridad o evidencia insuficiente.
- `PENDING_EXTERNAL`: Requiere acción humana o cloud externa (ej. rotación de secrets en hosting).

---

## Matriz de Hallazgos y Resolución (Actualizada en C00)

| ID | Sección / Tema | Archivo(s) | Prioridad | Etapa | Estado Actual | Observaciones / Acción de Continuación |
|---|---|---|---|---|---|---|
| `SEC01-01` | Git: main atrasado | Repo / Worktree | P0 | R00 | `FIXED_VERIFIED` | Worktree aislado creado desde `origin/main` en rama `codex/remediacion-auditoria-20260921`. |
| `SEC01-02` | Git: cambios locales en main | `apps/client-web/*`, `scripts/*` | P1 | R00 | `ALREADY_FIXED_VERIFIED` | Cambios integrados en `origin/main`. Árbol dirty de `main` preservado en repo original. |
| `REV-01-A` | Sanitización: 400 serializa message/details no autorizados | `packages/api/src/lib/errorHandler.ts` | P0 | C01 | `REOPENED` | Inyección de error con `message: 'api_key=...'` y `details: { authorization: '...' }` se exponían. Allowlist estricta requerida. |
| `REV-01-B` | Sanitización: 400 serializa `error` cuando `message` es seguro | `packages/api/src/lib/errorHandler.ts` | P0 | C01 | `REOPENED` | Inyección con `error: 'password=...'` se exponía en respuesta 400. Validación aislada de cada campo requerida. |
| `SEC02-01` | Backend: filtración `err.message` en 500 | `packages/api/src/routes/*.routes.ts` | P0 | C01 | `REOPENED` | 500 unificado pero debe revisarse junto con C01 para garantizar blindaje total contra filtraciones. |
| `SEC02-02` | Backend: bypass de `errorHandler.ts` | `packages/api/src/routes/*.routes.ts` | P0 | C01 | `FIXED_VERIFIED` | 6 bloques catch con bypass manual eliminados y enrutados a `sendSanitizedError`. |
| `SEC03-01` | TypeScript: `any` en `apps/admin-dashboard` | `apps/admin-dashboard/src/lib/api.ts`, `App.tsx` | P1 | C02 | `REOPENED` | Revisión detectó persistencia de `any` en clientes API sin inventario individual. |
| `SEC03-02` | TypeScript: `any` en `apps/staff-panel` | `apps/staff-panel/src/components/*` | P1 | C02 | `REOPENED` | Persistencia de `any` en llamadas fetch y clientes API sin tipado estricto. |
| `SEC03-03` | TypeScript: `any` en servicios backend | `packages/api/src/services/*` | P2 | C02 | `FIXED_VERIFIED` | Modelos de `@prisma/client` aplicados en servicios de turno y staff. |
| `SEC04-01` | React: ErrorBoundary en Staff Panel | `apps/staff-panel/src/components/ErrorBoundary.tsx` | P0 | C04 | `REOPENED` | Requiere prueba montando árbol React con fallo de render en DOM y verificación de fallback. |
| `SEC04-02` | React: ErrorBoundary en Admin Dashboard | `apps/admin-dashboard/src/components/ErrorBoundary.tsx` | P0 | C04 | `REOPENED` | Test actual solo instanciaba métodos; requiere prueba con componente fallido en DOM real. |
| `SEC05-01` | UI: Acciones silenciosas en Staff Panel | `apps/staff-panel/src/App.tsx`, `ServiceWorkspace.tsx` | P0 | C04 | `REOPENED` | Alertas inline añadidas; falta test de interacción que valide bloqueo de doble click e incertidumbre de red. |
| `SEC05-02` | UI: Error oculto detrás de modal en StaffManager | `apps/admin-dashboard/src/components/StaffManager.tsx` | P1 | C04 | `FIXED_VERIFIED` | Alerta accesible dentro del modal y botón deshabilitado. |
| `SEC05-03` | UI: Acciones silenciosas en TablesManager y MenuManager | `apps/admin-dashboard/src/components/TablesManager.tsx` | P1 | C04 | `FIXED_VERIFIED` | Feedback visual en modales y manejo de error con retry. |
| `SEC06-01` | Lint: Configuración ESLint y 1492 warnings | Raíz, packages, apps | P1 | C02 | `REOPENED` | Exit code 0 no acredita cierre: faltan reglas de hooks React y a11y; reportar deuda clasificada. |
| `SEC06-02` | Lint: `noUnusedLocals: false` en tsconfig | `apps/*/tsconfig.json` | P2 | C02 | `REOPENED` | Falso `ALREADY_FIXED`: los archivos tsconfig tenían `noUnusedLocals: false`. Se debe activar y resolver. |
| `SEC07-01` | Hooks: `useSSE` usa PollingCoordinator | `apps/staff-panel/src/hooks/useSSE.ts` | P1 | R08 | `FIXED_VERIFIED` | Alias canónico `useCallsPolling` exportado con tipado estricto. |
| `SEC07-02` | Hooks: `useFloorPlanSSE` usa PollingCoordinator | `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts` | P1 | R08 | `FIXED_VERIFIED` | Alias canónico `useFloorPlanPolling` exportado con tipado estricto. |
| `SEC07-03` | Hooks: `buildStaffStreamUrl` a endpoint 410 GONE | `apps/staff-panel/src/hooks/useSSE.ts` | P2 | R08 | `FIXED_VERIFIED` | Anotado como `@deprecated` señalando la obsolescencia del endpoint `/stream` (`410 GONE`). |
| `SEC08-01` | Dead Code: Métodos API sin uso en StaffApi | `apps/staff-panel/src/lib/api.ts` | P2 | R08 | `FALSE_POSITIVE_EVIDENCED` | `tapTableState` y `payOrder` están en uso activo. Preservados. |
| `SEC08-02` | Dead Code: Métodos API sin uso en AdminApi | `apps/admin-dashboard/src/lib/api.ts` | P2 | R08 | `FALSE_POSITIVE_EVIDENCED` | Métodos mapeados a endpoints Fastify válidos. Preservados. |
| `SEC08-03` | Deps: `konva`, `react-konva`, `zustand` en staff-panel | `apps/staff-panel/package.json` | P2 | R08 | `FIXED_VERIFIED` | Dependencias no utilizadas eliminadas de `package.json`. |
| `SEC09-01` | Sanitización: Duplicación `client-web` vs `shared` | `apps/client-web/app.js`, `packages/shared/src/security.ts` | P2 | R08 | `FIXED_VERIFIED` | Paridad validada contra suite `client-xss-security.test.ts` (23/23 vectores PASS). |
| `SEC10-01` | ENV: `ENCRYPTION_SECRET_KEY` ausente en .env | `.env`, `.env.example` | P0 | R03 | `FIXED_VERIFIED` | Variable documentada en `.env.example` y `packages/api/.env.example`. |
| `SEC10-02` | ENV: Desincronización .env y .env.example | `.env.example`, `packages/api/.env.example` | P1 | R03 | `FIXED_VERIFIED` | Archivos sincronizados al 100%. |
| `SEC10-03` | Seguridad: PIN default '1234' en registro | `packages/api/src/routes/auth.routes.ts` | P1 | R03 | `FIXED_VERIFIED` | Removido fallback `'1234'`. Validación numérica obligatoria (4-6 dígitos). |
| `SEC10-04` | Seguridad: Botones quick-login con PINs visibles | `apps/staff-panel/src/components/LoginModal.tsx` | P1 | R03 | `FIXED_VERIFIED` | Confinados exclusivamente al modo demostrativo (`isDemoMode`). |
| `SEC10-05` | Privacidad: Generación de QR con `api.qrserver.com` | `apps/admin-dashboard/src/components/TablesManager.tsx` | P1 | R03 | `FIXED_VERIFIED` | Generación local SVG implementada sin llamadas a terceros. |
| `SEC11-01` | A11y: Botones icon-only en Staff Panel | `apps/staff-panel/src/App.tsx`, componentes | P1 | R09 | `FIXED_VERIFIED` | Atributos `aria-label` descriptivos añadidos. |
| `SEC11-02` | A11y: Botones icon-only en Admin Dashboard | `apps/admin-dashboard/src/components/*` | P1 | R09 | `FIXED_VERIFIED` | Atributos `aria-label` añadidos en botones de eliminación y controles. |
| `SEC11-03` | A11y: Botones icon-only en Client Web | `apps/client-web/index.html` | P1 | R09 | `FIXED_VERIFIED` | `aria-expanded`, `aria-controls` y `aria-label` añadidos en controles de cuenta. |
| `SEC12-01` | A11y: Modales sin focus trap completo ni retorno | Modales en las 3 apps | P1 | C03 | `REOPENED` | WAI-ARIA añadido, pero falta focus trap activo (Tab cycling), foco inicial y retorno al trigger. |
| `SEC13-01` | A11y: Labels sin `htmlFor`/`id` en formularios | `admin-dashboard`, `staff-panel` | P2 | R09 | `FIXED_VERIFIED` | Asociación explícita `htmlFor` - `id` en formularios. |
| `SEC14-01` | A11y: Contraste insuficiente texto blanco sobre amarillo | `TableActionModal.tsx` | P1 | C03 | `REOPENED` | `isBrightHexColor` implementado; falta evidencia con mediciones reales y capturas reproducibles. |
| `SEC14-02` | A11y: Contraste `text-slate-500` sobre fondos oscuros | Varios componentes | P2 | C03 | `REOPENED` | Ratios cromáticos deben medirse con valores computados reales. |
| `SEC15-01` | A11y: Toggles en ModuleConfigManager sin `role="switch"` | `apps/admin-dashboard/src/components/ModuleConfigManager.tsx` | P1 | R09 | `FIXED_VERIFIED` | 8 switches dotados de `role="switch"`, `aria-checked` y `aria-label`. |
| `SEC15-02` | A11y: Divs/sections clickeables sin semántica ni teclado | `client-web`, `admin-dashboard` | P1 | R09 | `FIXED_VERIFIED` | Elementos interactivos convertidos a `<button>` o con ARIA y teclado. |
| `SEC16-01` | A11y: Alt dinámico de plato en `client-web` | `apps/client-web/app.js` | P1 | R09 | `FIXED_VERIFIED` | Atributo `alt` asignado dinámicamente con el nombre descriptivo del plato. |
| `SEC16-02` | A11y: `user-scalable=no` en Staff Panel | `apps/staff-panel/index.html` | P1 | R09 | `FIXED_VERIFIED` | Directiva removida; zoom de usuario plenamente operativo. |
| `SEC16-03` | A11y: SVGs decorativos sin `aria-hidden` | `apps/client-web/index.html` | P2 | R09 | `FIXED_VERIFIED` | SVGs ornamentales marcados con `aria-hidden="true"`. |

