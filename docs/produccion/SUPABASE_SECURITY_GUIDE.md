# Guía de Hardening de Supabase PostgreSQL — MesaYA (F03)

Fecha: 2026-09-05.  
Alcance: Configuración de permisos, Data API y PostgreSQL en Supabase.

---

## 1. Diagnóstico del Riesgo (F03)

MesaYA implementa su control de acceso, autenticación de mozos y comensales y aislamiento multi-tenant exclusivamente en la capa de aplicación Node.js/Fastify con Prisma ORM (`where: { restaurantId }`).

Las migraciones canónicas de PostgreSQL generan las tablas en el esquema `public` sin políticas RLS ni revocación explícita de privilegios para los roles predeterminados de Supabase (`anon`, `authenticated`).

Si la **Data API (PostgREST)** de Supabase permanece activa en el proyecto cloud y expone el esquema `public`, cualquier usuario con la clave pública `anon` de Supabase podría eludir el backend Fastify y ejecutar lecturas o escrituras directas contra las tablas de la base de datos vía HTTP REST (`/rest/v1/...`).

---

## 2. Medidas de Mitigación Obligatorias

### Medida A: Deshabilitar Data API (Recomendada para MesaYA)

Dado que MesaYA no utiliza Supabase Auth, ni Supabase Client JS en los frontends, **no hay ninguna necesidad de exponer la Data API por HTTP**.

1. Ingresar al Dashboard de Supabase: `https://supabase.com/dashboard/project/<project-ref>`.
2. Ir a **Project Settings** -> **API**.
3. En la sección **Data API**, desactivar el toggle **Enable Data API**.
4. Confirmar que las peticiones a `https://<project-ref>.supabase.co/rest/v1/` respondan con `404` o `401/403 Disabled`.

---

### Medida B: Revocación Explícita de Permisos para el Rol `anon` (Defensa en Profundidad)

Ejecutar en el **SQL Editor** de Supabase para asegurar que el rol anónimo no posea ningún privilegio de acceso sobre las tablas del producto:

```sql
-- 1. Revocar permisos de lectura y escritura al rol anónimo de Supabase
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

-- 2. Asegurar que futuras tablas creadas por Prisma no hereden grants a anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;
```

---

### Medida C: Activación de Row Level Security (RLS) Preventivo

Como barrera adicional, habilitar RLS en todas las tablas de MesaYA. Al activar RLS sin políticas permisivas (`CREATE POLICY`), PostgreSQL bloquea por defecto cualquier consulta que no provenga de un rol superusuario o bypass (como el rol de servicio `postgres` utilizado por Fastify/Prisma en el Transaction Pooler):

```sql
ALTER TABLE IF EXISTS "Restaurant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "StaffUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Table" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "TableSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "CallRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "MenuCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "MenuItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ModuleConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "RateLimitBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "FloorPlanSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Feedback" ENABLE ROW LEVEL SECURITY;
```

---

## 3. Verificación de Seguridad

Para verificar que el acceso directo esté efectivamente sellado:

```bash
# Probar con curl usando la anon key pública
curl -i "https://<project-ref>.supabase.co/rest/v1/Restaurant" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
```

**Resultado esperado:**
- Con Data API deshabilitada: `404 Not Found` o rechazo de conexión.
- Con grants revocados o RLS activo: `[]` (cero filas) o `401/403 Permission Denied`.
- **Jamás** debe devolver el listado de restaurantes ni datos de comensales o personal.

---

## 4. Anexo etapa 02 (2026-09-05) — inventario real y cierre antes de cargar datos

Estado: NEEDS_REVIEW. Nada de lo siguiente afirma que la infraestructura
remota ya fue configurada: es la lista de verificación previa obligatoria
antes de cargar cualquier dato real. Codex verifica de forma independiente.

### 4.1 Inventario real de modelos (fuente: `packages/api/prisma/schema.prisma`)

Tablas del producto que existen en el esquema canónico y deben quedar fuera
del alcance de la Data API pública:

