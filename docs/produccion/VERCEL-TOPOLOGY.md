# Topología de Despliegue en Vercel — MesaYA (P0-09 / GATE-E09)

Fecha: 2026-09-13
Versión: 2.0.0

> **HISTÓRICO:** este documento describe un snapshot anterior y conserva su rama original como evidencia. La fuente actual es [`deploy/mesaya-canonical-manifest.json`](../../deploy/mesaya-canonical-manifest.json), que fija `codex/servicio-remediacion` para MesaYA completo y `codex/solo-mozos` para el workflow reducido.

Rama canónica de este snapshot: `release/pilot-1day-v1.0.0`

## 1. Inventario Exacto de los 4 Proyectos Canónicos

MesaYA opera mediante 4 proyectos independientes desplegados en Vercel, vinculados al mismo monorepo:

| # | Proyecto Vercel | Directorio Raíz (`Root Directory`) | Framework Preset | Build Command | Output Directory | Variables Clave |
|:---:|---|---|---|---|---|---|
| 1 | **mesaya-api** | `.` (Root) | Other / Serverless | `npm run build --workspace=@mesaya/shared && npm run generate:postgres --workspace=@mesaya/api` | `.` | `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `INSTANCE_MODE` |
| 2 | **mesaya-client-web** | `apps/client-web` | Vite | `npm run build` | `dist` | `VITE_API_URL`, `VITE_RESTAURANT_SLUG` |
| 3 | **mesaya-staff-panel** | `apps/staff-panel` | Vite | `npm run build` | `dist` | `VITE_API_URL`, `VITE_RESTAURANT_SLUG` |
| 4 | **mesaya-admin-dashboard** | `apps/admin-dashboard` | Vite | `npm run build` | `dist` | `VITE_API_URL`, `VITE_CLIENT_WEB_URL` |

## 2. Reglas de Enrutamiento y SPA
- Cada frontend cuenta con su respectivo `vercel.json` con reescritura canónica SPA:
  `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- La API serverless en raíz cuenta con `vercel.json` enrutando `/v1/*` y `/health` a `/api/index.ts` e incluyendo los archivos distribuidos de `@mesaya/shared`.

## 3. Estado de Proyectos Huérfanos
- No existen proyectos adicionales ni duplicados en el cluster.
- Todo commit en `release/pilot-1day-v1.0.0` dispara builds atómicos y coordinados en los 4 targets.
