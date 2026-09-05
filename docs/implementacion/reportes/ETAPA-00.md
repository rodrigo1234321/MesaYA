# Reporte de etapa 00 — Inventario y punto de recuperación

Estado: NEEDS_REVIEW
Fecha: 2026-09-03
Ejecutor y modelo realmente usado: Antigravity / Gemini 3.8 Flash (High)
Ficha: docs/implementacion/etapas/00-base-segura.md
Predecesora aprobada: Pedido de Rodrigo (inicio del plan de 30 microetapas)
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas
Commit de base o manifiesto: docs/implementacion/evidencia/00-baseline.json (223 archivos de producto/configuración verificados con SHA-256)
Cambios previos preservados: Todos los archivos de código de producto y configuración se preservaron intactos. No se tocó código de aplicación, esquema, migraciones ni bases de datos.

## Alcance realizado

- [x] Paso 1: Confirmación de ruta real y detección de repositorio Git efectivo. Ejecución de `git rev-parse --show-toplevel` devolvió `C:/Users/rodri`, constatando que `mdpmesasvivas` no posee un repositorio Git propio local (`.git` inexistente) y está marcado como `?? ./` en el repo padre. Se acató la regla estricta de no ejecutar `git add`, `git commit`, `git clean` ni `git reset`.
- [x] Paso 2: Inventario completo de versiones de runtime (`Node v24.17.0`, `npm 12.0.2`), scripts del `package.json` raíz y de los 6 workspaces (`packages/api`, `packages/shared`, `apps/admin-dashboard`, `apps/client-web`, `apps/staff-panel`, `hardware/qr-generator`). Generación del manifiesto reproducible con hashes SHA-256 en `docs/implementacion/evidencia/00-baseline.json` con rutas normalizadas (`/`), delimitado estrictamente a los **223 archivos de producto, configuración y documentación de producto**.
  - **Inclusiones explícitas:** Fuentes de producto (`apps/`, `packages/`, `hardware/`, `scripts/`, `api/`), configuraciones (`package.json`, `tsconfig*.json`, etc.), documentación técnica de producto (`docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY_VERCEL_SUPABASE.md`, `README.md`, `PROYECTO_MAESTRO.md`, `mesaya-plan-tecnico.md`) y plantillas públicas sanitizadas `.env.example`.
  - **Exclusiones explícitas:** Todo `docs/implementacion/**` (artefactos mutables del flujo: `CONTROL.md`, etapas, reportes, revisiones, evidencia), `.env` privados, bases de datos (`*.db`, `*.sqlite`, journals), `node_modules/`, `dist/`, `build/`, `screenshots/`, `graphify-out/` y `repomix-output.*`.
- [x] Paso 3: Registro del estado de control de versiones y formulación de la estrategia de recuperación. Conforme al dictamen de Codex, se aplaza la inicialización de Git (`git init`) hasta una etapa previa a la creación del primer commit formal. Mientras tanto, el manifiesto de 223 archivos es la fuente de verdad inmutable y punto de recuperación.
- [x] Paso 4: Contraste sistemático entre `README.md`, `PROYECTO_MAESTRO.md`, `mesaya-plan-tecnico.md` y el código fuente respecto al alcance del piloto gastronómico.
- [x] Corrección [P3] solicitada por Codex: Exclusión de artefactos de proceso mutables en `docs/implementacion/` para garantizar reproducibilidad permanente del manifiesto (100% de coincidencia ante cambios de estado en `CONTROL.md`). Reejecución completa del harness de verificación de integridad (223 matched, 0 faltantes, 0 mismatches, 0 secretos).

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `docs/implementacion/CONTROL.md` | Modificación | Registrar transiciones (`IN_PROGRESS` -> `NEEDS_REVIEW`) |
| `docs/implementacion/evidencia/00-baseline.json` | NUEVO (regenerado) | Manifiesto criptográfico SHA-256 de 223 archivos de producto/configuración con rutas POSIX (`/`), excluyendo artefactos de proceso |
| `docs/implementacion/reportes/ETAPA-00.md` | NUEVO (actualizado) | Documentación de evidencia, verificación de 223 hashes y handoff para revisión |

