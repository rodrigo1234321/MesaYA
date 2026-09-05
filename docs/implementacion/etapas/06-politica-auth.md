# Etapa 06 — Helpers de autorización y matriz de rutas

Bloque: Identidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 05 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-06.md` (NUEVO al ejecutar).

## Misión

Helpers de autorización y matriz de rutas. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/middlewares/auth.middleware.ts`
- `packages/api/src/routes`
- `packages/api/src/services/staff.service.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Inventariar método+ruta de todos los plugins en docs/implementacion/evidencia/MATRIZ_RUTAS.md (NUEVO): público, invitado/sesión, staff o manager; especificar tenant y actor.
2. [ ] Implementar helpers fail-closed para token, rol y pertenencia. Validar identidad vigente del staff contra DB; no confiar en restaurantId o staffUserId aportado por body.
3. [ ] Definir respuestas consistentes: 401 credencial inválida; 403 permiso insuficiente; 404 para recurso ajeno cuando evita enumeración. Ningún handler continúa tras rechazo.
4. [ ] Crear fixtures con restaurantes A/B, managers y mozos de ambos, token inválido y vencido; probar helpers en rutas de prueba sin modificar todos los módulos a la vez.

## Aceptación verificable

- [ ] La matriz incluye lecturas, streams, IA y excepciones públicas, no sólo POST/DELETE.
- [ ] Token válido de A no concede acceso a B.
- [ ] No doble respuesta ni continuación de escrituras después de rechazo.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No aplicar un guard global que rompa menú público/QR; el cierre se hará módulo por módulo.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 06».
