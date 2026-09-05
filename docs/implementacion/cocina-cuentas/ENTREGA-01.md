# ENTREGA-01 (rev.3) — Etapa 01: Login Admin/Staff, bootstrap, PIN, QR/CORS, validación y rate limit

Estado: NEEDS_REVIEW
Fecha: 2026-09-05
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 01) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Feedback aplicado: Revisión Codex de etapa 01 — CHANGES_REQUESTED (rev. 2, 6 puntos). No se avanza a etapa 02.

## Archivos cambiados (rev.3, sólo puntos Codex rev.2)
- `packages/api/src/services/abuse-control.service.ts` — `LOGIN_BY_IP_TENANT` pasa a `{ limit: 25, windowSeconds: 300 }` (25 intentos por 5 min). Clave canónica por restaurante e IP y `Retry-After` intactas. Comentario: 25 es punto inicial, no protección completa ante PIN corto; control complementario queda para etapa de datos.
- `scripts/bootstrap-restaurant.ts` — C02 estricta: `--pin` o `BOOTSTRAP_MANAGER_PIN` exigidos en TODA ejecución (formato `/^\d{4,6}$/` exacto, sin trim/default); sin PIN válido sale código 1 antes de cualquier DB aunque ya existan. Si existe y no hay `--rotate-pin`: valida formato pero NO calcula bcrypt ni sobrescribe `pinHash` (conservada). Con `--rotate-pin`: rota (bcrypt+update). Nunca imprime el PIN (`buildBootstrapSummary` fijo, sin secreto). Refactor testable sin efectos al importar: `resolveBootstrapOptions`/`assertBootstrapPin`/`classifyBootstrapCredential`/`shouldHashBootstrapCredential`/`buildBootstrapSummary` exportados; `PrismaClient`/bcrypt con importación diferida dentro de `main()`; `main()` sólo corre en ejecución directa (`isDirectRun` + guardia `VITEST_WORKER_ID`).
- `apps/admin-dashboard/src/App.tsx` — contrato exacto C05: `VITE_PILOT_PUBLIC_ONBOARDING_ENABLED === 'true'` (se elimina el nombre alternativo `VITE_PUBLIC_ONBOARDING_ENABLED`). `AdminLoginModal` permite escribir el slug manualmente cuando la lista pública está vacía o falla (input + ayuda), en vez de bloquearse sin selector.
- `apps/admin-dashboard/src/lib/api.ts` — errores 403/401 muestran el `message` descriptivo de la API (`message || error || fallback`) en `requireAuthorized`/`registerRestaurant`/`loginAdmin`, en vez de sólo `FORBIDDEN`/genérico. Se mantiene `logout()` en 401/403 para forzar reautenticación.
- `hardware/qr-generator/generate.ts` — `generateTableQR` exportada; `qrcode` con importación diferida (importar para `resolveBaseUrl` no exige el paquete); `main()` sólo en ejecución directa con guardia `VITEST_WORKER_ID`. Sin cambios de contrato: prod exige URL HTTPS pública, sin fallback silencioso.
- `scripts/sync_supabase_schema.js` — `--check` compara contenido normalizado (`normalizeLineEndings`: CRLF/CR→LF); copia limpia en Windows pasa; diferencia semántica real sigue fallando con líneas útiles (`diffSchemas`). Sin reescritura en modo check. Módulo exporta `normalizeLineEndings`/`buildPostgresSchema`/`diffSchemas`/`runCheck`/`runSync`; ejecución sólo bajo `require.main === module`.
- `packages/api/test/cocina-cuentas-etapa-01.test.ts` — mocks actualizados a 25/300 (`remaining: 24`); test de rate limit afirma clave canónica `login:tenant:<id>:ip:<ip>`, política 25/300 y `Retry-After`; nuevos gates: bootstrap (PIN omitido/inválido, conservación sin hash, rotación explícita, ausencia de PIN en salida) y QR (prod sin URL / no-HTTPS falla, HTTPS exacta resuelve, `generateTableQR` sin `baseUrl` falla) + normalización CRLF del sync. Total 13 casos (9 previos + 4 nuevos).
- Se conserva lo ya correcto (rev.2): validación PIN 4–6 antes de DB/bcrypt sin trim; rechazo wildcard CORS; bloqueo QR prod; sin accesos demo; reautenticación al cambiar tenant; rechazo 409 secuencial (sin presentar duplicado concurrente como resuelto).

## Decisiones
- Contratos/APIs intactos salvo lo expreso: mismos paths y códigos 400/401/403/404/429; `route-matrix.json` sin cambios.
- Unicidad concurrente de PIN: sigue sólo rechazo secuencial; digest/constraint resistente a filtración offline queda para etapa 03 con migración aditiva (no se improvisa SHA simple).
- Register conserva política propia `REGISTER_RESTAURANT_BY_IP` 3/10 min con bucket consumido sólo tras validación barata.
- QR: prohibido generar QR incorrecto con banner; en prod la ausencia de URL es error bloqueante.
- `requireAuthorized` ahora propaga el `message` de la API en 401/403 (manteniendo logout): la UI muestra causa descriptiva y el flujo de expiración→re-login sigue por token ausente.

## Pruebas agregadas (NO ejecutadas — sin shell en este entorno)
- `packages/api/test/cocina-cuentas-etapa-01.test.ts` (13 casos, mocks aislados, sin `.env`/DB). Cobertura nueva: PIN omitido/inválido antes de DB; conservar sin `--rotate-pin` (cero hashes) vs rotar explícito; resumen sin PIN; QR prod sin URL / HTTP / localhost-HTTPS fallan y HTTPS exacta resuelve; CRLF≈LF pero semántica difiere→falla con línea útil.
- Codex debe correr: suite etapa-01 + `environment-security`, `auth-policy`, `staff-access` + `postgres-schema-parity` (debe pasar tras normalización CRLF) + build completo. Este entorno no declara pruebas ejecutadas.

## Riesgos
- Importar `scripts/bootstrap-restaurant.ts` y `hardware/qr-generator/generate.ts` desde tests amplía superficie de resolución de Vitest fuera de `packages/api`; si el runner aísla por paquete, mover esos gates a un test de scripts o ajustar alias (pendiente menor, documentado para Codex).
- `VITE_PILOT_PUBLIC_ONBOARDING_ENABLED` es de build: cambiarla exige rebuild/redeploy del Admin.
- Admin exige re-login al cambiar de tenant (aislamiento intencional; fricción para operadores multi-local).
- Subir login a 25/5min se documenta como punto inicial, no como solución total ante PIN corto; el control complementario puede requerir persistencia nueva (etapa de datos).

## Pendientes reales
1. Verificación independiente por Codex (suite etapa-01 13/13, paridad de esquema en Windows, build completo, matriz de rutas). NEEDS_REVIEW hasta entonces.
2. Columna digest + constraint único anti-duplicado concurrente con diseño resistente a filtración (etapa 03, con prueba de carrera real PG/SQLite).
3. Control complementario de fallos por PIN corto más allá del bucket tenant/IP (etapa de datos si requiere persistencia nueva).
4. Rate limit de register: evaluar ventana/límite con datos de abuso del piloto (no cambiar sin evidencia).
