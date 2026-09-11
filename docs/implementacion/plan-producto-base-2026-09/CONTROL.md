# Control del plan de producto base

Estado general: **LÍNEA BASE CLONABLE — GATES LOCALES EN VERIFICACIÓN CONTINUA**  
Código base: preparado para clonarse desde GitHub y parametrizarse por local.  
Instancias remotas autorizadas: ninguna.

## Estados

`PROPOSED -> READY -> IN_PROGRESS -> NEEDS_REVIEW -> APPROVED`

Corrección: `NEEDS_REVIEW -> CHANGES_REQUESTED -> IN_PROGRESS`.  
Dependencia externa: `BLOCKED`, indicando evidencia, responsable y salida.

| Etapa | Estado | Dependencia | Pausa |
|---|---|---|---|
| 00 | APPROVED | Baseline y contrato documentados; runner Windows queda para certificación final | Sí |
| 01 | APPROVED | Validación de capacidades implementada y pruebas locales PASS | No |
| 02 | APPROVED | Modo single-instance y límites de auth verificados localmente | No |
| 03 | APPROVED | Manifiesto y validator de instalación PASS; Vercel/Supabase remotos no tocados | PAUSA A |
| 04 | APPROVED | Terminal + actor por PIN y builds de staff/API PASS | No |
| 05 | APPROVED | QR/NFC estable, aislamiento público por instancia y generador por configuración PASS; runner Windows queda para certificación final | No |
| 06 | APPROVED | Carta/carrito colaborativo de comensal, política de envío y builds/tests PASS; runner Windows queda para certificación final | No |
| 07 | APPROVED | Llamados, límites, estados, cancelación, aislamiento y polling de pantalla compartida PASS; runner Windows queda para certificación final | No |
| 08 | APPROVED | KDS unificado, carga por mozo, transiciones y polling con backoff PASS; runner Windows queda para certificación final | No |
| 09 | APPROVED | Caja presencial, idempotencia, propina, cierre/liberación y pantalla compartida PASS; runner Windows queda para certificación final | No |
| 10 | APPROVED | Analytics medidos, calidad y UI sin defaults implícitos; builds/tests locales PASS | No |
| 11 | APPROVED | Sommelier determinístico, abstención, presupuesto, catálogo disponible y generación IA contenida; tests/build PASS | No |
| 12 | APPROVED | Upsell consumido por cliente, control/telemetría/idempotencia y builds PASS | No |
| 13 | APPROVED | Tipos/monto libre de propina, rating interno real, Google condicionado a Place ID y deduplicación PASS | PAUSA C |
| 14 | APPROVED | Pantalla pública de fila, ticket protegido por teléfono, pre-pedido validado, promoción a KDS y seating concurrente PASS | No |
| 15 | APPROVED | 14 APPROVED; Mercado Pago queda como opción informativa configurable y el cobro real sigue siendo presencial | No |
| 16 | DEFERRED_BY_PRODUCT_SCOPE | La división digital depende de un proveedor financiero que no forma parte de esta release | No |
| 17 | ADAPTERS_READY_EXTERNAL | WhatsApp y hardware físico requieren credenciales/dispositivos del local | No |
| 18 | APPROVED | Rewards independiente de integraciones 16/17: ledger, acreditación por cobro manual, canje/reversión atómicos y pantalla compartida PASS; certificación externa queda pendiente | PAUSA D |
| 19 | APPROVED_LOCAL | Seguridad, aislamiento, accesibilidad y resiliencia local verificadas; cloud/dispositivo quedan como gate de instancia | No |
| 20 | APPROVED_LOCAL | Suite determinista, build SQLite/PG, matriz de rutas, schema y contratos verificados localmente | No |
| 21 | EXTERNAL_INSTANCE_GATE | Requiere una instancia Supabase/Vercel y dispositivos del local; no bloquea el código clonable | Sí |
| 22 | READY_FOR_REPLICATION | Runbook, manifiesto, plan declarativo y scripts de instalación listos; ejecución remota requiere autorización | Sí |

## Gate por etapa

- alcance acotado y sin secretos;
- pruebas positivas, negativas, permisos, reintento y recuperación;
- build de todos los workspaces afectados;
- suite aislada y PostgreSQL desechable cuando aplique;
- recorrido visual/táctil para UI;
- migración revisada y compatible;
- reporte de ejecutado/no ejecutado/riesgos/rollback;
- revisión antes de habilitar la siguiente.

## Gate de release base

Una versión de código base sólo puede marcarse clonable si:

- la suite de certificación coincide con su matriz funcional;
- fue probada en base local desechable y sus builds/contratos están verdes;
- tiene manifest, changelog, migraciones y rollback;
- las capacidades no configuradas fallan cerradas y no se muestran como operativas;
- puede instalarse en una base local nueva y tiene un runbook explícito para actualizar una instancia remota;
- no requiere un patch manual exclusivo para el restaurante de referencia.

La etiqueta `EXTERNAL_INSTANCE_GATE` no significa que falte código: significa que todavía no se utilizaron cuentas, dispositivos o datos reales de un restaurante concreto.
