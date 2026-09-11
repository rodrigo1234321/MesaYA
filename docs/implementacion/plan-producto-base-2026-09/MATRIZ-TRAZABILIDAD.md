# Matriz de trazabilidad de capacidades — etapa 00

Esta matriz separa el estado declarado en el inventario funcional del estado que debe demostrarse en el producto base. `✅`, `⚠️` y `⛔` reproducen el inventario recibido; no significan que esta etapa haya certificado el recorrido.

| ID | Estado declarado | Objetivo base | Etapa | Evidencia que debe cerrar |
|---|---:|---|---:|---|
| C01 | ✅ | CORE_STABLE | 05 | QR/NFC resuelven la misma mesa en iOS/Android y dos redes |
| C02 | ✅ | CORE_STABLE | 05 | expiración, cierre, reintento e invalidación del token |
| C03 | ✅ | CORE_STABLE | 06 | carta, stock, tags y precios consistentes entre clientes |
| C04 | ✅ | CORE_STABLE | 06 | cantidad/notas, validación y recuperación tras refresh |
| C05 | ✅ | CORE_STABLE | 06 | actor/grupo persistido sin cuenta permanente |
| C06 | ✅ | CORE_STABLE | 06 | dos comensales, snapshot y cambios después de envío |
| C07 | ✅ | CORE_STABLE | 06 | validación del mozo y alternativa directa con reglas completas |
| C08 | ✅ | CORE_STABLE | 09 | consumo, cuenta, total y estado final consistentes |
| C09 | ✅ | CORE_STABLE presencial + opción Mercado Pago informativa | 09/15 | caja presencial idempotente; la opción digital sólo genera aviso al personal |
| C10 | ✅ | CORE_STABLE | 07 | motivo, prioridad, deduplicación y cancelación |
| C11 | ✅ | CORE_STABLE | 07 | insumo trazable a mesa y resolución del staff |
| C12 | ✅ | CORE_STABLE | 07 | snapshot autoritativo, temporizador y reconexión |
| C13 | ⚠️ | MODULE_STABLE | 11 | filtros duros, abstención, IDs disponibles y evaluación humana |
| C14 | ⚠️ | MODULE_STABLE | 12 | sugerencia consumida por UI, stock y medición incremental |
| C15 | ⚠️ | MODULE_STABLE | 13 | propina asociada a pago, feedback real y Place ID válido |
| C16 | ⚠️ | MODULE_STABLE | 14 | ingreso público, aviso, no-show y asiento atómico |
| C17 | ⚠️ | MODULE_STABLE | 18 | identidad, ledger, acreditación, saldo y canje |
| P01 | ✅ | CORE_STABLE | 04 | terminal compartido, login y cambio de actor |
| P02 | ✅ | CORE_STABLE | 07 | bandeja global con prioridad y ownership |
| P03 | ✅ | CORE_STABLE | 07 | filtro sectorial sin perder vista global |
| P04 | ✅ | CORE_STABLE | 04/07 | audio, reconexión y edad de snapshot |
| P05 | ✅ | CORE_STABLE | 07 | en camino, resolver, reasignar y liberar con permiso |
| P06 | ✅ | CORE_STABLE | 08 | KDS unificado para pedidos de comensal y mozo |
| P07 | ✅ | CORE_STABLE | 08 | carga manual con actor y estados coherentes |
| P08 | ⚠️ | CORE_STABLE presencial + opción Mercado Pago informativa | 09/15 | caja visible, roles, propina y aviso de preferencia; sin conciliación autónoma |
| P09 | ⚠️ | MODULE_STABLE | 14 | pantalla pública y concurrencia de llamada/sentado |
| A01 | ✅ | CORE_STABLE | 03/04 | manager, sesión, expiración y recuperación |
| A02 | ⛔ | ADMIN_ONLY | 03 | provisión controlada; no onboarding público implícito |
| A03 | ✅ | CORE_STABLE | 05 | abrir/cerrar/rotar turno con estados abiertos |
| A04 | ✅ | CORE_STABLE | 05 | mesas, sectores y enlaces por instancia |
| A05 | ✅ | CORE_STABLE | 05 | plano, capacidad, unión y FSM sin pérdidas |
| A06 | ✅ | CORE_STABLE | 06 | carta, importación, stock y precios por local |
| A07 | ✅ | CORE_STABLE | 06 | branding/portada versionado por instancia |
| A08 | ✅ | CORE_STABLE | 01/02 | módulos, dependencias y auditoría efectiva |
| A09 | ✅ | CORE_STABLE | 04 | personal, roles, PIN, sector y desactivación |
| A10 | ⚠️ | CORE_STABLE | 10 | tiempos y satisfacción con muestra y fuente |
| A11 | ⚠️ | CORE_STABLE | 10 | RevPASH, embudo, mapa y mesa sin estimaciones ocultas |
| T01 | ✅ | CORE_STABLE | 02/19 | aislamiento por instancia/tenant, roles y permisos |
| T02 | ✅ | CORE_STABLE | 02/03 | Supabase, migraciones, backup y health profundo |
| T03 | ✅ | CORE_STABLE | 07/19 | polling, backoff, recuperación y mutación confirmada |
| T04 | ⛔ autónomo / ✅ informativo | CORE_STABLE informativa | 15 | selector visible, llamado al personal y cobro presencial; split autónomo continúa cerrado |
| T05 | ⚠️ | MODULE_STABLE | 11 | clave/modelo configurado, límites y fallback honesto |
| T06 | ⚠️ | INTEGRATION_READY | 17 | WhatsApp completo y anti-duplicado |
| T07 | ⚠️ | CORE_STABLE | 05/17 | QR/NFC sin históricos, generación y prueba física |

## Invariantes que atraviesan la matriz

1. Un recurso nunca puede cruzar restaurante, instancia o terminal sin autorización.
2. Una mutación sensible siempre tiene actor, rol, versión e idempotencia.
3. Un estado visual de éxito sólo aparece después de confirmación del backend.
4. Un módulo desactivado desaparece coherentemente de configuración, API y cliente.
5. Una métrica sin muestras es `UNAVAILABLE`, no un valor prefijado.
6. Un pago confirmado por el navegador no es un pago confirmado por el sistema.
