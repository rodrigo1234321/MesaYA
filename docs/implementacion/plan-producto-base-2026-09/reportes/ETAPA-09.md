# Reporte de etapa 09 — Caja presencial y liberación de mesa

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- Se agregó una pestaña de caja a la pantalla compartida del staff: cuentas activas, detalle, efectivo/tarjeta, propina, cobro y liberación de mesa.
- La API expone un snapshot de caja aislado por tenant y sólo con saldo pendiente.
- El cobro manual admite `idempotencyKey` y reproduce una respuesta sin duplicar transacciones ante reintentos.
- `MANUAL_SETTLED` cuenta como pago conciliado para el guard de cierre de mesa.
- La liberación sigue invalidando la sesión/QR y exige que no queden saldo ni llamados de cuenta pendientes.
- La capacidad pública `manual_payment` pasó de API-only a `AVAILABLE` porque ahora existe pantalla operativa.

## Verificación

| Verificación | Resultado |
|---|---|
| contrato de caja/idempotencia | 4/4 PASS |
| KDS/cobro manual/roles | PASS en `staff-orders-kitchen.test.ts` |
| capabilities unitarias | PASS |
| API build directo | PASS |
| Staff panel build directo | PASS |
| matriz de rutas | PASS: 78 rutas clasificadas |

## Límite conocido

La certificación de caja con tres actores sobre una pantalla física y una base PostgreSQL/Supabase desechable queda para las etapas 20–21. El cobro autónomo de Mercado Pago y la división automática no forman parte de esta release; la opción informativa se cierra en la etapa 15.
