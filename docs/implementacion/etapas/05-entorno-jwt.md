# Etapa 05 — Validar secretos, CORS y expiración

Bloque: Identidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 04 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-05.md` (NUEVO al ejecutar).

## Misión

Validar secretos, CORS y expiración. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/index.ts`
- `packages/api/src/lib/crypto.ts`
- `packages/api/src/routes/auth.routes.ts`
- `packages/api/src/routes/staff.routes.ts`
- `.env.example`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Centralizar validación de entorno en módulo pequeño (NUEVO si hace falta). Producción debe rechazar JWT_SECRET y ENCRYPTION_SECRET_KEY ausentes, débiles o conocidos; separar ambas claves.
2. [ ] Quitar fallback conocido de cifrado en producción y no re-cifrar datos existentes silenciosamente. Si hay datos cifrados con clave vieja, reportar necesidad de migración segura.
3. [ ] Aplicar expiración explícita de 12 horas propuesta para JWT de staff en todas sus emisiones, con pruebas de exp y vencimiento.
4. [ ] Reemplazar CORS abierto por lista explícita; localhost sólo en desarrollo. Actualizar ejemplos con placeholders y sin secretos reales; asegurar que tests usan configuración efímera.

## Aceptación verificable

- [ ] Arranque de producción falla antes de escuchar con configuración insegura.
- [ ] JWT vencido se rechaza; JWT válido sigue funcionando.
- [ ] Origen no autorizado no recibe permiso CORS, sin confundir CORS con autenticación.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No rotar secretos desplegados ni migrar cifrados reales.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 05».
