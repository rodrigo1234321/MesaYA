# Etapa 18 — Reconexión y avisos consistentes

Bloque: Confiabilidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 17 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-18.md` (NUEVO al ejecutar).

## Misión

Reconexión y avisos consistentes. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `apps/staff-panel/src/hooks/useSSE.ts`
- `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts`
- `apps/client-web/app.js`
- `apps/staff-panel/src/lib/audio.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Sustituir consumo SSE por snapshots autorizados de etapa 17 conservando una interfaz acotada; revisar otros EventSource con búsqueda dirigida.
2. [ ] Consultar cada 3 segundos en foreground como objetivo propuesto, sin solapar requests; refrescar al recuperar foco/red, backoff con jitter en fallos y abortar al desmontar.
3. [ ] Invitado consulta sólo su sesión/pedido, nunca snapshot de restaurante. Expiración 401 detiene bucle y pide re-login/renovación según contrato.
4. [ ] Deduplicar avisos por ID/estado; un llamado nuevo tras lista vacía debe sonar una sola vez. Mostrar offline/datos desactualizados en vez de estado verde falso.

## Aceptación verificable

- [ ] Después de perder y recuperar red se reconcilia estado sin recargar página.
- [ ] Dos clientes ven un cambio persistido aunque no compartan eventBus en memoria.
- [ ] Alerta vacío->nuevo suena una vez; un snapshot repetido no vuelve a sonar.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No rediseño visual, WebSocket ni mantener un canal SSE paralelo no autenticado.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 18».
