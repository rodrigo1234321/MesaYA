# Scripts e instrucciones inspeccionados

Fecha: 2026-09-03. Revisión estática de los scripts; NO se ejecutaron para crear este plan. No se encontró un generador de etapas que debiera ejecutarse para producir estas fichas.

## Instrucciones de Antigravity consideradas

- C:/Users/rodri/Desktop/AI/ANTIGRAVITY.md
- C:/Users/rodri/Desktop/AI/Rules/GLOBAL_RULES.md
- C:/Users/rodri/Desktop/AI/Docs/ARQUITECTO_CHATGPT_VS_PROGRAMADOR_ANTIGRAVITY.md
- C:/Users/rodri/Desktop/AI/Agents/agent-tester.md
- C:/Users/rodri/Desktop/AI/Agents/agent-reviewer.md
- C:/Users/rodri/Desktop/AI/Projects/_orchestration/README.md
- C:/Users/rodri/Desktop/AI/Projects/_orchestration/TASK_TEMPLATE.md
- C:/Users/rodri/Desktop/AI/Projects/_orchestration/ROADMAP_TEMPLATE.md
- C:/Users/rodri/Desktop/AI/Projects/_orchestration/decisions/2026-09-03-codex-operating-model.md

Se conserva separación Arquitecto/Ejecutor. El pedido actual establece pausa tras cada ficha, aunque plantillas previas sugieran continuidad/paralelismo. No se modificaron reglas globales ni configuración privada de .gemini. No es una auditoría completa de toda la instalación de Antigravity.

## Scripts del proyecto

Todas las rutas siguientes son relativas a la raíz mdpmesasvivas.

| Archivo/comando actual | Qué hace / riesgo encontrado | Uso permitido en este plan |
|---|---|---|
| scripts/start_dev_ip.js / npm run dev | Arranca servicios con entorno heredado, exposición LAN y accesos demo. | Sólo desarrollo controlado; no prueba de aislamiento ni despliegue seguro. |
| scripts/sync_supabase_schema.js | Reescribe schema.supabase.prisma sustituyendo datasource. No migra DB ni verifica paridad por sí mismo. | Inspeccionar ahora; agregar --check en 22 antes de usar como gate. |
| scripts/capture_all.js | Sirve previews, inyecta credenciales/estado preparados y genera capturas. | Referencia visual; NO aceptación funcional ni seguridad. |
| scripts/take_screenshots.js | Levanta API con entorno heredado y previews modificadas para capturas. | No ejecutar con .env normal; sólo adaptar a entorno efímero si aporta valor en 28. |
| scripts/generate_client_ready_screenshots.js | Genera pantallas/HTML preparados con contenido de demostración. | Marketing/visual; no usar como prueba del recorrido real. |
| scripts/verify_rtms_layer0_1.ts | Invoca servicios FSM sobre mesas y consulta persistencia; cambia estado. | Sólo después de portar a fixtures aisladas. No demuestra auth HTTP. |
| scripts/chaos_rtms_test.ts | Ejecuta ciclos/operaciones FSM y crea/borra recursos de prueba con Prisma/servicios. | Sólo aislamiento; no demuestra concurrencia multiinstancia PostgreSQL. |
| scripts/test_waiter_shift_full.ts | Simula módulos usando buildApp y restaurante demo existente. | Revisar asserts y portar a runner en 28; nunca contra demo persistente. |
| packages/api/test-e2e.ts | Script legacy de inyección HTTP dependiente de datos; contratos de auth anteriores. | Portar escenarios útiles; no gate automático actual. |
| packages/api/test-modules-v3.ts | Tests legacy de módulos, incluidos flujos de pagos simulados. | Cambiar expectativas inseguras; no interpretar falso APPROVED como PASS. |
| packages/api/test/full-system-e2e.test.ts | beforeAll borra datos de mesa demo, reabre sesiones y activa flags; afterAll sólo cierra app. | Prohibido antes de etapa 01; luego sólo fixtures temporales. |
| packages/api/test/rtms-fsm-analytics.test.ts | Resetea tabla/fixture demo y prueba FSM/concurrencia local. | Aislar en 01; complementar con PostgreSQL antes del piloto. |
| packages/api/test/system-lifecycle.test.ts | Pruebas HTTP básicas; algunas assertions amplias. | Aislar, luego precisar códigos/ausencia de escrituras. |
| packages/api/prisma/seed.ts | deleteMany de múltiples tablas antes de poblar demo. | Guard obligatorio en 01. No seed contra datos reales. |
| npm run build | Ejecuta workspaces; API antes de shared según orden actual. | Reordenar en 02; build genera artefactos, no valida DB real. |
| npm --workspace=@mesaya/api test | Vitest actual; puede mutar demo por fixtures existentes. | No ejecutar directamente antes del runner aislado. |
| npm run deploy:supabase:push | db push contra la conexión configurada. | NO usar para release de restaurante ni como prueba. |
| npm run deploy:supabase:seed | Reutiliza seed destructivo. | NO ejecutar contra Supabase real. |
| npm run qr:generate | Genera archivos QR; no valida políticas de admisión. | Revisar contrato en 12; no imprimir/reemplazar QR reales sin aprobación. |

## Comandos FUTUROS, aún no implementados

- Etapa 01: npm run test:isolated mediante scripts/test-isolated.mjs.
- Etapa 22: node scripts/sync_supabase_schema.js --check.
- Etapa 22: comandos explícitos de generación SQLite/PostgreSQL, nombres finales en reporte.
- Etapa 23: runner PG aislado y migrate deploy específico.
- Etapa 27: CI con npm ci, build, suite aislada y PG.

No copiar estos comandos a una consola hasta que su etapa los haya creado y verificado. Ejecutar Prisma generate en serie: ambas variantes pueden escribir al mismo cliente generado.

## Qué NO se hizo

No se lanzaron servicios, scripts de capturas, seeds, migraciones ni tests para generar estas fichas. No se cambiaron reglas/configuración de Antigravity ni su modelo. La revisión se centró en scripts del proyecto y guías de ejecución pertinentes.
