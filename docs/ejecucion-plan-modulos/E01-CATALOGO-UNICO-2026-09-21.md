# E01 — Una Carta Real para Todo el Sistema (Catálogo Único)

- **Fecha de ejecución:** 2026-09-21
- **Agente escritor:** Antigravity (único agente escritor en worktree local)
- **Worktree:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-plan-20260920`
- **Rama:** `codex/plan-modulos-20260920` (rastreada a `origin/main`)
- **HEAD SHA base:** `6a1cdaead105750dfc6808cac1383018bb58ee15`
- **Documento rector:** `docs/PLAN-MODULOS-Y-BASE-POR-LOCAL-2026-09-20.md`
- **Etapa previa:** `docs/ejecucion-plan-modulos/E00-BASE-Y-MATRIZ-2026-09-20.md` (VERIFICADO_LOCAL)
- **Estado de etapa E01:** `VERIFICADO_LOCAL` (Corregido tras veredicto `CHANGES_REQUIRED` y validado integralmente)

---

## 1. Resumen Ejecutivo y Resolución de Hallazgos

El objetivo de **E01** era convertir la base de datos relacional en la **fuente única y coherente** de la carta gastronómica para comensales, mozos, terminales de cocina, fila virtual / pre-pedido y sommelier/IA, eliminando el override estático (`STATIC_CATALOG_BY_RESTAURANT`) del flujo de comensales en mesa y garantizando una sincronización no destructiva del catálogo.

Tras la revisión independiente (`CHANGES_REQUIRED`), se implementaron todas las correcciones estructurales exigidas:

### 1.1. Resolución del BLOCKER: Identidad Externa Canónica y Persistente
1. **Contrato Compartido (`@mesaya/shared`):**
   - Se extendió `BatchMenuImportItem` con el campo `externalId?: string` para identidad estable de los platos, manteniendo `source?: string` exclusivamente para procedencia/origen humano.
   - Se tipó `isAvailable?: boolean` y la respuesta enriquecida `BatchMenuImportResponseDTO` con desglose auditable (`summary`).
2. **Modelo y Esquema Relacional (`schema.prisma` y `schema.supabase.prisma`):**
   - Se añadió el campo `catalogKey String? @unique` al modelo `MenuItem`.
   - Formato canónico de la clave: `${restaurantId}:${source}:${externalId}` (en minúsculas normalizadas), garantizando aislamiento estricto por tenant y unicidad de catálogo.
   - Sincronización exacta verificada con `node scripts/sync_supabase_schema.js --check`.
3. **Migración PostgreSQL No Destructiva:**
   - Creada en `packages/api/prisma/migrations-postgres/20260921000000_e01_menu_item_catalog_key/migration.sql`.
   - Utiliza `ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "catalogKey" TEXT;` y `CREATE UNIQUE INDEX IF NOT EXISTS "MenuItem_catalogKey_key" ON "MenuItem"("catalogKey");`.
   - Cero operaciones destructivas (cero `DROP TABLE`, cero `DROP COLUMN`).

### 1.2. Resolución de Identidad y Reglas de Conciliación (`MenuImportService`)
- **Jerarquía Canónica:**
  1. **Prioridad 1 (`catalogKey` / `externalId`):** Si el plato provisto contiene `externalId`, se calcula su `catalogKey` y se busca match inequívoco. **Renombrar un plato conservando su `externalId` preserva el `MenuItem.id` existente** en base de datos sin crear duplicados ni romper referencias.
  2. **Prioridad 2 (Fallback por categoría + nombre normalizado):** Para registros históricos sin `catalogKey`. Al encontrar match unívoco por nombre, se actualizan datos y se realiza **backfill automático** de la `catalogKey`.
  3. **Detección de Conflictos Temprana:** Si dos platos del payload comparten el mismo `externalId`, o colisionan con ítems de distinta identidad, o generan ambigüedad, el servicio rechaza todo el lote con código HTTP 400 (`MenuImportError`) antes de abrir transacciones o tocar la base de datos.
  4. **CERO Hard-Deletes:** Bajo `replaceExisting: true`, los platos preexistentes que no vienen en el nuevo catálogo se desactivan lógicamente (`isAvailable: false`). Las categorías históricas se preservan para no romper `OrderItem`.
  5. **Modo Simulación (`dryRun: true`):** Proyecta con total fidelidad el resultado de creaciones, actualizaciones y desactivaciones sin mutar la base de datos.

### 1.3. Resolución de P1: Evidencia de Compilación y Typecheck Local
- Se ejecutó `npm ci` en el worktree (296 paquetes instalados).
- Se corrieron y validaron todos los gates de verificación y build del monorepo:
  - `npm run prisma:generate` → Generación exitosa de Prisma Client v5.22.0.
  - `npm run check:routes` → 107 rutas HTTP analizadas mediante AST de TypeScript; 0 deriva de autenticación.
  - `npm run check:supabase-schema` → Paridad 100% canónica SQLite/PostgreSQL.
  - `npm run build:shared` → Compilación limpia con `tsc`.
  - `npm run build:api` → Compilación limpia con `prisma generate && tsc`.
  - `npm run build` → Build completo del monorepo exitoso (EXIT_CODE=0, 53.41s).
- *Nota de tooling:* La ausencia de un alias `npm run typecheck` en la raíz se documenta como mejora de tooling futuro; los comandos `build:shared`, `build:api` y el build raíz ejecutan formalmente el chequeo estricto de tipos con `tsc` en todos los workspaces.

### 1.4. Resolución de P2 y P3: Categorías Vacías e Inactivas en la Carta Operativa
- **Hallazgo P2 Resuelto:** En `packages/api/src/routes/menu.routes.ts` (`GET /restaurants/:slugOrId/menu`), el filtro original omitía categorías con `cat.items.some(item => item.isAvailable)`. Esto provocaba que categorías con únicamente productos en prelanzamiento `COMING_SOON` (`isAvailable: false`) desaparecieran, contradiciendo el requisito de negocio de que los adelantos sigan visibles para el comensal aunque no sean ordenables.
- **Predicado Corregido:** Cuando `includeEmpty` no sea `true`, una categoría se conserva si tiene al menos un plato con `isAvailable === true` O al menos un plato cuya etiqueta incluya `'COMING_SOON'` (`cat.items.some((item) => item.isAvailable || (Array.isArray(item.tags) && item.tags.includes('COMING_SOON')))`).
- **Exclusión de Inactivos Normales:** Las categorías compuestas exclusivamente por platos inactivos corrientes (retirados o sin stock) y las categorías vacías continúan ocultándose de la carta operativa por defecto.
- **Parámetro `includeEmpty=true`:** Si el cliente o administrador solicita explícitamente `includeEmpty=true`, se devuelven todas las categorías históricas sin filtrado.

### 1.5. Catálogo Canónico Fauno Olavarría y Scripts
- Fuente canónica inmutable: `apps/client-web/public/demo/fauno-olavarria/catalog.json` (26 categorías, 144 ítems).
- `scripts/import-fauno-catalog.mjs`: genera determinísticamente `externalId` único para cada uno de los 144 platos (`${slugify(category)}__${slugify(name)}`) y replica la resolución canónica en `simulateMenuSync`.
- `scripts/parse-fauno-catalog.mjs`: actualizado para incluir `externalId` en futuras exportaciones sin regenerar a ciegas el JSON actual.

---

## 2. Inventario de Archivos Modificados y Creados

| Archivo | Estado | Razón Técnica y Rol en E01 |
|---|---|---|
| `packages/shared/src/index.ts` | **Modificado** | Extensión de `BatchMenuImportDTO` con `dryRun?: boolean`, `BatchMenuImportItem` con `externalId?: string`, `isAvailable?: boolean`, `source?: string`, e incorporación de `BatchMenuImportResponseDTO`. |
| `packages/api/prisma/schema.prisma` | **Modificado** | Adición del campo `catalogKey String? @unique` en modelo `MenuItem`. |
| `packages/api/prisma/schema.supabase.prisma` | **Modificado** | Sincronización idéntica de `catalogKey String? @unique` para PostgreSQL. |
| `packages/api/prisma/migrations-postgres/20260921000000_e01_menu_item_catalog_key/migration.sql` | **Creado** | Migración SQL no destructiva para PostgreSQL/Supabase (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`). |
| `packages/api/src/services/menu-import.service.ts` | **Creado** | Servicio central de importación gastronómica con resolución por `catalogKey`, fallback con backfill, detección de conflictos, preservación de IDs en renombre, CERO hard-delete y dryRun. |
| `packages/api/src/routes/menu.routes.ts` | **Modificado** | Delegación de `POST /menu/import` a `MenuImportService`, y filtro de categorías vacías en `GET /menu` salvo `includeEmpty=true` (Finding P3). |
| `apps/client-web/app.js` | **Modificado** | Eliminación de `STATIC_CATALOG_BY_RESTAURANT`, carga directa de API en `loadDynamicMenu`, guarda `isSyntheticItemId` anti-comandas falsas y preservación de `initPublicMenuOnly` para demo sin sesión. |
| `scripts/import-fauno-catalog.mjs` | **Creado** | Generador de DTO con `externalId` estable (144/144 únicos) y `simulateMenuSync` alineado al algoritmo canónico. |
| `scripts/parse-fauno-catalog.mjs` | **Modificado** | Generación de `externalId` en exportaciones futuras. |
| `scripts/fauno-catalog.test.mjs` | **Modificado** | Validaciones de `externalId` en los 144 ítems e idempotencia de payload. |
| `scripts/e01-catalog-invariants.test.mjs` | **Creado** | Suite de 15 invariantes E01 (Fauno, cliente web, Prisma, IA/Waitlist, rename con mismo externalId preserva ID, rechazo por duplicados, migración SQL y filtro P3). |
| `packages/api/test/menu-import.test.ts` | **Creado** | 10 pruebas Vitest para `MenuImportService`, renombre, backfill, rechazo de conflictos y endpoint `GET /menu` con `includeEmpty`. |
| `docs/ejecucion-plan-modulos/E01-CATALOGO-UNICO-2026-09-21.md` | **Modificado** | Informe exhaustivo de certificación E01 con resultados empíricos y evidencia de compilación. |

