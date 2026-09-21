# E11 — Base reutilizable e instalación por local

Estado: `PASS_LOCAL / PENDING_CLOUD`

Fecha: 2026-09-21
Base: `codex/plan-modulos-20260920` sobre `6a1cdae`

## Decisión de arquitectura

Se conserva un único núcleo MesaYA con aislamiento por instalación. La personalización vive en datos del restaurante, configuración modular y un manifiesto de provisión; no se crea un SaaS nuevo ni se elimina masivamente el selector de templates.

El modo de instancia queda limitado por `MESAYA_INSTANCE_MODE` y `MESAYA_INSTANCE_RESTAURANT_ID`. En `SINGLE_RESTAURANT`, las rutas públicas, autenticadas y de sesión sólo pueden resolver el restaurante configurado. Los secretos no forman parte del manifiesto ni de los cuatro builds.

## Inventario reutilizable

- Base y contratos: `packages/shared`, `packages/api/prisma/schema*.prisma`.
- Marca/contenido por local: `Restaurant.name`, `slug`, `logoUrl`, `coverImageUrl`, `themeColor`, `templateId`, `customFont`, más `RestaurantModuleConfig` y su auditoría.
- Manifiesto seguro: `deploy/instance.example.json`, `scripts/instance-manifest.mjs`, `scripts/validate-instance-manifest.mjs`.
- Provisión declarativa: `scripts/provision-instance-plan.mjs`; produce `PLAN_ONLY`, no crea Supabase/Vercel ni imprime secretos.
- Bootstrap idempotente: `scripts/bootstrap-restaurant.ts`; exige PIN explícito, conserva el PIN existente salvo `--rotate-pin`, crea mesas sólo para un restaurante nuevo y no abre turnos.
- Destinos de publicación: proyectos separados `api`, `client`, `staff`, `admin`, con `CORS_ORIGIN`, `MESAYA_INSTANCE_MODE` y `MESAYA_INSTANCE_RESTAURANT_ID` por instalación.
- QR/NFC: el Admin genera QR localmente usando `VITE_CLIENT_WEB_URL`; la impresión física queda fuera del cierre local.

## Protecciones agregadas/verificadas

- El manifiesto exige nombre, slug, zona horaria, moneda, cuatro dominios, módulos booleanos, release, schema, cuatro proyectos Vercel y modo de personalización.
- Producción exige HTTPS; `LOCAL_OVERRIDE` exige branch y commit aislados.
- Se rechazan claves/nombres y valores que parezcan secretos, URLs de base de datos o tokens.
- `preOrder` exige `waitlist`.
- Se agregó una invariante que impide que el manifiesto base transporte `Fauno`, `Olavarría` o dominios Fauno por accidente.
- Los valores `templateId` persistidos siguen siendo compatibles; no se ejecuta ninguna eliminación masiva de templates.

## Evidencia local

| Gate | Resultado |
|---|---:|
| `npm run instance:test` | 6/6 |
| `npm run instance:validate -- --production` | manifiesto válido; secretos ausentes |
| `npm run instance:provision:plan` | `PLAN_ONLY`, `remoteMutationPerformed=false` |
| `npm run fauno:catalog:test` | 5/5 |
| `node scripts/test-local.mjs instance-mode-auth.test.ts environment-security.test.ts postgres-schema-parity.test.ts client-build-assets.test.ts` | 4 archivos, 16/16 |
| `npm run build` | 6/6 workspaces |

El plan de provisión declara explícitamente que la base, el vault, Vercel, dominios, migraciones, backups y el QR físico requieren acciones externas autorizadas; ninguna se ejecutó en esta etapa.

## Pendientes

- `PENDING_CLOUD`: crear/confirmar Supabase y cuatro proyectos Vercel aislados, aplicar migraciones con `prisma migrate deploy`, configurar secretos en el almacén correspondiente, verificar CORS/aliases y documentar backup/restore.
- `PENDING_HUMAN`: decidir marca, catálogo inicial, assets, dominios, módulos y política por local; probar en teléfono el QR generado desde Admin antes de imprimir.

No se hicieron commits, push, despliegues ni mutaciones remotas.
