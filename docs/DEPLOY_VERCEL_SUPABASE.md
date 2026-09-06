# Guía de Despliegue en Producción: Supabase + Vercel

> **Actualización 2026-09-05:** consultar primero la [revisión cloud del commit publicado](produccion/REVISION-CLOUD-2026-09-05/README.md) y la [puesta en servicio corregida](produccion/REVISION-CLOUD-2026-09-05/02-PUESTA-EN-SERVICIO.md). Hay cambios de código pendientes en login/credenciales y dependencias. La guía corregida precisa `VITE_CLIENT_WEB_URL`, generación Prisma para bootstrap, conexión session frente a directa, región y pruebas del artefacto Vercel. Este documento se conserva como referencia previa, no como declaración de readiness.

> Esta guía describe una preparación técnica; **no autoriza** un despliegue, una migración sobre datos reales, seed, cobro ni operación externa. Antes de cualquier acción de ese tipo rigen el GO/NO-GO y el bloqueo de backup/restauración de [`RUNBOOK_PILOTO.md`](RUNBOOK_PILOTO.md).

Esta guía detalla paso a paso cómo conectar **MesaYA** a tu proyecto de **Supabase (PostgreSQL)** y desplegarlo en **Vercel** para tus primeros locales y clientes reales.

---

## 1. Configuración de Base de Datos en Supabase (2 minutos)

