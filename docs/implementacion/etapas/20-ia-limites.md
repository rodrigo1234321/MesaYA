# Etapa 20 — Acotar generación IA y validar respuestas

Bloque: Confiabilidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 19 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-20.md` (NUEVO al ejecutar).

## Misión

Acotar generación IA y validar respuestas. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/services/ai.service.ts`
- `packages/api/src/routes/menu.routes.ts`
- `apps/admin-dashboard/src/components/AIChefAssistantModal.tsx`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Validar entrada/salida IA con schemas runtime, límites de texto/items y timeout/cancelación. Respuestas mal formadas no se aplican.
2. [ ] Evitar cascada ilimitada de modelos/reintentos; modelo por configuración y máximo de intentos explícito. No inventar nombres de modelos existentes.
3. [ ] Generación sólo manager del tenant; sommelier requiere sesión válida y cuotas. Mantener feature IA apagada por defecto hasta controles compartidos de etapa 25.
4. [ ] Mostrar preview y errores recuperables; no publicar automáticamente descripciones/alérgenos. Probar con mocks, sin consumir API paga.

## Aceptación verificable

- [ ] Timeout termina solicitud sin escritura parcial.
- [ ] JSON inválido o IDs inventados se rechazan.
- [ ] Sin permisos o feature apagada no se llama al proveedor.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No optimización de prompts a costa de gastar dinero ni habilitar IA en producción.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 20».
