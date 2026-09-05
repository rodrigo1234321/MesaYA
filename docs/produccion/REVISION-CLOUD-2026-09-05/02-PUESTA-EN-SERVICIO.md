# Puesta en servicio corregida: Vercel + Supabase

Fecha: 2026-09-05. Procedimiento preparado para después de cerrar los [hallazgos](01-HALLAZGOS.md). No se ejecutó infraestructura en esta revisión. No usar el bootstrap actual con credenciales reales.

## Arquitectura y región

Para la configuración existente, preparar **cuatro proyectos Vercel**: API, Comensal, Staff y Admin; una base Supabase separada por ambiente. El build raíz sólo construye backend, no publica las tres interfaces. Vercel documenta [un proyecto por directorio del monorepo](https://vercel.com/docs/monorepos).

Para usuarios de Mar del Plata/Argentina, la opción inicial a evaluar es API en São Paulo `gru1` y Supabase en São Paulo `sa-east-1`, verificando disponibilidad del plan. No es necesario hospedar en Argentina para que el servicio funcione allí. La recomendación es de latencia, no una conclusión de residencia legal de datos. Fuentes: [regiones Vercel](https://vercel.com/docs/regions), [regiones Supabase](https://supabase.com/docs/guides/platform/regions).

La región de cómputo de la API debe estar cerca de la DB; el CDN de frontends es otra cosa. Vercel usa `iad1` por defecto para proyectos nuevos; no suponer São Paulo si no se configura. Usar el dashboard o agregar `"regions": ["gru1"]` al JSON conservando rewrites, y comprobar la región del despliegue final. [Configuración oficial](https://vercel.com/docs/functions/configuring-functions/region).

No presupuestar operación comercial sobre Hobby: Vercel lo limita a uso personal no comercial. Elegir un plan apto antes del piloto comercial. No se calculó precio final ni se contrataron servicios. [Plan Hobby](https://vercel.com/docs/plans/hobby).

## 1. Preparación y separación de ambientes

1. Cerrar C01–C06, fijar commit y obtener CI verde nueva.
2. Separar nombres, base, usuarios SQL, secretos y dominios de staging/producción. Nunca permitir que una preview de una rama use la DB productiva por herencia de variables.
3. Reservar dominios estables para las tres apps y la API; esto permite definir CORS exacto antes del primer arranque.
4. Seleccionar Node 22 para igualar el CI actual, o cambiar CI y hosting juntos a otra versión soportada y verificar. Fijar también gestor de paquetes y usar el lockfile.
5. Comprobar entorno protegido `production` en GitHub. El YAML `environment: production` por sí solo no configura aprobadores en el panel. El workflow de migración no debe ser un paso automático de build/preview.

## 2. Crear Supabase y cerrar la exposición antes de cargar datos

Crear un proyecto de staging vacío. Deshabilitar Data API desde su integración/configuración **antes de migrar o bootstrap**, ya que esta arquitectura usa Prisma por SQL. Confirmar el estado y probar que los endpoints automáticos no exponen datos. No tomar un código HTTP concreto como única prueba: verificar configuración y ausencia de lectura/escritura con datos centinela. [Seguridad Data API](https://supabase.com/docs/guides/api/securing-your-api).

Copiar las cadenas desde **Connect** en el proyecto; no inventar `aws-0`, región o project ref. Escapar correctamente caracteres especiales de contraseña en una URI. Mantenerlas fuera de Markdown, chat, Git, logs y variables `VITE_*`.

| Conexión | Destino habitual | Uso |
|---|---|---|
| Supavisor transaction | `...pooler.supabase.com:6543` | API serverless; configuración compatible con Prisma 5 y prepared statements. |
| Supavisor session | `...pooler.supabase.com:5432` | Alternativa para herramientas/migraciones desde redes IPv4. **No es conexión directa**, aunque use 5432. |
| Directa PostgreSQL | `db.<ref>.supabase.co:5432` | Migraciones si el entorno tiene conectividad compatible; comprobar IPv6/add-on IPv4. |

La [guía Prisma de Supabase](https://supabase.com/docs/guides/database/prisma) distingue session, transaction y conectividad directa. MesaYA está en Prisma **5.22.0**; no copiar sin adaptación una receta para otra versión mayor. La receta existente usa `pgbouncer=true` para transaction; validarla con el pooler seleccionado y las pruebas de transacciones. Configurar TLS según el endpoint y evaluar límites de conexiones bajo carga, sin deshabilitar verificación TLS como atajo.

## 3. Migraciones y cliente Prisma

Para una base vacía de staging, una vez definidas en el entorno seguro del operador `MESAYA_PG_DATABASE_URL` y `MESAYA_PG_DIRECT_URL`:

```powershell
# Desde la raíz del repositorio; aplica el historial, no fixtures.
npm --workspace=@mesaya/api run prisma:postgres:migrate
```

El historial actual contiene cuatro migraciones: init, active keys, abuse controls y floorplan layout version. Verificar que todas aparecen aplicadas. En una base existente se requiere inventario, backup restaurado, baseline/diff revisado y SQL compatible; no ejecutar este paso a ciegas ni usar `db push`, `migrate dev`, reset o seed para resolver divergencias.

**Antes del bootstrap corregido**, generar el cliente correcto explícitamente:

```powershell
$env:DATABASE_URL = $env:MESAYA_PG_DIRECT_URL
$env:DIRECT_URL = $env:MESAYA_PG_DIRECT_URL
node scripts/prisma-generate.mjs postgres
# Ejecutar aquí bootstrap:restaurant sólo tras corregir C02/C03,
# con nombre/slug/PIN explícitos suministrados de forma segura.
```

No se incluye un PIN de ejemplo ejecutable. El script actual lo imprime y no debe usarse aún con secretos reales. Confirmar un restaurante, gerente, mesas esperadas y cero turnos abiertos. Repetir debe conservar PIN e IDs, tras implementar la corrección.

Al volver al desarrollo SQLite:

```powershell
node scripts/prisma-generate.mjs sqlite
```

No correr generación de clientes PG/SQLite en paralelo. El runner PG aplica migraciones y cambia/restaura el cliente; se utiliza con una base desechable de tests, nunca como suite de producción.

## 4. Configuración de Vercel

| Proyecto | Root Directory | Build | Salida |
|---|---|---|---|
| API | raíz | `npm run vercel-build` explícito | Función `api/index.ts`; no seleccionar `apps/*/dist`. |
| Comensal | `apps/client-web` | `npm run build` del workspace | `dist` |
| Staff | `apps/staff-panel` | `npm run build` del workspace | `dist` |
| Admin | `apps/admin-dashboard` | `npm run build` del workspace | `dist` |

Para API, conservar el adaptador Node existente y los rewrites `/health` y `/v1/:match*`; verificar el preset elegido por Vercel en el build. El soporte nativo Fastify tiene otros entrypoints convencionales: no cambiar root a `packages/api` sin adaptar el despliegue. No dar por probado el empaquetado de Prisma hasta invocar la función publicada. [Fastify en Vercel](https://vercel.com/docs/frameworks/backend/fastify).

Para frontends, comprobar instalación de npm workspaces desde el lockfile raíz y acceso a `packages/shared` fuera de Root Directory. Verificar la opción de inclusión de archivos externos a la raíz de cada app cuando corresponda. El criterio es que un build limpio de cada proyecto resuelva shared, TypeScript y assets sin depender de `dist` locales previos.

| Variable | Proyecto/fase | Valor esperado |
|---|---|---|
| `DATABASE_URL` | API runtime | Transaction pooler del ambiente correcto. |
| `JWT_SECRET` | API | Aleatorio, al menos 32 caracteres, distinto del de cifrado. |
| `ENCRYPTION_SECRET_KEY` | API | Otro secreto aleatorio de al menos 32 caracteres. |
| `NODE_ENV` | API | `production`, también en staging cloud para validar seguridad real. |
| `CORS_ORIGIN` | API | Tres orígenes HTTPS exactos, separados por comas, sin slash final ni paths. |
| `VITE_API_URL` | Build de las tres apps | `https://<dominio-api>/v1`. |
| `VITE_CLIENT_WEB_URL` | Build de Admin | `https://<dominio-comensal>`; imprescindible para QR entre proyectos. |
| `MESAYA_PG_DATABASE_URL` | Operador/workflow de migración | URL PG explícita del destino autorizado. |
| `MESAYA_PG_DIRECT_URL` | Operador/workflow de migración | Directa o session adecuada para herramientas. |
| `DIRECT_URL` | Herramientas/cliente PG | La usa el schema para operaciones directas; no asumir que el runtime necesita credencial privilegiada de migración. Comprobar build/runtime por separado. |

Mantener `PILOT_PUBLIC_ONBOARDING_ENABLED`, `ENABLE_AI_FEATURES` y `ALLOW_LEGACY_DEMO_ROUTES` ausentes/falsos. No cargar claves de IA para este piloto. Las variables Vite quedan públicas en el bundle: sólo URLs públicas, nunca DB/JWT/cifrado. Cambiar una variable de build exige reconstruir/redeploy del frontend.

Ejemplo conceptual de CORS: `https://cliente.example.com,https://staff.example.com,https://admin.example.com`. `https://*.vercel.app` **no funciona** con el código actual. Para previews, usar dominios exactos del entorno aislado. La protección de previews también debe permitir que los dispositivos autorizados realicen OPTIONS/API; no desproteger producción por un fallo de preflight.

## 5. Verificación antes de habilitar uso

Ejecutar la matriz completa de [pruebas](03-PRUEBAS-Y-EVIDENCIA.md). Un `/health` con `database: connected` demuestra conexión básica, no permisos de todas las tablas, login, QR, atomicidad ni capacidad.

Registrar commit, identificadores de despliegue de los cuatro proyectos, región, versión Node, estado de migraciones y evidencia sin secretos. Mantener un artefacto previo recuperable. Un rollback Vercel revierte código; no deshace automáticamente SQL.

Para datos reales, realizar backup y restauración en otra base, con integridad funcional. Supabase recomienda exportaciones periódicas fuera del proyecto para Free; no suponer que todo plan incluye el mismo backup/PITR. [Backups oficiales](https://supabase.com/docs/guides/platform/backups). Fijar retención, responsable, RPO/RTO y probarlos antes de declarar GO.
