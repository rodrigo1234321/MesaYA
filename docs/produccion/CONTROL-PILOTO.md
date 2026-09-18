# Tablero de Control de Cierre y Gates — MesaYA

Fecha: 2026-09-14  
Versión: 2.1.0  

> **HISTÓRICO:** este tablero conserva el estado de su cierre anterior. Para la rama, los cuatro proyectos Vercel y los dos workflows actuales consultar [`deploy/mesaya-canonical-manifest.json`](../../deploy/mesaya-canonical-manifest.json).

Rama activa de este snapshot: `release/pilot-1day-v1.0.0`
Plan rector: `docs/produccion/PLAN-MAESTRO-CIERRE-Y-PILOTO-1-DIA-2026-09-13.md`  
**Dictamen Formal Consolidado**: `PASS_LOCAL técnico — NO-GO para piloto real hasta validación remota en Supabase Cloud, Vercel Cloud y simulacro en vivo de backup/restore`.

---

## 1. Estado de los Gates del Plan Maestro

| Gate | Etapa | Descripción | Estado | Evidencia / Notas |
|:---:|---|---|:---:|---|
| **GATE-E00** | E00 | Congelación, inventario de baseline y ramas | `PASSED_LOCAL` | Rama `release/pilot-1day-v1.0.0` creada; `.gitignore` actualizado; baseline congelado. |
| **GATE-E01** | E01 | Contratos canónicos de dominio | `PASSED_LOCAL` | `packages/shared/src/contracts/` con unit tests 100% (11/11 tests pass) y build limpio. |
| **GATE-E02** | E02 | Dependencias y Fastify 5 / Node 22 | `PASSED_LOCAL` | Fastify 5.12.4, @fastify/jwt 10.2.2, @fastify/cors 11.3.0. `npm audit --omit=dev` 0 vulnerabilidades. 616/619 tests pasan (3 skipped). |
| **GATE-E03** | E03 | Núcleo monetario y transacciones atómicas | `PASSED_LOCAL` | Recálculo atómico en validación; convergencia canónica comanda-cuenta-recibo con divergencia cero. Test `monetary-convergence.test.ts` aprobado. Script `audit-and-backfill-monetary-data.mjs` y `DATA-AUDIT.json` creados. |
| **GATE-E04** | E04 | Identidad Staff, PIN concurrente, terminal y errores opacos | `PASSED_LOCAL` | Contrato 4-6 dígitos en backend y staff modal; constraint único de base de datos con HMAC-SHA256 (`pinFingerprint`) verificado bajo concurrencia real (`Promise.allSettled` con error P2002); desacoplamiento de terminal (token temporal 300s `temp: true`, auto-bloqueo por inactividad a 5 min); sanitización universal de rutas (0 fugas de `err.message` en 500) vía `sendSanitizedError`. |
| **GATE-E05** | E05 | Frontends, QR canónico, acentos y timezone | `PASSED_LOCAL` | Navegación ticket directa activa subTab tickets; QR local con `qrcode` sin dependencias externas; normalización NFD de alérgenos y restricciones; cálculo de métricas con timezone IANA (America/Argentina/Buenos_Aires). |
| **GATE-E06** | E06 | Observabilidad Pino JSON y logging seguro | `PASSED_LOCAL` | CorrelationId propagado/inyectado (`x-correlation-id`, `x-request-id`); redacción garantizada de datos sensibles (`pin`, `token`, `password`, `authorization`); contextualización estructurada en errores (restaurantId, staffUserId, terminalId); calibración anti-bloqueo Wi-Fi de salón en staff login (por terminalId) y waitlist (por teléfono + IP). |
| **GATE-E07** | E07 | Suite de regresión automatizada y serverless handler | `PASSED_LOCAL` | Test de ciclo de vida completo del handler serverless exportado (`packages/api/test/serverless-lifecycle.test.ts`) ejecutando request HTTP real con bootstrapping en frío, headers y respuesta JSON exitosa (200 OK en `/health` y `/v1/health`). |
| **GATE-E08** | E08 | Supabase: migraciones, hardening y restore probado | `PASSED_LOCAL` (Doc/Script) | Script reproducible `scripts/supabase-hardening.sql` que revoca permisos a `anon` y `authenticated` sobre `public`; 23 migraciones postgres versionadas; protocolo de restauración documentado con RPO/RTO en `docs/produccion/BACKUP-RESTORE-PROOF.md`. Pendiente ejecución remota sobre instancia cloud. |
| **GATE-E09** | E09 | Vercel: relevamiento real y 4 artefactos canónicos | `PASSED_LOCAL` (Doc) | Documentación exhaustiva `docs/produccion/VERCEL-TOPOLOGY.md` con matriz exacta de 4 proyectos (`mesaya-api`, `mesaya-client-web`, `mesaya-staff-panel`, `mesaya-admin-dashboard`), build configs, rewrites SPA y variables de entorno canónicas. Pendiente push y despliegue cloud. |
| **GATE-E10** | E10 | Staging integrado y prueba de carga k6 | `PASSED_LOCAL` | Perfil reproducible de carga `tests/load/pilot-profile.js` actualizado con endpoints funcionales de negocio (carta comensal, sesión QR, workspace unificado mozo/cocina, reporte de ventas caja); thresholds estrictos de p95 < 800ms. |
| **GATE-E11** | E11 | Ensayo físico en local y fallback en papel | `PENDING_REMOTE_EXECUTION` | Protocolo formalizado en `docs/produccion/PHYSICAL-ACCEPTANCE.md` que valida hardware (QRs acrílicos, Wi-Fi 20 dispositivos, tablets, cocina con sonido, POS e impresora) y kit de fallback en papel (< 90s tiempo de conmutación). Pendiente ensayo en salón. |
| **GATE-E12** | E12 | Revisión independiente y dictamen formal GO/NO-GO | `PASSED_LOCAL` | Dictamen formalizado en `docs/produccion/GO-NO-GO-DECISION.md`: `PASS_LOCAL técnico — NO-GO para piloto real`. |
| **GATE-E13** | E13 | Jornada piloto en salón en vivo | `PENDING_REMOTE_EXECUTION` | Protocolo y checklist de ejecución documentados en `docs/produccion/PILOT-LIVE-LOG.md`. Pendiente fecha de despliegue en salón. |
| **GATE-E14** | E14 | Conciliación post-servicio y plan de escalamiento | `PENDING_REMOTE_EXECUTION` | Protocolo de conciliación de caja y auditoría de divergencia cero formalizado en `docs/produccion/POST-SERVICE-RECONCILIATION.md`. |

