# Etapa 21 — Build del cliente sin dependencias de demo

Bloque: Entrega.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 20 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-21.md` (NUEVO al ejecutar).

## Misión

Build del cliente sin dependencias de demo. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `apps/client-web/index.html`
- `apps/client-web/styles.css`
- `apps/client-web/package.json`
- `apps/client-web/vite.config.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Retirar Tailwind Play CDN del despliegue y compilar sólo CSS usado con herramientas compatibles con el proyecto.
2. [ ] Eliminar fuente duplicada, separar selector demo del build productivo y permitir zoom del navegador.
3. [ ] Medir JS/CSS comprimidos y carga inicial total incluyendo fuentes/imágenes con caché fría; no confundir core de 96 KB con peso real.
4. [ ] Registrar presupuesto propuesto y resultado antes/después en reporte; comprobar pantallas de menú, pedido y mesa inactiva sin cambiar diseño.

## Aceptación verificable

- [ ] Build producción no carga Tailwind runtime ni presenta controles demo.
- [ ] Zoom y navegación por teclado básicos siguen disponibles.
- [ ] Métricas incluyen recursos externos; no se afirma <100 KB sin medición.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No efectos, animaciones, framework nuevo ni compra/generación de assets.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 21».
