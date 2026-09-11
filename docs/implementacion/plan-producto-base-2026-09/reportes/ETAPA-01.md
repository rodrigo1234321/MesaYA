# Reporte de etapa 01 — Registro real de capacidades y configuración

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07  
Ficha: [Plan por etapas](../PLAN-POR-ETAPAS.md)  
Control: [CONTROL.md](../CONTROL.md)

## Implementado

- `CapabilityConfigurationError` con contrato 409, código estable, campo y capacidad afectada.
- `validateCapabilityUpdate` para bloquear nuevas activaciones de cobro autónomo/split, pre-order, Rewards, upselling y propinas inteligentes mientras sus recorridos están incompletos; `DIGITAL_MP`/`HYBRID` sólo habilitan la opción informativa con cobro presencial.
- Se permiten desactivaciones y correcciones de flags heredados.
- Pre-order exige además que la fila esté habilitada en la misma actualización.
- La ruta de configuración devuelve error accionable en lugar de 500 genérico.
- El dashboard consume el mapa de capacidades para deshabilitar opciones no efectivas y explicar el motivo.
- Se agregó suite específica de cinco pruebas de política.

## Archivos

- `packages/api/src/services/config.service.ts`
- `packages/api/src/routes/config.routes.ts`
- `packages/api/test/capability-update-policy.test.ts`
- `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`

## Verificación

| Verificación | Resultado |
|---|---|
| Suite específica de capacidades | 5/5 PASS |
| Suites existentes de capabilities | 25/25 PASS |
| API build directo | PASS |
| Admin build directo | PASS |
| Shared build directo | PASS |
| `npm run check:routes` | PASS — 77 rutas |
| Runner global `npm run build` | pendiente del adaptador Windows Job |
| Runner global `npm run test:isolated` | pendiente del adaptador Windows Job |

## Resultado funcional

Un encargado no puede activar desde la API ni desde el panel una capacidad que el backend declara no disponible. La respuesta contiene `409`, `CAPABILITY_NOT_AVAILABLE`, `field` y `capability`. El panel puede apagar una configuración antigua para recuperar el local.

## Pendientes no bloqueantes

- El registro todavía cubre el catálogo de módulos existente; al completar caja, terminal, pagos y Rewards se deben mover los estados de `CapabilityState` a `AVAILABLE`/`MODULE_STABLE` junto con sus pruebas.
- La verificación completa del runner aislado requiere la jornada Windows Job del proyecto y queda incluida en el cierre final.
