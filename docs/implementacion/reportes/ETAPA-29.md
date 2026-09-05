# Reporte de etapa 29 — Runbook y decisión humana de lanzamiento

Estado: NEEDS_REVIEW
Fecha: 2026-09-05
Ficha: [Etapa 29](../etapas/29-salida-piloto.md)
Predecesora: Etapa 28 (`APPROVED`)

## Alcance ejecutado

- Se contrastó la documentación de despliegue, API y arquitectura contra el código y la evidencia del ensayo de la Etapa 28.
- Se corrigieron afirmaciones que aún anunciaban SSE activo: `/stream` está deshabilitado (`410 SSE_STREAM_DISABLED`) y Staff/Admin usan polling HTTP autenticado.
- Se agregó [`docs/RUNBOOK_PILOTO.md`](../../RUNBOOK_PILOTO.md): instalación/preflight, apertura/cierre, incidencias de red, relogin, caja manual, límites de módulos, métricas propuestas y checklist GO/NO-GO.
- El runbook separa explícitamente recuperación de servicio de recuperación de datos. Backup/restauración real no fue ensayado y se deja como bloqueo automático de GO.
- Se añadieron avisos de vigencia a los documentos estratégicos para que sus propuestas históricas de SSE, Mercado Pago, rewards, pre-order e IA no se interpreten como capacidades liberadas.

## Estado operativo documentado

| Capacidad | Estado de piloto |
|---|---|
| Turnos, QR/sesiones, llamados, pedidos, cocina y caja presencial autorizada | Implementado y ensayado con datos ficticios |
| Polling Staff/Admin | Implementado; observar conexión y edad de snapshot |
| SSE `/stream` | Apagado (`410 SSE_STREAM_DISABLED`) |
| Pago digital, split y claims | Apagados (`503 DIGITAL_PAYMENTS_UNAVAILABLE`) |
| IA, pre-order y rewards | Apagados salvo habilitación/aprobación futura específica |
| Backup/restauración real | Pendiente bloqueante; no ensayado, no simulado |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `docs/RUNBOOK_PILOTO.md` | Nuevo runbook, incidencias, métricas y GO/NO-GO humano |
| `docs/API.md` | Contrato correcto de sesión inactiva y stream deshabilitado |
| `docs/ARCHITECTURE.md` | Transporte operativo actualizado a polling autenticado |
| `docs/DEPLOY_VERCEL_SUPABASE.md` | Sin promesa SSE y sin autorización de despliegue implícita |
| `PROYECTO_MAESTRO.md` | Aviso de vigencia para distinguir visión de capacidades liberadas |
| `mesaya-plan-tecnico.md` | Aviso de vigencia y límites actuales |
| `docs/implementacion/CONTROL.md` | Etapa 29 a `NEEDS_REVIEW` |

## Evidencia y verificación

| Comando | Resultado |
|---|---|
| `node scripts/build.mjs` | Ejecutado después de los cambios documentales; build previo de la Etapa 28: 6/6 PASS. No hubo cambios de producto en esta etapa. |
| `node scripts/test-isolated.mjs` | Ejecutado después de los cambios documentales; el runner usa lock exclusivo y lo liberó al finalizar. La salida del terminal se truncó durante la ejecución; no se afirma un nuevo conteo agregado. La Etapa 28 ya registra 30/30 PASS del mismo árbol de producto. |
| `Get-FileHash packages/api/prisma/dev.db` | Hash canónico preservado: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` |

No se ejecutó backup/restauración sobre datos reales, migración real, seed, push, deploy, impresión de QR reales, cobro, alta de cuentas ni contacto externo.

## GO/NO-GO

Estado actual: **NO-GO** hasta que Rodrigo cuente con un ensayo verificable de backup/restauración, nombre responsables/canal operativo y emita una decisión explícita. Este reporte no solicita ni infiere permiso para desplegar.

## Handoff

Etapa 29 queda `NEEDS_REVIEW`. No hay etapas posteriores habilitadas. La aprobación técnica de esta ficha no equivale a GO de lanzamiento.