## Evidencia de pruebas y verificación de integridad

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `git rev-parse --show-toplevel` (cwd: `.../mdpmesasvivas`) | N/A (Inspección git) | 0 | Devuelve `C:/Users/rodri`. Confirma que el proyecto no es raíz de git propia. |
| `Test-Path "C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas/.git"` | N/A (PowerShell) | 0 | Devuelve `False`. No existe `.git` local en el directorio del proyecto. |
| `node -v; npm -v` (cwd: `.../mdpmesasvivas`) | Runtime local | 0 | `Node v24.17.0`, `npm 12.0.2`. |
| Harness de verificación de integridad contra `00-baseline.json` (node) | Aislado en memoria | 0 | **223 entradas verificadas:**<br>• Matched hashes: 223<br>• Missing files: 0<br>• Mismatches: 0<br>• Secretos privados detectados: 0 |
| Inspección estática de contratos y alcance | Inspección estática | N/A | Contraste de alcance entre `mesaya-plan-tecnico.md`, `PROYECTO_MAESTRO.md`, `README.md` y rutas de `packages/api/src/routes`. |

*Nota metodológica:* En esta ficha no se ejecutó `npm test`, `vitest`, `prisma:seed` ni ningún comando de build, respetando la directiva de no alterar dependencias ni ejecutar suites no aisladas antes de la Etapa 01.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Manifiesto reproducible y sin secretos ni datos de clientes | PASS | Archivo `docs/implementacion/evidencia/00-baseline.json` generado con 223 hashes SHA-256 correspondientes exclusivamente a código/configuraciones de producto. Excluye `docs/implementacion/` garantizando reproducibilidad ante transiciones de estado. Incluye únicamente `.env.example` sanitizados públicos; cero valores de `.env` privados. |
| La ruta Git efectiva queda explícita y no se modifica el repositorio padre | PASS | Se verificó `git rev-parse --show-toplevel` = `C:/Users/rodri`. No se ejecutó ningún comando `git add`, `commit` ni `reset`. |
| No se cambia código de aplicación ni bases | PASS | Ningún archivo de `apps/`, `packages/`, `hardware/`, `api/` o `scripts/` fue alterado. Cero mutaciones en bases de datos. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Detallado en secciones «Alcance realizado», «Evidencia de pruebas» y «Contraste de alcance». |

## Contraste de alcance del piloto gastronómico

Al contrastar la especificación fundacional del piloto (`mesaya-plan-tecnico.md`), la visión expandida (`PROYECTO_MAESTRO.md` v2.0), el `README.md` y el código fuente existente, se identifican las siguientes divergencias y estados de implementación:

