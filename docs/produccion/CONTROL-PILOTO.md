# Tablero de Control de Cierre y Gates — MesaYA

Fecha: 2026-09-13  
Versión: 2.0.0  
Rama activa: `release/pilot-1day-v1.0.0`  
Plan rector: `docs/produccion/PLAN-MAESTRO-CIERRE-Y-PILOTO-1-DIA-2026-09-13.md`

---

## 1. Estado de los Gates del Plan Maestro

| Gate | Etapa | Descripción | Estado | Evidencia / Notas |
|:---:|---|---|:---:|---|
| **GATE-E00** | E00 | Congelación, inventario de baseline y ramas | `PASSED_LOCAL` | Rama `release/pilot-1day-v1.0.0` creada; `.gitignore` actualizado; tablero inicializado. |
| **GATE-E01** | E01 | Contratos canónicos de dominio | `PASSED_LOCAL` | `packages/shared/src/contracts/` con unit tests 100% (11/11 tests pass) y build limpio. |
| **GATE-E02** | E02 | Dependencias y Fastify 5 / Node 22 | `PENDING` | `npm audit --omit=dev` 0 vulnerabilidades; build y parity OK. |
| **GATE-E03** | E03 | Núcleo monetario y transacciones atómicas | `PENDING` | Recálculo atómico en validación; tests de concurrencia e idempotencia. |
| **GATE-E04** | E04 | Identidad Staff, PIN no colisionable y errores opacos | `PENDING` | Contrato 4-6 dígitos, PIN no duplicado por local, error boundary 500 opaco. |
| **GATE-E05** | E05 | Frontends, QR canónico, acentos y timezone | `PENDING` | Navegación ticket, QR SVG/Canvas local, normalización NFD, IANA timezone. |
| **GATE-E06** | E06 | Observabilidad Pino JSON y logging seguro | `PENDING` | CorrelationId, campos redactados (`pin`, `token`), formato estructurado. |
| **GATE-E07** | E07 | Suite de regresión automatizada y serverless handler | `PENDING` | Test del handler serverless real, cold start, E2E Playwright. |
| **GATE-E08** | E08 | Supabase: migraciones, hardening y restore probado | `PENDING` | Permisos revocados sobre `public`, test de restore documentado. |
| **GATE-E09** | E09 | Vercel: relevamiento real y 4 artefactos canónicos | `PENDING` | Inventario exacto de 4 proyectos, cero proyectos huérfanos. |
| **GATE-E10** | E10 | Staging integrado y prueba de carga k6 | `PENDING` | Test de carga (16 clientes, 2 mozos, 1 cocina, 1 caja) p95 < 800ms, 0% 5xx. |
| **GATE-E11** | E11 | Ensayo físico en local y fallback en papel | `PENDING` | Dry run 90m (T-24h), checklist firmado y simulacro de papel ensayado. |
| **GATE-E12** | E12 | Revisión independiente y dictamen formal GO/NO-GO | `PENDING` | Firma de Lead Técnico (Rodrigo) y Encargado de Salón. |
| **GATE-E13** | E13 | Jornada piloto en salón en vivo | `PENDING` | 4 mesas, monitoreo pasivo, cero condiciones de aborto. |
| **GATE-E14** | E14 | Conciliación post-servicio y plan de escalamiento | `PENDING` | Cuadre exacto de caja vs base de datos, reporte final. |

---

## 2. Estado de Hallazgos P0 y P1

| ID | Prioridad | Componente | Descripción resumida | Estado | Etapa Causal |
|---|:---:|---|---|:---:|:---:|
| **P0-01** | P0 | API / DB | Órdenes aceptadas no recalculaban totales de cabecera atómicamente. | `OPEN` | E03 |
| **P0-02** | P0 | API / Deps | Vulnerabilidades críticas/altas en `fast-jwt`, `fastify`, plugins. | `OPEN` | E02 |
| **P0-03** | P0 | Scripts / Auth | Bootstrap con PIN `9999` por defecto, rota siempre y lo imprime en stdout. | `OPEN` | E04 |
| **P0-04** | P0 | Staff UI / Auth | Input forzado a 4 dígitos en UI; PIN duplicado no validado en backend. | `OPEN` | E04 |
| **P0-05** | P0 | API / Handler | Fuga de `err.message` en múltiples controladores eludiendo manejador global. | `OPEN` | E04 |
| **P0-06** | P0 | Supabase / DB | Migraciones sin RLS ni revocación de permisos sobre schema `public`. | `OPEN` | E08 |
| **P0-07** | P0 | Base de Datos | Falta de prueba de restauración funcional de backup en PostgreSQL. | `OPEN` | E08 |
| **P0-08** | P0 | Vercel Serverless | Smoke de serverless no invocaba el handler exportado con ciclo de vida real. | `OPEN` | E07 |
| **P0-09** | P0 | Infra / Vercel | Discrepancias en proyectos/checks de despliegue en Vercel. | `OPEN` | E09 |
| **P1-01** | P1 | Admin UI | "Ver ticket" no activa automáticamente la pestaña de tickets. | `OPEN` | E05 |
| **P1-02** | P1 | Admin / QR | Admin genera QR con query string a su propio host; servicio externo para imagen. | `OPEN` | E05 |
| **P1-03** | P1 | Métricas / Salón | Cortes diarios calculados con zona horaria del servidor y no del restaurante. | `OPEN` | E05 |
| **P1-04** | P1 | Cliente / Menú | Detección de alérgenos sensible a diacríticos (ej. `alérgica`, `celíaco`). | `OPEN` | E05 |
| **P1-05** | P1 | Seguridad / Red | Rate limiting por IP puede bloquear colectivamente el router Wi-Fi del salón. | `OPEN` | E06 |
| **P1-06** | P1 | Observabilidad | Logs no estructurados y sin correlación end-to-end con `correlationId`. | `OPEN` | E06 |
