# Etapa 19 — Eliminar inyección de contenido en cliente

Bloque: Confiabilidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 18 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-19.md` (NUEVO al ejecutar).

## Misión

Eliminar inyección de contenido en cliente. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `apps/client-web/app.js`
- `apps/client-web/index.html`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Inventariar sinks innerHTML y contextos: texto, atributos, URLs, contenido IA. No usar un escape genérico para todos los contextos.
2. [ ] Renderizar datos no confiables con textContent/DOM; en markup necesario usar sanitización mantenida y política mínima, justificando dependencia.
3. [ ] Validar protocolos y dominios admitidos de enlaces/imágenes; rechazar javascript:, atributos de evento y SVG/HTML activo no confiable.
4. [ ] Añadir pruebas de menú/branding/IA con payloads como img onerror y cierre de atributo; preservar layout existente.

## Aceptación verificable

- [ ] Payload almacenado de categoría/plato no ejecuta JS al abrir menú.
- [ ] URL javascript y atributos onerror no llegan al DOM activo.
- [ ] Texto con acentos/comillas y menú normal se renderizan sin romperse.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No reescribir cliente a React ni diseñar nueva landing.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 19».
