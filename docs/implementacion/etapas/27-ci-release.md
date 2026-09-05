# Etapa 27 — CI y build reproducible de despliegue

Bloque: Entrega.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 26 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-27.md` (NUEVO al ejecutar).

## Misión

CI y build reproducible de despliegue. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `package.json`
- `.gitignore`
- `package-lock.json`
- `vercel.json`
- `api/index.ts`
- `docs/DEPLOY_VERCEL_SUPABASE.md`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Versionar lockfile en el alcance correcto; configurar CI (NUEVO) con npm ci, build, tests SQLite aislados, paridad y job PostgreSQL efímero.
2. [ ] Auditar matriz de rutas contra plugins actuales: ninguna ruta sensible sin pruebas anónimo/rol/tenant. Añadir gate que detecte rutas nuevas sin clasificación.
3. [ ] Definir build productivo PG explícito y smoke del entrypoint serverless con cliente correcto; remover CORS contradictorio de vercel.json.
4. [ ] Separar migración como release controlada del build de preview; documentar secretos necesarios sin valores. Mantener features incompletas apagadas.
5. [ ] Si todavía no existe Git propio/remote/CI habilitado, preparar archivos y reportar verificación local; no publicar ni crear remoto. CI remota pendiente no cuenta como ejecutada.

## Aceptación verificable

- [ ] Desde instalación limpia se generan todos los artefactos y cliente PG correcto.
- [ ] Un test fallido, deriva de schema o ruta no clasificada bloquea pipeline.
- [ ] Preview no migra ni siembra una base real; logs no exponen secretos.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No push, deploy, alta de cuentas ni activar infraestructura externa.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 27».