---

## 2. Estado de Hallazgos P0 y P1

| ID | Prioridad | Componente | Descripción resumida | Estado | Etapa Causal |
|---|:---:|---|---|:---:|:---:|
| **P0-01** | P0 | API / DB | Órdenes aceptadas no recalculaban totales de cabecera atómicamente. | `CLOSED` | E03 |
| **P0-02** | P0 | API / Deps | Vulnerabilidades críticas/altas en `fast-jwt`, `fastify`, plugins. | `CLOSED` | E02 |
| **P0-03** | P0 | Scripts / Auth | Bootstrap con PIN `9999` por defecto, rota siempre y lo imprime en stdout. | `CLOSED` | E04 |
| **P0-04** | P0 | Staff UI / Auth | Concurrencia de PIN con constraint `pinFingerprint` (HMAC-SHA256) en DB y código 409 `PIN_ALREADY_IN_USE`. | `CLOSED` | E04 |
| **P0-05** | P0 | API / Handler | Fuga de `err.message` sanitizada en todos los controladores de ruta vía `sendSanitizedError`. | `CLOSED` | E04 |
| **P0-06** | P0 | Supabase / DB | Migraciones sin RLS ni revocación de permisos sobre schema `public` (script SQL creado). | `CLOSED` (Local) | E08 |
| **P0-07** | P0 | Base de Datos | Procedimiento de restore documentado paso a paso con RPO/RTO. | `CLOSED` (Doc) | E08 |
| **P0-08** | P0 | Vercel Serverless | Smoke de serverless invocando el handler exportado con ciclo de vida real. | `CLOSED` | E07 |
| **P0-09** | P0 | Infra / Vercel | Topología y configuración de los 4 proyectos canónicos documentada en `VERCEL-TOPOLOGY.md`. | `CLOSED` (Doc) | E09 |
| **P1-01** | P1 | Admin UI | "Ver ticket" no activa automáticamente la pestaña de tickets. | `CLOSED` | E05 |
| **P1-02** | P1 | Admin / QR | Admin genera QR con query string a su propio host; servicio externo para imagen. | `CLOSED` | E05 |
| **P1-03** | P1 | Métricas / Salón | Cortes diarios calculados con zona horaria del servidor y no del restaurante. | `CLOSED` | E05 |
| **P1-04** | P1 | Cliente / Menú | Detección de alérgenos sensible a diacríticos (ej. `alérgica`, `celíaco`). | `CLOSED` | E05 |
| **P1-05** | P1 | Seguridad / Red | Rate limiting por IP puede bloquear colectivamente el router Wi-Fi del salón. | `CLOSED` | E06 |
| **P1-06** | P1 | Observabilidad | Logs estructurados con Pino JSON y correlación end-to-end con `correlationId`. | `CLOSED` | E06 |
