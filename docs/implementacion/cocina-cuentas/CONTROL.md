# Control de Etapas — Cocina Directa y Cuentas por Persona (MesaYA RTMS)

Fecha: 2026-09-06  
Rama activa: `codex/mesaya-cocina-cuentas-20260905`  
Plan de Referencia: `docs/implementacion/COCINA-CUENTAS-2026-09-05.md`  
Criterios de Aceptación: `docs/implementacion/COCINA-CUENTAS-ACEPTACION.md`

---

## Tabla de Control y Estado de Etapas

| Etapa | Alcance Técnico | Estado | Commit Base | Reporte de Entrega |
|---|---|---|---|---|
| **01** | Login Admin/Staff, bootstrap, PIN, QR/CORS, validación y rate limit | **APPROVED** | `81faaa2` | [ENTREGA-01.md](ENTREGA-01.md) |
| **02** | Dependencias, handler HTTP, Fastify 5 hardening y build monorepo | **APPROVED** | `ca57b99` | [ENTREGA-02.md](ENTREGA-02.md) |
| **03** | Contratos/datos: participantes, modificadores, tandas, centavos ARS e idempotencia | **APPROVED** | `2f8c578` | [ENTREGA-03.md](ENTREGA-03.md) |
| **04** | Backend de pedidos directo/validado + FSM + disponibilidad + atomicidad | **APPROVED** | `b2e0245` (rev `07074c5`) | [ENTREGA-04.md](ENTREGA-04.md) |
| **05** | Comensal: producto, carrito colaborativo, autoría, tandas y reconexión móvil | **APPROVED** | `e0ff9c4` (rev `07074c5`) | [ENTREGA-05.md](ENTREGA-05.md) |
| **06** | Admin modos, KDS cocina directo, detección de alérgenos y toggle de agotados | **APPROVED** | `355c89d` (rev `07074c5`) | [ENTREGA-06.md](ENTREGA-06.md) |
| **07** | Cuenta dividida backend, asignaciones optimistas, centavos y cobros parciales | **APPROVED** | `2230896` | [ENTREGA-07.md](ENTREGA-07.md) |
| **08** | UI de Mi Parte en comensal, caja y cobros parciales en staff-panel (flujo 3 personas) | **APPROVED** | `12f319a` | [ENTREGA-08.md](ENTREGA-08.md) |
| **09** | E2E integral (16 tests), blindaje concurrente de caja, manager auth, FSM atómica, contrato Mercado Pago y Runbook | **APPROVED** | `PENDING_COMMIT` | [ENTREGA-09.md](ENTREGA-09.md) |

---

## Verificación de Gates de Calidad (Etapa 09)

1. **Paridad de Esquema (`Check.ps1 -Check schema`)**: PASS (Exit code 0).
2. **Rutas y API Drift (`Check.ps1 -Check routes`)**: PASS (85 rutas clasificadas, 0 drift, Exit code 0).
3. **Compilación de Workspaces (`Check.ps1 -Check build`)**: PASS (6/6 paquetes compilados, Exit code 0).
4. **Compilación PostgreSQL (`Check.ps1 -Check build-pg`)**: PASS (Target PostgreSQL/Supabase verificado, Exit code 0).
5. **Suite E2E Integral (`Check.ps1 -Check suite -Suite cocina-cuentas-etapa-09`)**: PASS (16/16 pruebas exitosas, Exit code 0).
6. **Batería Global Aislada (`Check.ps1 -Check suite`)**: PASS (39/39 suites aprobadas sin regresiones, Exit code 0).

---

## Invariantes de Seguridad y Producción

- **Pagos Digitales en Vivo**: Bloqueados incondicionalmente (`503 DIGITAL_PAYMENTS_UNAVAILABLE`).
- **Contabilidad Canónica**: Números enteros en centavos de peso (`ARS`). Queda prohibida la persistencia o cálculo en floats.
- **Autoridad de Reversión**: Restringida exclusivamente a roles `MANAGER` con auditoría inmutable (`reversalReason`, `reversalStaffId`, `reversalAt`).
- **Idempotencia Transaccional**: Bloqueo exclusivo de fila por sesión (`paymentSeq`) y conflicto 409 ante fingerprint discrepante.
