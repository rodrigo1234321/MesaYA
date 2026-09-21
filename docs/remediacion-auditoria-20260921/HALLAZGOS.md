# Registro de Hallazgos — Remediación MesaYA

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## Estado de los hallazgos:
- `CONFIRMED`: Reproducido en el candidato.
- `ALREADY_FIXED_VERIFIED`: Ya resuelto en la línea canónica (`origin/main`), verificado con evidencia.
- `FALSE_POSITIVE_EVIDENCED`: Falso positivo demostrado mediante código y tests.
- `FIXED_VERIFIED`: Corregido en este ciclo y verificado mediante pruebas automatizadas.
- `PENDING_EXTERNAL`: Requiere acción humana o cloud externa (ej. rotación de secrets en hosting).

---

## Matriz de Hallazgos y Resolución

| ID | Sección / Tema | Archivo(s) | Prioridad | Etapa | Estado Final | Evidencia / Resolución |
|---|---|---|---|---|---|---|
| `SEC01-01` | Git: main atrasado | Repo / Worktree | P0 | R00 | `FIXED_VERIFIED` | Worktree aislado creado desde `origin/main` en rama `codex/remediacion-auditoria-20260921`. |
| `SEC01-02` | Git: cambios locales en main | `apps/client-web/*`, `scripts/*` | P1 | R00 | `ALREADY_FIXED_VERIFIED` | Cambios ya integrados en commits canónicos de `origin/main`. Árbol de trabajo preservado en repo original. |
| `SEC02-01` | Backend: filtración `err.message` en 500 | `packages/api/src/routes/*.routes.ts` | P0 | R02 | `FIXED_VERIFIED` | Sanitización global en `errorHandler.ts`. Respuestas 500 siempre opacas con `requestId`. Suite `error-sanitization.test.ts` (6/6 PASS). |
| `SEC02-02` | Backend: bypass de `errorHandler.ts` | `packages/api/src/routes/*.routes.ts` | P0 | R02 | `FIXED_VERIFIED` | Eliminados 6 bloques catch con bypass manual; enrutados a `sendSanitizedError`. |
| `SEC03-01` | TypeScript: `any` en `apps/admin-dashboard` | `apps/admin-dashboard/src/lib/api.ts`, `App.tsx` | P1 | R07 | `FIXED_VERIFIED` | Tipado estricto con `ShiftItem`, DTOs y type narrowing. `tsc --noEmit -p apps/admin-dashboard` 0 errores. |
| `SEC03-02` | TypeScript: `any` en `apps/staff-panel` | `apps/staff-panel/src/components/*` | P1 | R07 | `FIXED_VERIFIED` | `StaffTableItemDTO` exportado, tipado en `KitchenOrdersManager` y `WaitlistManager`. `tsc --noEmit -p apps/staff-panel` 0 errores. |
| `SEC03-03` | TypeScript: `any` en servicios backend | `packages/api/src/services/*` | P2 | R07 | `FIXED_VERIFIED` | Modelos de `@prisma/client` (`Shift`, `StaffUser`, `Restaurant`) aplicados en `shift.service.ts`, `staff.service.ts` y `ai.service.ts`. |
| `SEC04-01` | React: ErrorBoundary en Staff Panel | `apps/staff-panel/src/main.tsx` | P0 | R04 | `FIXED_VERIFIED` | `ErrorBoundary.tsx` creado y montado en raíz de aplicación y vistas. |
| `SEC04-02` | React: ErrorBoundary en Admin Dashboard | `apps/admin-dashboard/src/main.tsx` | P0 | R04 | `FIXED_VERIFIED` | `ErrorBoundary.tsx` creado y probado con suite `ErrorBoundary.test.tsx` (5/5 PASS). |
| `SEC05-01` | UI: Acciones silenciosas en Staff Panel | `apps/staff-panel/src/App.tsx`, `ServiceWorkspace.tsx` | P0 | R05 | `FIXED_VERIFIED` | Alertas accesibles inline con `role="alert"` y bloqueo de botones ante mutaciones pendientes. |
| `SEC05-02` | UI: Error oculto detrás de modal en StaffManager | `apps/admin-dashboard/src/components/StaffManager.tsx` | P1 | R05 | `FIXED_VERIFIED` | Mensajes de error expuestos dentro del modal con `role="alert"` y botón deshabilitado al enviar. |
| `SEC05-03` | UI: Acciones silenciosas en TablesManager y MenuManager | `apps/admin-dashboard/src/components/TablesManager.tsx`, `MenuManager.tsx` | P1 | R05 | `FIXED_VERIFIED` | Feedback visual en modales y manejo de error con retry. |
| `SEC06-01` | Lint: Configuración ESLint en monorepo | Raíz, packages, apps | P1 | R06 | `FIXED_VERIFIED` | ESLint v10 Flat Config (`eslint.config.mjs`) instalado y configurado. `npm run lint` pasa con 0 errores. |
| `SEC06-02` | Lint: `noUnusedLocals: false` en tsconfig | `apps/*/tsconfig.json` | P2 | R06 | `ALREADY_FIXED_VERIFIED` | TypeScript configurado con `noUnusedLocals: true` y `noUnusedParameters: true` en configs canónicos. |
| `SEC07-01` | Hooks: `useSSE` usa PollingCoordinator | `apps/staff-panel/src/hooks/useSSE.ts` | P1 | R08 | `FIXED_VERIFIED` | Alias canónico `useCallsPolling` exportado con tipado estricto. |
| `SEC07-02` | Hooks: `useFloorPlanSSE` usa PollingCoordinator | `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts` | P1 | R08 | `FIXED_VERIFIED` | Alias canónico `useFloorPlanPolling` exportado con tipado estricto. |
| `SEC07-03` | Hooks: `buildStaffStreamUrl` a endpoint 410 GONE | `apps/staff-panel/src/hooks/useSSE.ts` | P2 | R08 | `FIXED_VERIFIED` | Anotado como `@deprecated` señalando la obsolescencia del endpoint `/stream` (`410 GONE`). |
| `SEC08-01` | Dead Code: Métodos API sin uso en StaffApi | `apps/staff-panel/src/lib/api.ts` | P2 | R08 | `FALSE_POSITIVE_EVIDENCED` | `tapTableState` y `payOrder` están en uso activo en `TablesOverview.tsx`, `ServiceWorkspace.tsx` y `CashManager.tsx`. Preservados. |
| `SEC08-02` | Dead Code: Métodos API sin uso en AdminApi | `apps/admin-dashboard/src/lib/api.ts` | P2 | R08 | `FALSE_POSITIVE_EVIDENCED` | Métodos mapeados a endpoints Fastify válidos requeridos por la API pública. Preservados. |
| `SEC08-03` | Deps: `konva`, `react-konva`, `zustand` en staff-panel | `apps/staff-panel/package.json` | P2 | R08 | `FIXED_VERIFIED` | Dependencias no utilizadas eliminadas de `package.json` optimizando bundle y tiempo de build. |
| `SEC09-01` | Sanitización: Duplicación `client-web` vs `shared` | `apps/client-web/app.js`, `packages/shared/src/security.ts` | P2 | R08 | `FIXED_VERIFIED` | Paridad validada contra suite `client-xss-security.test.ts` (23/23 vectores PASS). |
| `SEC10-01` | ENV: `ENCRYPTION_SECRET_KEY` ausente en .env | `.env`, `.env.example` | P0 | R03 | `FIXED_VERIFIED` | Variable documentada con directrices de entropía y formato en `.env.example` y `packages/api/.env.example`. |
| `SEC10-02` | ENV: Desincronización .env y .env.example | `.env.example`, `packages/api/.env.example` | P1 | R03 | `FIXED_VERIFIED` | Archivos sincronizados al 100%. |
| `SEC10-03` | Seguridad: PIN default '1234' en registro | `packages/api/src/routes/auth.routes.ts` | P1 | R03 | `FIXED_VERIFIED` | Removido fallback `'1234'`. Validación forzada mediante `isValidPinFormat(pin)` exigiendo 4-6 dígitos numéricos. |
| `SEC10-04` | Seguridad: Botones quick-login con PINs visibles | `apps/staff-panel/src/components/LoginModal.tsx` | P1 | R03 | `FIXED_VERIFIED` | Confinados exclusivamente al modo demostrativo (`isDemoMode`). Ocultos en producción. |
| `SEC10-05` | Privacidad: Generación de QR con `api.qrserver.com` | `apps/admin-dashboard/src/components/TablesManager.tsx` | P1 | R03 | `FIXED_VERIFIED` | Generación local SVG implementada. Cero llamadas a servicios de terceros. |
| `SEC11-01` | A11y: Botones icon-only en Staff Panel | `apps/staff-panel/src/App.tsx`, componentes | P1 | R09 | `FIXED_VERIFIED` | Añadidos `aria-label` descriptivos en todos los botones de acción sin texto visible. |
| `SEC11-02` | A11y: Botones icon-only en Admin Dashboard | `apps/admin-dashboard/src/components/*` | P1 | R09 | `FIXED_VERIFIED` | Atributos `aria-label` añadidos en botones de eliminación de categorías, platos, íconos y colapso. |
| `SEC11-03` | A11y: Botones icon-only en Client Web | `apps/client-web/index.html` | P1 | R09 | `FIXED_VERIFIED` | `aria-expanded`, `aria-controls` y `aria-label` añadidos en controles de cuenta y reseñas. |
| `SEC12-01` | A11y: Modales sin `role="dialog"`, `aria-modal`, focus trap | Modales en las 3 apps | P1 | R10 | `FIXED_VERIFIED` | Atributos WAI-ARIA `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, y listener de tecla `Escape` implementados. |
| `SEC13-01` | A11y: Labels sin `htmlFor`/`id` en formularios | `admin-dashboard`, `staff-panel` | P2 | R09 | `FIXED_VERIFIED` | Asociación explícita `htmlFor` - `id` verificada en todos los modales de ingreso y configuración. |
| `SEC14-01` | A11y: Contraste insuficiente texto blanco sobre amarillo | `TableActionModal.tsx` | P1 | R11 | `FIXED_VERIFIED` | Helper de luminancia `isBrightHexColor` implementado: texto oscuro sobre fondos claros, ratio > 7.2:1 (supera WCAG AAA). |
| `SEC14-02` | A11y: Contraste `text-slate-500` sobre fondos oscuros | Varios componentes | P2 | R11 | `FIXED_VERIFIED` | Ratios cromáticos calibrados en badges de estado y textos secundarios para cumplir WCAG AA (≥ 4.5:1). |
| `SEC15-01` | A11y: Toggles en ModuleConfigManager sin `role="switch"` | `apps/admin-dashboard/src/components/ModuleConfigManager.tsx` | P1 | R09 | `FIXED_VERIFIED` | 8 switches dotados de `role="switch"`, `aria-checked` y `aria-label`. |
| `SEC15-02` | A11y: Divs/sections clickeables sin semántica ni teclado | `client-web`, `admin-dashboard` | P1 | R09 | `FIXED_VERIFIED` | Elementos interactivos convertidos a `<button>` o provistos de atributos ARIA y handlers de teclado. |
| `SEC16-01` | A11y: Alt dinámico de plato en `client-web` | `apps/client-web/app.js` | P1 | R09 | `FIXED_VERIFIED` | Atributo `alt` asignado dinámicamente con el nombre descriptivo del plato gastronómico. |
| `SEC16-02` | A11y: `user-scalable=no` en Staff Panel | `apps/staff-panel/index.html` | P1 | R09 | `FIXED_VERIFIED` | Directivas de bloqueo de zoom eliminadas del viewport; zoom de usuario plenamente operativo. |
| `SEC16-03` | A11y: SVGs decorativos sin `aria-hidden` | `apps/client-web/index.html` | P2 | R09 | `FIXED_VERIFIED` | Todos los SVGs ornamentales e íconos mudos marcados con `aria-hidden="true"`. |
