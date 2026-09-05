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
