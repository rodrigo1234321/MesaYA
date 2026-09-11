# Matriz de alcance por capacidad

## Comensal

| ID | Destino | Gate principal | Observación |
|---|---|---|---|
| C01 | PILOT_REQUIRED | P03/P06/P07 | QR y NFC comparten URL; prueba física obligatoria |
| C02 | PILOT_REQUIRED | P03 | cierre, expiración, reintento e invalidación |
| C03 | PILOT_REQUIRED | P03 | datos suficientes para operación; enriquecimiento IA en P05 |
| C04 | PILOT_REQUIRED | P03 | cantidad/notas y errores visibles |
| C05 | PILOT_REQUIRED | P03 | identidad liviana, no cuenta permanente |
| C06 | PILOT_REQUIRED | P03 | semántica única según D08 |
| C07 | PILOT_REQUIRED | P03 | validación obligatoria del mozo |
| C08 | PILOT_REQUIRED | P02/P03 | total consistente con caja |
| C09 | PILOT_REQUIRED | P02 | presencial; digital en E03 |
| C10 | PILOT_REQUIRED | P03 | deduplicación, prioridad y cancelación |
| C11 | PILOT_REQUIRED | P03 | catálogo de motivos/insumos controlado |
| C12 | PILOT_REQUIRED | P03 | estado autoritativo por polling |
| C13 | PILOT_BETA | P05 | apagable y no bloqueante |
| C14 | LATER | E01 | exige medición de impacto |
| C15 | SPLIT_SCOPE | P02/E01 | propina presencial P02; reseña E01/opcional |
| C16 | LATER | E02 | falta producto público completo |
| C17 | LATER | E05 | requiere identidad y ledger |

## Personal

| ID | Destino | Gate principal | Observación |
|---|---|---|---|
| P01-P07 | PILOT_REQUIRED | P03 | ciclo de rol, llamados, KDS y carga manual |
| P08 | PILOT_REQUIRED | P02 | pantalla de caja es brecha crítica |
| P09 | LATER | E02 | panel no alcanza sin flujo público/concurrencia |

## Administración

| ID | Destino | Gate principal | Observación |
|---|---|---|---|
| A01 | PILOT_REQUIRED | P01/P07 | recuperación real a validar |
| A02 | BLOCKED | — | alta deshabilitada intencionalmente |
| A03-A09 | PILOT_REQUIRED | P01-P03 | operación/configuración real |
| A10 | PILOT_REQUIRED | P04 | datos reales y tamaño de muestra |
| A11 | PILOT_REQUIRED_LIMITED | P04 | measured o N/D; simulaciones separadas |

## Plataforma e integraciones

| ID | Destino | Gate principal | Observación |
|---|---|---|---|
| T01-T03 | PILOT_REQUIRED | P00-P03/P08 | aislamiento, salud y recuperación |
| T04 | LATER | E03/E04 | 503 y flags honestos hasta entonces |
| T05 | PILOT_BETA | P05 | clave/modelo no obligatorios para GO |
| T06 | LATER | decisión posterior | definir respaldo completo antes de anunciarlo |
| T07 | PILOT_REQUIRED | P06/P07 | retirar valores históricos y probar soportes |

## Regla de estado

- `PILOT_REQUIRED`: bloquea GO si no pasa.
- `PILOT_REQUIRED_LIMITED`: entra con el contrato recortado explícito.
- `PILOT_BETA`: puede apagarse sin bloquear el núcleo.
- `SPLIT_SCOPE`: se divide entre una entrega mínima y otra posterior.
- `LATER`: no visible como operativo en el piloto.
- `BLOCKED`: deshabilitado intencionalmente y explicado.

