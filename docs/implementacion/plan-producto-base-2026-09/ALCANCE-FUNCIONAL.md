# Alcance funcional del producto base

## Estados objetivo

- `CORE_STABLE`: siempre disponible en una instalación base.
- `MODULE_STABLE`: completo y activable si se configuran sus dependencias.
- `INTEGRATION_READY`: completo en sandbox/staging; requiere credenciales del local.
- `ADMIN_ONLY`: capacidad de provisión/operación, no autoservicio público.

La meta del programa es eliminar `PARCIAL` y `DEMO` del contrato público. Una capacidad que todavía no alcance estos estados permanece oculta o `COMING_SOON` durante la implementación.

## Comensal

| IDs | Estado objetivo | Etapas |
|---|---|---|
| C01-C06 | CORE_STABLE | 05-06 |
| C07-C12 | CORE_STABLE | 06-09 |
| C13 | MODULE_STABLE | 11 |
| C14 | MODULE_STABLE | 12 |
| C15 | MODULE_STABLE | 13 |
| C16 | MODULE_STABLE | 14 |
| C17 | MODULE_STABLE | 18 |

## Personal

| IDs | Estado objetivo | Etapas |
|---|---|---|
| P01-P05 | CORE_STABLE | 04, 07 |
| P06-P07 | CORE_STABLE | 08 |
| P08 | CORE_STABLE presencial + opción Mercado Pago informativa | 09, 15 |
| P09 | MODULE_STABLE | 14 |

## Administración

| IDs | Estado objetivo | Etapas |
|---|---|---|
| A01 | CORE_STABLE | 03-04 |
| A02 | ADMIN_ONLY | 03 | Provisioning controlado, no alta pública |
| A03-A09 | CORE_STABLE | 03-09 |
| A10-A11 | CORE_STABLE | 10 |

## Plataforma e integraciones

| IDs | Estado objetivo | Etapas |
|---|---|---|
| T01-T03 | CORE_STABLE | 00-03, 19 |
| T04 | CORE_STABLE como opción informativa; cobro autónomo fuera de alcance | 15 |
| T05 | MODULE_STABLE | 11 |
| T06 | INTEGRATION_READY | 17 |
| T07 | CORE_STABLE | 05, 17 |

## Reglas de coherencia

- Si `allowOrdering=false`, carrito y envío desaparecen, pero llamados/cuenta siguen un recorrido válido.
- Si `requireWaiterValidation=true`, cocina nunca recibe una comanda no validada.
- Si el local elige envío directo, las restricciones de stock, duplicados y recuperación siguen vigentes.
- Si Mercado Pago se marca como opción, el cliente lo muestra como preferencia y genera un llamado; el cobro siempre se confirma presencialmente. Si no está marcado, sólo aparecen medios presenciales.
- Split sólo se habilita con pago digital operativo y modelo de claims aprobado.
- Reviews sólo aparece con Place ID válido.
- Rewards sólo aparece con identidad/ledger activos.
- Sommelier sólo recomienda inventario activo y se abstiene ante restricciones no verificables.
- Toda métrica diferencia `MEASURED`, `ESTIMATED` y `UNAVAILABLE`.