---

## 3. Contratos de Datos y API

### 3.1. DTO de Importación (`BatchMenuImportDTO`)
```typescript
export interface BatchMenuImportItem {
  externalId?: string;       // Identidad externa estable (ej: 'cervezas__jammin-ipa')
  category: string;          // Categoría gastronómica
  categoryIcon?: string;     // Emoji o identificador de icono
  name: string;              // Nombre del plato
  description?: string;      // Descripción detallada
  price: number;             // Precio en unidades monetarias
  tags?: string[];           // Etiquetas (CHEF_PICK, GLUTEN_FREE, VEGETARIAN, COMING_SOON)
  imageUrl?: string;         // URL opcional de imagen
  isFeatured?: boolean;      // Destacado en carta
  isAvailable?: boolean;     // Disponibilidad operativa
  source?: string;           // Origen/provenance (ej: 'fauno-user-catalog-2026-09-20')
}

export interface BatchMenuImportDTO {
  replaceExisting?: boolean; // Default false. Si true, desactiva lógicamente ausentes
  dryRun?: boolean;          // Default false. Si true, simula sin mutar DB
  templateId?: MenuTemplateId;
  items: BatchMenuImportItem[];
}
```

### 3.2. Formato de `catalogKey`
```typescript
catalogKey = `${restaurantId}:${normSource}:${normExternalId}`;
// Ejemplo: 'fauno-olavarria:fauno-user-catalog-2026-09-20:cervezas__jammin-ipa'
```

