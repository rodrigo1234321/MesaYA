# Etapa 04 — Quitar fallbacks engañosos de IA

Bloque: Contención.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 03 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-04.md` (NUEVO al ejecutar).

## Misión

Quitar fallbacks engañosos de IA. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/services/ai.service.ts`
- `packages/api/src/routes/menu.routes.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Retirar NOTION_API_KEY y NOTION_TOKEN como alternativas de credenciales Gemini; sin clave válida usar modo degradado explícito.
2. [ ] En recomendaciones dietarias no elegir primeros platos arbitrarios cuando no hay coincidencias verificadas. Abstenerse y remitir al personal.
3. [ ] Eliminar afirmaciones de ausencia de alérgenos/trazabilidad que no estén respaldadas; las etiquetas de catálogo tampoco certifican contaminación cruzada.
4. [ ] Desactivar autoApply de contenido generado: sólo preview hasta validación humana por manager. Cubrir falta de clave, respuesta inválida y catálogo sin coincidencias con mocks.

## Aceptación verificable

- [ ] Un pedido sin gluten sin datos suficientes no recibe platos arbitrarios ni garantía de seguridad.
- [ ] Variables Notion nunca son enviadas como clave de otro proveedor.
- [ ] Una generación, incluso con autoApply=true, no borra ni publica menú.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No nuevas capacidades IA ni consultas reales pagas.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 04».