`Restaurant`, `RestaurantModuleConfig`, `RestaurantPaymentCredentials`,
`RestaurantModuleConfigAudit`, `MenuCategory`, `MenuItem`, `Table`,
`TableSession`, `Shift`, `CallRequest`, `RateLimitBucket`, `Order`,
`OrderItem`, `SplitBillSession`, `PaymentTransaction`, `WaitlistEntry`,
`CustomerLoyalty`, `RewardItem`, `RewardRedemption`, `StaffUser`,
`Feedback`, `Subscription`, `FloorZone`, `FloorPlanLayout`,
`TableStateEvent`, `OccupancySession`.

Sensibles (credenciales/secretos o dinero): `RestaurantPaymentCredentials`
(tokens cifrados de Mercado Pago), `StaffUser` (`pinHash`), `Order` /
`OrderItem` / `SplitBillSession` / `PaymentTransaction` (consumo y cobros),
`CustomerLoyalty` (teléfonos E.164), `WaitlistEntry` (nombres y teléfonos).

La lista de RLS de la sección 2 (`Medida C`) no cubre los modelos
agregados después (`RestaurantPaymentCredentials`,
`RestaurantModuleConfigAudit`, `SplitBillSession`, `PaymentTransaction`,
`CustomerLoyalty`, `RewardItem`, `RewardRedemption`, `Subscription`,
`FloorZone`, `FloorPlanLayout`, `TableStateEvent`, `OccupancySession`):
antes de cargar datos, extender `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
y la revocación a TODAS las tablas del inventario 4.1. Pendiente operativo
para Codex, no resuelto por esta entrega de código.

### 4.2 Cierre de Data API antes de cargar datos (orden obligatorio)

1. Deshabilitar la Data API (Medida A) y confirmar `404`/rechazo en
   `/rest/v1/` con la `anon key`.
2. Revocar grants de `anon`/`authenticated` sobre todas las tablas,
   secuencias y rutinas del esquema expuesto (Medida B extendida al
   inventario 4.1), incluyendo `ALTER DEFAULT PRIVILEGES` para tablas
   futuras creadas por Prisma.
3. Habilitar RLS en todas las tablas del inventario 4.1 sin políticas
   permisivas (Medida C extendida).
4. Recién entonces cargar datos reales. Cargar datos con la Data API
   abierta expone el contenido a cualquiera con la `anon key`.

### 4.3 Límites reales conocidos (no afirman configuración remota)

- Vercel Functions (Hobby): timeout de ejecución breve (~10–60 s según
  plan), payload de request ~4,5 MB, respuesta recomendada < 6 MB. El
  handler `api/index.ts` reutiliza una sola app (cold start) y siempre
  termina la respuesta (500 JSON si falla el arranque).
- Supabase: Transaction Pooler recomendado para serverless; `DIRECT_URL`
  sólo para migraciones. Sin RLS/grants cerrados, la `anon key` es pública
  por diseño y no debe considerarse secreto.
- Rate limit de la app (punto inicial, no garantía total): login
  Admin/Staff 25 intentos/5 min por tenant+IP; alta pública 3/10 min por IP.

### 4.4 Variables necesarias (nombres, sin valores)

Producción exige: `JWT_SECRET` y `ENCRYPTION_SECRET_KEY` (distintos,
≥ 32 caracteres, sin valores conocidos), `CORS_ORIGIN` (lista explícita
HTTPS sin `*`, sin localhost), `DATABASE_URL` (pooler),
`PILOT_PUBLIC_ONBOARDING_ENABLED` (`true` sólo si el piloto lo requiere),
`MESAYA_PUBLIC_URL` (HTTPS pública para QR; sin ella el QR prod falla
cerrado). `VERCEL=1` la fija la plataforma; habilita la lectura estricta
de `x-vercel-forwarded-for` para rate limit.

### 4.5 Rollback

- Código: revertir el commit de esta etapa; los contratos de etapa 01
  (paths y códigos 400/401/403/404/429, CORS exacto) se conservan.
- Datos: no hay migración en esta etapa (cambio aditivo cero); nada que
  revertir en DB.
- Supabase: si el cierre de Data API rompe algún consumidor legítimo,
  re-habilitar la Data API es el rollback, pero reabre la superficie F03:
  hacerlo sólo con RLS + grants ya cerrados y registrar el motivo.
