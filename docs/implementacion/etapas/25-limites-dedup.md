# Etapa 25 — Controles compartidos de abuso y llamados duplicados

Bloque: Datos.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 24 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-25.md` (NUEVO al ejecutar).

## Misión

Controles compartidos de abuso y llamados duplicados. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/services/call.service.ts`
- `packages/api/src/routes/auth.routes.ts`
- `packages/api/src/routes/menu.routes.ts`
- `packages/api/src/routes/waitlist.routes.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Definir política pequeña para login por IP+tenant, llamadas por sesión, join por IP/tenant y IA por tenant; límites explícitos, respuesta 429 y Retry-After.
2. [ ] Implementar almacenamiento compartido usando PostgreSQL existente con operación atómica y expiración; para SQLite usar adapter de test con mismos contratos. Si se prefiere proveedor externo, detener y proponer ADR, no contratarlo.
3. [ ] Resolver deduplicación de llamado activo mediante invariante/lock en DB; reintentos devuelven resultado coherente, sin count-then-create vulnerable.
4. [ ] Probar dos instancias/conexiones consumiendo mismo límite y creando llamados simultáneos. Evitar registrar PIN/token y no confiar en X-Forwarded-For sin proxy confiable.

## Aceptación verificable

- [ ] El límite se comparte entre procesos y devuelve 429 de forma verificable.
- [ ] Carrera de llamados deja como máximo un llamado activo del tipo definido por sesión.
- [ ] Fallo del control IA no habilita llamadas pagas ilimitadas; PINs/tokens ausentes en logs.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No bloquear usuarios por GPS ni declarar DDoS resuelto. Si auth y dedup superan el presupuesto de archivos, pedir división de esta ficha.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 25».