---

## 4. Evidencia Empírica de Pruebas y Compilación

### 4.1. Gate de Rutas (`check:routes`)
```
npm run check:routes
> node scripts/check-route-matrix.mjs
Matriz de rutas OK: 107 rutas clasificadas, sin novedades ni deriva.
Exit code: 0
```

### 4.2. Generación de Cliente Prisma (`prisma:generate`)
```
npm run prisma:generate
> node ../../scripts/prisma-generate.mjs sqlite
Prisma schema loaded from packages\api\prisma\schema.prisma
✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 359ms
Exit code: 0
```

### 4.3. Sincronización de Esquema Supabase (`check:supabase-schema`)
```
npm run check:supabase-schema
> node scripts/sync_supabase_schema.js --check
✅ schema.supabase.prisma está sincronizado con el schema canónico.
Exit code: 0
```

### 4.4. Compilación del Monorepo (`npm run build`)
Ejecutado de forma secuencial y limpia en el worktree:
```
npm run build
Duración total: 53.41s
Exit code: 0

Desglose por workspace:
✓ @mesaya/shared           [OK] (1.42s)
✓ @mesaya/api              [OK] (10.16s) (Prisma Client + tsc)
✓ @mesaya/client-web       [OK] (5.96s)
✓ @mesaya/staff-panel      [OK] (21.29s)
✓ @mesaya/admin-dashboard  [OK] (13.16s)
✓ @mesaya/qr-generator     [OK] (1.42s)
```
*(Nota: Sólo se registraron warnings informativos de Rollup sobre anotaciones de comentarios de Zod en bundles de Vite; cero errores).*

