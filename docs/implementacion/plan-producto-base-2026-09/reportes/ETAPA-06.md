# Reporte de etapa 06 — Carta dinámica y carrito colaborativo

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- El cliente consume la carta del restaurante resuelto por el QR; se eliminaron fallbacks a un slug histórico.
- La ficha de plato permite cantidad, nota de cocina y agregado al carrito colaborativo.
- El carrito se lee desde la API, refleja cambios de otros comensales, permite quitar ítems sólo en `DRAFT` y calcula el total desde servidor.
- El envío de comanda respeta `allowOrdering` y distingue `requireWaiterValidation` (mozo) de envío directo a cocina.
- La pantalla informa el estado de la comanda y conserva un identificador de comensal por sesión de navegador.
- Los endpoints de pedido aplican también el aislamiento `SINGLE_RESTAURANT` para tokens bearer.

## Verificación

| Verificación | Resultado |
|---|---|
| `guest-orders-validation.test.ts` | 33/33 PASS |
| `menu-access.test.ts` + `capabilities-contract.test.ts` | 42/42 PASS conjunto |
| aislamiento QR/sesión/carrito | 3/3 PASS |
| API build directo | PASS |
| Client-web Vite build | PASS |

## Límite conocido

La prueba táctil multi-dispositivo y la recepción real en KDS quedan para las etapas 08 y 20–21. El runner oficial acotado de Windows sigue pendiente del adaptador Job de la jornada.
