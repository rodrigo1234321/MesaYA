# Control de Ejecución — Remediación y Revisión MesaYA (Continuación)

Fecha: 2026-09-22
Candidato: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-remediacion-20260921`
Rama: `codex/remediacion-auditoria-20260921`
Ejecutor: AntiGravity
Orden: `docs/remediacion-auditoria-20260921/PLAN-SIGUIENTE-PASO-2026-09-22.md`
Estado Global: `REMEDIACION_COMPLETA_REVISADA_LOCALMENTE`

---

## Tabla de Control de Fichas (P1–P4 / C00–C06)

| Etapa / Ficha | Descripción | Dependencias | Responsable | Estado | Gates / Criterios de Aceptación |
|---|---|---|---|---|---|
| **P1 / C01** | Contrato explícito y cerrado de errores públicos | Ninguna | API / AntiGravity | `DONE` | **17/17 tests PASS** en `error-sanitization.test.ts`. Allowlist cerrada `KNOWN_PUBLIC_DOMAIN_CODES` (80+ códigos de dominio). Bloqueo total de IPs internas (10.x, 172.16-31.x, 192.168.x, 127.x), hostnames (.internal, .local, .lan, etc.), URLs con credenciales (`scheme://user:pass@host`), paths y DB connection strings en `message`, `error` y `details`. Códigos no registrados se degradan obligatoriamente a canónicos (`BAD_REQUEST`, `INTERNAL_SERVER_ERROR`) con mensaje genérico y `details: undefined`. Prueba sobre ruta real Fastify (`/api/auth/login`) con sintaxis JSON inválida verificada. |
| **P2 / C03** | Estabilidad de foco y semántica modal en useFocusTrap | P1 | Frontend / AntiGravity | `DONE` | Hook `useFocusTrap` desacoplado de la referencia `onClose` mediante `onCloseRef`. Captura inicial de foco restringida estrictamente a transiciones `false -> true`. Limpieza y cancelación de `requestAnimationFrame` en cierre y desmontaje. **5/5 tests PASS** en `apps/admin-dashboard/src/hooks/useFocusTrap.test.tsx` en DOM real jsdom con `@testing-library/react`. Foco estable garantizado durante escritura continua en campos secundarios ante re-renders del componente padre. 100% de modales inventariados y asegurados en Admin, Staff y Client Web. |
| **P3 / C02** | Deuda de linting y any clasificada con precisión | P1, P2 | Tooling / AntiGravity | `DONE` | **0 errores de linting** en todo el monorepo. Script de auditoría y gate `scripts/check-debt-gate.mjs` (`npm run check:lint-debt`) integrado en `package.json`. Desglose estructurado por regla y alcance: 1455 warnings baseline controlados (1258 `any`: 621 api/src, 501 api/test, 49 admin, 55 staff, 10 scripts, 22 otros; 16 `react-hooks/exhaustive-deps`: 6 admin, 10 staff; 178 unused-vars). `tsc --noEmit` en los 4 workspaces con 0 errores de tipado. |
| **P4 / C05** | Revisión independiente del diff completo | P1–P3 | Revisor Independiente (subagente) | `APPROVED` | Revisión independiente ejecutada por subagente sobre el diff completo vs base `834b0d5` y `origin/main`. Dictamen formal: **APROBADO**. Confirmada estanqueidad de seguridad, estabilidad de foco accesible, integridad de tipos, ausencia de hacks destructivos y cumplimiento de restricciones. |
| **C06** | Cierre honesto, gates finales y documentación | P4 | AntiGravity | `COMPLETED_LOCALLY` | Verificaciones ejecutadas: `build:shared` (exit 0), `tsc` 4 workspaces (exit 0), `check:routes` (exit 0), `check:supabase-schema` (exit 0), `instance:test` (exit 0), `fauno:catalog:test` (exit 0), `npm run build` 6/6 workspaces (exit 0), `git diff --check` (exit 0). Committeado localmente en `codex/remediacion-auditoria-20260921`. Cero push a remotos, cero merge a `main`. |

---

## Pendientes externos (PENDING_HUMAN / PENDING_CLOUD)

1. **Pruebas en navegador con backend en vivo (opcional)**: Validación manual de interacciones táctiles en dispositivos físicos con escaneo NFC real.
2. **Tests serverless con PostgreSQL real**: `serverless-smoke.test.ts` skipped porque requiere conexión a base de datos externa real.
3. **Merge a main**: Decisión exclusiva del usuario/propietario del proyecto.