### 4.5. Suites de Pruebas Unitarias y de Invariantes (`node --test`)
```
node --test scripts/fauno-catalog.test.mjs scripts/instance-manifest.test.mjs scripts/e01-catalog-invariants.test.mjs

✔ E01-1: Catálogo Fauno canónico contiene 26 categorías y 144 ítems válidos (3.45ms)
✔ E01-2: buildFaunoBatchMenuImportDTO genera un payload reproducible e idempotente (6.01ms)
✔ E01-3: Cliente web eliminó STATIC_CATALOG_BY_RESTAURANT del flujo de sesión (0.90ms)
✔ E01-4: Cliente web preserva modo carta pública explícito sin sesión (initPublicMenuOnly) (0.65ms)
✔ E01-5: Schema Prisma protege integridad histórica de OrderItem sin cascade delete (0.51ms)
✔ E01-6: Sommelier e IA excluyen isAvailable=false de sus recomendaciones (0.33ms)
✔ E01-7: Fila virtual / preOrder valida contra MenuItem existente e isAvailable=true (0.30ms)
✔ E01-8: Sincronización segura de Fauno en DB vacía crea exactamente 26 categorías y 144 ítems (1.62ms)
✔ E01-9: Idempotencia estricta: re-importar el catálogo Fauno produce 0 creaciones y preserva IDs (2.58ms)
✔ E01-10: Desactivación segura (no hard-delete): ítem ausente pasa a isAvailable: false y conserva registro (0.77ms)
✔ E01-11: dryRun simula la sincronización sin mutar el estado de la base de datos (0.62ms)
✔ E01-12: Renombrar un plato conservando externalId preserva MenuItem.id en base de datos (0.65ms)
✔ E01-13: Detección y rechazo de duplicados de externalId en payload (0.88ms)
✔ E01-14: Migración PostgreSQL de catalogKey es idempotente y no destructiva (0.64ms)
✔ E01-15: Ruta GET /menu excluye categorías vacías o inactivas por defecto (P3) (0.52ms)
✔ Fauno catalog has the expected public identity and source scope (0.86ms)
✔ Fauno catalog has valid prices, unique item ids and no footer artifact (0.34ms)
✔ coming-soon products remain visible but unavailable for ordering (0.13ms)
✔ buildFaunoBatchMenuImportDTO produces a valid, reproducible import payload (4.78ms)
✔ public demo catalog is identical to data catalog (1.11ms)
✔ instance manifest example is valid (7.01ms)
✔ production requires HTTPS domains (0.68ms)
✔ manifest rejects embedded secrets (0.38ms)
✔ pre-order requires waitlist and every Vercel project is declared (0.46ms)
✔ local override requires an isolated branch and commit (0.42ms)

Total: 25 tests ejecutados, 25 aprobados (PASS), 0 fallidos, 0 cancelados.
```

---

## 5. Estado de Git y Verificación del Worktree

Comprobación mediante `git status --short`:
- Modificados intencionales:
  - `apps/client-web/app.js`
  - `packages/api/prisma/schema.prisma`
  - `packages/api/prisma/schema.supabase.prisma`
  - `packages/api/src/routes/menu.routes.ts`
  - `packages/shared/src/index.ts`
  - `scripts/fauno-catalog.test.mjs`
  - `scripts/parse-fauno-catalog.mjs`
- Archivos creados pertenecientes a E01:
  - `packages/api/prisma/migrations-postgres/20260921000000_e01_menu_item_catalog_key/migration.sql`
  - `packages/api/src/services/menu-import.service.ts`
  - `packages/api/test/menu-import.test.ts`
  - `scripts/e01-catalog-invariants.test.mjs`
  - `scripts/import-fauno-catalog.mjs`
  - `docs/ejecucion-plan-modulos/E01-CATALOGO-UNICO-2026-09-21.md`
- **Cero artefactos huérfanos o temporales:** No hay archivos generados de build (`dist/`, `.tmp/`, etc.) sin ignorar en el árbol de trabajo. El lock `.tmp/mesaya-heavy.lock` fue removido y no quedan procesos activos en background.

---

## 6. Clasificación de Tareas Pendientes

### PENDING_CLOUD
1. **Migración PostgreSQL / Supabase:** Aplicar la migración SQL `20260921000000_e01_menu_item_catalog_key/migration.sql` en la base de datos remota de Supabase antes del primer despliegue a producción.
2. **Sincronización Inicial del Menú en la Nube:** Ejecutar `POST /v1/restaurants/fauno-olavarria/menu/import` con el DTO producido por `scripts/import-fauno-catalog.mjs` contra la base remota.
3. **Despliegue en Vercel:** Desplegar los paquetes compilados de `@mesaya/api` y `@mesaya/client-web`.

### PENDING_HUMAN
1. **Validación Comercial del Menú Fauno:** El encargado de Fauno Olavarría debe inspeccionar los precios, nombres y etiquetas resultantes antes de la publicación final en producción.
2. **Definición de Política de Comandas:** Confirmar si el local operará inicialmente en modalidad comanda digital activa (`allowOrdering: true`) o sólo como carta interactiva con llamado a personal de salón.

---

## 7. Riesgos Residuales

1. **Catálogo sin Migración en Cloud:** Si se despliega el código backend a producción sin haber aplicado la migración SQL `20260921000000_e01_menu_item_catalog_key` en PostgreSQL, las consultas que intenten escribir o indexar `catalogKey` fallarán. Se mitiga aplicando la migración no destructiva previa al despliegue.
2. **Platos Antiguos Sin ExternalId:** Los platos cargados previamente de forma manual en bases existentes no poseen `catalogKey`. Se mitiga mediante la resolución de fallback por nombre que realiza el backfill automático en su primera sincronización.
