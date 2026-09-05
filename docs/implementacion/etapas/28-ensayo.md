# Etapa 28 — Ensayo integral del piloto con datos ficticios

Bloque: Piloto.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 27 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-28.md` (NUEVO al ejecutar).

## Misión

Ensayo integral del piloto con datos ficticios. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `scripts/test_waiter_shift_full.ts`
- `scripts/verify_rtms_layer0_1.ts`
- `scripts/chaos_rtms_test.ts`
- `packages/api/test-e2e.ts`
- `packages/api/test-modules-v3.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Inventariar escenarios legacy y portar sólo los útiles a runner aislado; retirar éxito de pagos falsos y expectativas de rutas sin auth. No ejecutar legacy directamente.
2. [ ] Ejecutar recorrido manager abre turno -> QR mesa activa -> llamado -> atención -> pedido -> cocina -> pedido cuenta -> cobro presencial autorizado -> cierre -> token revocado.
3. [ ] Repetir con restaurantes A/B, dos clientes, red interrumpida y reinicio backend usando PostgreSQL desechable; registrar tiempos y divergencias.
4. [ ] Capturar UI REAL de ese entorno como evidencia complementaria. Los scripts mock no demuestran aceptación funcional.

## Aceptación verificable

- [ ] Recorrido completo observable en cliente/staff/admin sin editar DB manualmente entre pasos.
- [ ] No hay fuga entre restaurantes ni pago digital simulado.
- [ ] Restablecer red/proceso recupera estado persistido; fallo reproducible genera BLOCKED, no captura retocada.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No restaurante real, llamadas a clientes, cobros ni datos personales.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 28».