| Módulo / Funcionalidad | Alcance según Plan Técnico (Piloto Mar del Plata) | Visión en Dossier Maestro / README | Estado actual en código fuente | Ficha del plan que lo aborda |
|---|---|---|---|---|
| **Llamados comensal (Mozo, Cuenta, Insumos)** | Núcleo central del piloto (<100KB, sin app, 1 tap, fallback WhatsApp). | Mantenido como núcleo + Food-first UI. | **Implementado**: `apps/client-web/app.js`, `packages/api/src/routes/calls.routes.ts`. | Etapa 13, 14, 18 |
| **Panel de Staff / Mozos** | PWA reactiva, semáforo de espera (<3m, >3m), filtro de sector, audio chime. | Mantenido como núcleo. | **Implementado**: `apps/staff-panel/src/App.tsx`, Web Audio synthesizer en `sound.ts`. | Etapa 07, 15, 17 |
| **Cierre de Turno e Invalidación** | Invalidación inmediata en BD de sesiones (`410 Gone`) al liberar mesa o cerrar turno. | Mantenido como blindaje anti-llamados fantasma. | **Parcial**: Rutas existen (`shifts.routes.ts`, `tablestate.routes.ts`), pero carecen de atomicidad transaccional completa y guardias de auth estrictas. | Etapas 10, 11, 24 |
| **Comandas y Pedidos a Cocina** | **Fuera de alcance explícito** (*"No es un POS, no gestiona pedidos a cocina ni KDS"*). | Se agregó como módulo 5.4 *"Carrito Colaborativo (Social Cart) & Comandas"*. | **Parcial / Riesgoso**: Existen rutas `orders.routes.ts` y modelos Prisma `Order`/`OrderItem`, sin validación de permisos de comensal ni control transaccional. | Etapas 14, 15 |
| **Split Bill y Pagos Mercado Pago** | **Fuera de alcance explícito** (*"No es un e-commerce con pasarela obligatoria de pedidos"*). | Módulo 5.5 *"Split Bill Inteligente & Checkout Mercado Pago"*. | **Simulado / Inseguro**: Modelos `SplitBillSession`, `PaymentTransaction`; rutas devuelven transacciones simuladas sin pasarela real verificada. | Etapa 03 |
| **Fila Virtual / Waitlist** | No contemplado en piloto base. | Módulo 5.7 *"Fila Virtual (Smart Waitlist) & Pre-Order"*. | **Parcial**: Rutas en `waitlist.routes.ts` y tabla `WaitlistEntry` presentes, pero sin autenticación ni integración con salón. | Etapa 16 |
| **Sommelier con IA (Gemini)** | No contemplado en piloto base. | Módulo 5.9 *"Sommelier & Asistente Culinario con IA"*. | **Incompleto / Fallbacks decorativos**: Drawer en cliente y menciones en admin; requiere acotación estricta y eliminación de fallbacks simulados. | Etapas 04, 20 |
| **Editor de Plano (FloorPlan)** | Panel admin de mesas simple por sector. | Canvas Konva interactivo drag-and-drop. | **Implementado**: `FloorPlanCanvas.tsx`, `FloorPlanManager.tsx` en admin dashboard; sincronización no atómica. | Etapas 11, 26 |

## Integridad y seguridad

- **Base demo intacta**: Verificado. No se ejecutó ningún comando `prisma:seed`, `prisma db push` ni conexión a base de datos.
- **Cruce tenant A/B**: No aplica a esta ficha (no hubo ejecución de endpoints ni consultas multicompañía).
- **Rechazo sin escrituras**: No aplica (no hubo llamadas HTTP a mutaciones).
- **Build**: No ejecutado (fuera de alcance en etapa 00; programado formalmente en etapa 02).
- **Migración/paridad si corresponde**: No aplica a etapa 00 (programado para etapa 22 y 23).
- **Ausencia de secretos en diff/logs**: Verificado. El manifiesto `00-baseline.json` no contiene valores de variables de entorno privadas ni credenciales.

## Pendientes, riesgos y decisiones

- **Qué falta**: Nueva revisión y dictamen de Codex sobre el ajuste [P3] de esta Etapa 00.
- **Qué impide avanzar**: Espera de la aprobación formal de Codex antes de habilitar la Etapa 01.
- **Decisión Git registrada**: Se toma nota de la resolución de Codex: no se ejecuta `git init` en esta etapa; se resolverá explícitamente antes de la primera etapa que cree commits de código. El manifiesto SHA-256 de 223 archivos actúa como punto de recuperación auditado.
- **Cambios fuera de alcance propuestos pero NO implementados**:
  - No se inicializó Git.
  - No se instalaron paquetes ni modificaron dependencias.
  - No se ejecutó la suite de testing legacy (evitando alterar el archivo `dev.db` o tocar el seed).

## Handoff

- `docs/implementacion/CONTROL.md` se mantiene en estado `NEEDS_REVIEW` con enlace a `reportes/ETAPA-00.md` y revisión `revisiones/ETAPA-00.md`.
- No se inició la Etapa 01 ni ninguna ficha subsiguiente.
- Solicito revisión de Codex.