1. Ingresa a [supabase.com](https://supabase.com) y crea un nuevo proyecto (ej. `mesaya-mdp`).
2. Ve a **Project Settings** > **Database**.
3. En la sección **Connection parameters / Connection string**, obtén dos URLs:
   - **Transaction Pooler (Puerto 6543 / Modo Transaction)**: Usada para Vercel Serverless.
     ```
     DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[TU-CONTRASEÑA]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
     ```
   - **Direct Connection (Puerto 5432 / Modo Session)**: Usada por Prisma para ejecutar migraciones.
     ```
     DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[TU-CONTRASEÑA]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
     ```

### 2. Ejecutar Migraciones y Datos Iniciales (Seed)

En tu terminal local o entorno de CI:

```bash
# 1. Configura variables efímeras en el entorno de migración (no las guardes en el repo)
export MESAYA_PG_DATABASE_URL="tu_transaction_pooler_url"
export MESAYA_PG_DIRECT_URL="tu_direct_url"

# 2. Aplica únicamente el historial revisado con migrate deploy
npm --workspace=@mesaya/api run prisma:postgres:migrate

# 3. El seed de producción requiere una decisión y autorización separadas
# npm --workspace=@mesaya/api run prisma:seed
```

`prisma:postgres:migrate` no toma `DATABASE_URL` ni `DIRECT_URL` como fallback: exige las variables
`MESAYA_PG_DATABASE_URL` y `MESAYA_PG_DIRECT_URL`, valida el schema PostgreSQL derivado y ejecuta
`migrate deploy` sobre un runtime temporal con `migrations-postgres`. Nunca uses `db push` ni `migrate dev`
contra una base existente.

### Estrategia para una base existente

Antes de cualquier aplicación sobre Supabase real se debe: (1) inventariar tablas, columnas, índices,
constraints y extensiones; (2) obtener y verificar un backup restaurable; (3) generar un baseline/diff
contra `schema.supabase.prisma`; (4) revisar el SQL y el plan de rollback; y (5) obtener aprobación
explícita del responsable. Esta etapa no ejecuta ni automatiza una migración inicial sobre datos reales.

---

## 2. Despliegue en Vercel (Monorepo o Apps Separadas)

Puedes desplegar todo el monorepo en Vercel o cada app de forma individual:

### Opción A: Despliegue de la API Serverless (Backend)

1. En [vercel.com](https://vercel.com), crea un nuevo proyecto e importa el repositorio `mdpmesasvivas`.
2. Configuración del proyecto API en Vercel:
   - **Root Directory**: raíz del repositorio.
   - **Build Command**: automático vía `npm run vercel-build` (Vercel lo detecta si existe), que ejecuta `node scripts/build-pg.mjs`: genera el cliente Prisma desde `schema.supabase.prisma` (provider `postgresql`) y compila `@mesaya/shared` + `@mesaya/api`. No usa el cliente SQLite de desarrollo.
   - **Output**: función serverless `api/index.ts` (rutas `/v1/*` y `/health` por `vercel.json`).
3. En **Environment Variables**, agrega (nombres; los valores viven sólo en Vercel/Supabase, nunca en el repo):

| Variable | Alcance | Uso |
|---|---|---|
| `DATABASE_URL` | Production (API) | Pooler Supabase 6543 con `?pgbouncer=true` para serverless. |
| `DIRECT_URL` | Sólo contexto de migración | Conexión directa 5432. No la necesita el runtime serverless. |
| `JWT_SECRET` | Production (API) | ≥32 caracteres, distinto de `ENCRYPTION_SECRET_KEY`. |
| `ENCRYPTION_SECRET_KEY` | Production (API) | ≥32 caracteres, distinto de `JWT_SECRET`. |
| `CORS_ORIGIN` | Production (API) | Lista explícita de orígenes HTTPS de los frontends. `"*"` está prohibido por código. |
| `NODE_ENV` | Production (API) | `production` (activa validación estricta de secretos y CORS). |
| `VITE_API_URL` | Frontends | URL pública de la API (`https://<api>/v1`). |

4. CORS es propiedad exclusiva de la API (`CORS_ORIGIN` explícito, `credentials: true`). `vercel.json` no define cabeceras CORS: la combinación `Access-Control-Allow-Origin: *` + credenciales es contradictoria y los navegadores la rechazan.
5. Vercel detectará automáticamente `vercel.json` y la ruta `/api/index.ts` que expone Fastify serverless en `/v1/*` y `/health`.

### Opción A-bis: Preview vs Release (separación obligatoria)

- **Preview/CI**: sólo compilan y prueban. El workflow `ci.yml` ejecuta instalación limpia (`npm ci`), build, paridad, matriz de rutas y tests; el job `postgres` usa PostgreSQL efímero del propio CI. Ningún job de preview/CI ejecuta seed, `db push`, `migrate dev` ni migraciones contra bases reales.
- **Release de migración**: exclusivamente el workflow manual `release-migrate.yml` (`workflow_dispatch`, entorno `production` con aprobadores), que aplica el historial revisado con `migrate deploy`. Ver sección 1 (puntos 2–3) para el procedimiento local equivalente.
- **Seed**: requiere decisión y autorización separadas; jamás corre en CI ni en preview.

### Opción B: Despliegue de los Frontends en Vercel

Crea proyectos en Vercel apuntando a las subcarpetas del monorepo:

| App | Root Directory en Vercel | Framework Preset | Output Directory |
|---|---|---|---|
| **Comensal (Client Web)** | `apps/client-web` | Vite / HTML | `dist` |
| **Panel Mozo (Staff PWA)** | `apps/staff-panel` | Vite | `dist` |
| **Dashboard Encargado** | `apps/admin-dashboard` | Vite | `dist` |

---

## 3. Resumen de Seguridad Anti-Llamados Fantasma

1. **Invalidación de Mesa por el Mozo**: Cuando el cliente se retira y el mozo presiona `"Mesa se retiró (Cerrar sesión e invalidar QR)"`, el token queda revocado de inmediato en Supabase (`closedAt != null`). Cualquier llamado posterior desde ese link retorna `410 Gone`.
2. **Geofencing Just-in-Time**: Al presionar *"Llamar al mozo"* o *"Pedir cuenta"*, el dispositivo envía sus coordenadas GPS al backend. Si el cliente está fuera del radio del restaurante (ej. >200m), el servidor bloquea la solicitud.
3. **Resiliencia de cliente**: Staff y Admin usan polling HTTP autenticado, con cancelación, backoff y reconexión al recuperar red/foco. No se promete entrega instantánea ni existe SSE distribuido; el operador debe vigilar la edad del snapshot y el indicador de conexión.

---

## 4. Funcionalidades incompletas apagadas en piloto y secretos

En producción del piloto todo lo incompleto permanece apagado por código/configuración, sin intervención manual:

- Pagos digitales y división de cuenta: `503 DIGITAL_PAYMENTS_UNAVAILABLE` (`POST /v1/orders/items/claim`, `/v1/orders/:id/split-session`, `/v1/orders/split-session/:id/pay-part`).
- SSE `/stream`: `410 SSE_STREAM_DISABLED`; transporte autoritativo por polling autenticado.
- Alta pública de restaurantes: `403 PUBLIC_ONBOARDING_DISABLED` salvo `PILOT_PUBLIC_ONBOARDING_ENABLED=true` (no definir en producción del piloto).
- IA con contención: sin fallbacks engañosos; requiere `GEMINI_API_KEY` o `GOOGLE_API_KEY` sólo donde esté habilitada (`ENABLE_AI_FEATURES=true`).
- `ALLOW_LEGACY_DEMO_ROUTES` es sólo para tests (`NODE_ENV=test`): no definir en ningún entorno real.

Higiene de secretos: los valores viven únicamente en Vercel/Supabase o en el entorno local del operador al migrar (`MESAYA_PG_DATABASE_URL`, `MESAYA_PG_DIRECT_URL`); el repo sólo versiona nombres y placeholders (ver `.env.example`). Los logs de CI no imprimen variables; `test-postgres.mjs` y los reportes usan URLs sintéticas.
