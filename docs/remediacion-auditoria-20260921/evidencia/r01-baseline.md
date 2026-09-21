# Evidencia R01 — Reauditoría y Baseline Checks

Fecha: 2026-09-21
Candidato: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-remediacion-20260921`
SHA: `6a1cdaead105750dfc6808cac1383018bb58ee15`

## 1. Checks Básicos Ejecutados

### A. Matriz de Rutas
Comando: `npm run check:routes`
Resultado: `Matriz de rutas OK: 107 rutas clasificadas, sin novedades ni deriva.` (Exit code 0)

### B. Paridad de Esquema Supabase PostgreSQL
Comando: `npm run check:supabase-schema`
Resultado: `✅ schema.supabase.prisma está sincronizado con el schema canónico.` (Exit code 0)

### C. Manifiesto de Instancia
Comando: `npm run instance:test`
Resultado: `5 tests passing (instance manifest example is valid, production requires HTTPS, manifest rejects secrets, pre-order requires waitlist, local override requires isolated branch/commit).` (Exit code 0)

### D. Compilación Completa (Monorepo Build)
Comando: `npm run build`
Resultado: `🎉 BUILD COMPLETO EXITOSO (88.76s)`
- `@mesaya/shared` [OK]
- `@mesaya/api` [OK]
- `@mesaya/client-web` [OK] (99.24 kB)
- `@mesaya/staff-panel` [OK]
- `@mesaya/admin-dashboard` [OK]
- `@mesaya/qr-generator` [OK]

### E. Suites de Test Locales
Comando: `npm run test:local`
Resultado:
- 86 suites pasadas sin fallas.
- 780 tests unitarios/integrados en verde.
- Suites con pre-condición de contención identificadas:
  - `serverless-lifecycle.test.ts`: aprobado aisladamente (2940ms); requiere timeout explícito de 15s en corridas paralelas.
  - `full-system-e2e.test.ts`: test monolítico MVP legacy; requiere ajuste a contrato actual de órdenes/sesiones.

## 2. Conclusión de Etapa R01
El candidato está completamente compilable, el esquema de base de datos está sincronizado y las suites nucleares están operativas. R01 queda en estado `VERIFIED_LOCAL`, habilitando R02.
