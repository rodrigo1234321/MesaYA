# Etapa 29 — Runbook y decisión humana de lanzamiento

Bloque: Piloto.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 28 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-29.md` (NUEVO al ejecutar).

## Misión

Runbook y decisión humana de lanzamiento. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `docs/DEPLOY_VERCEL_SUPABASE.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `PROYECTO_MAESTRO.md`
- `mesaya-plan-tecnico.md`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Actualizar afirmaciones de documentación con evidencia del código/ensayo: implementado, parcial, apagado y pendiente; no mantener promesas de pagos/rewards/SSE distribuido inexistentes.
2. [ ] Crear runbook de instalación, apertura/cierre, incidencias de red, re-login, caja manual, backup/restauración ensayada y rollback; separar código de recuperación de datos.
3. [ ] Registrar métricas propuestas del piloto: errores por flujo, latencia/edad de snapshots, duplicados, tiempo de atención y recuperación. Definir responsables y canal operativo sin inventar contactos.
4. [ ] Preparar checklist GO/NO-GO y riesgos aceptados: QR fijo no acredita presencia, polling/capacidad, pagos digitales/IA/preorden/rewards apagados salvo aprobación específica.
5. [ ] Solicitar decisión explícita de Rodrigo antes de desplegar, migrar datos, imprimir QR reales o operar restaurante. Terminar en NEEDS_REVIEW, no anunciar lanzamiento.

## Aceptación verificable

- [ ] Cada bloqueo crítico tiene prueba y revisión; ninguno se sustituye por una promesa.
- [ ] Backup/restauración tiene evidencia en entorno desechable o queda marcado pendiente bloqueante.
- [ ] Rodrigo dispone de límites del piloto y puede dar GO/NO-GO informado.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No lanzar automáticamente ni convertir la aprobación técnica en autorización de cobros o acceso externo.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 29».
