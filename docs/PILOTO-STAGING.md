# MesaYA — piloto real en staging

Fecha: 2026-09-06. Objetivo: un local, tres mesas iniciales, un encargado, un mozo y celulares reales con QR/NFC. Nombre provisional: **MesaYA Piloto**, slug `mesaya-piloto`. Cambiar estos datos por los del local elegido antes del bootstrap.

## Estado y fuente a desplegar

Preparación local en `Projects/mdpmesasvivas-cocina-cuentas`, rama `codex/mesaya-cocina-cuentas-20260905`, base `dd239a2`. **GitHub main sigue en `1f461c6`**, según `git ls-remote` del 6 de septiembre. No importar main suponiendo que incluye cocina/cuentas y las últimas correcciones.

La cuenta Vercel consultada tiene sesión iniciada, pero no contiene proyectos MesaYA. No se identificó aún una base Supabase de staging ni sus cadenas de conexión. No hay URL desplegada validada ni escaneo físico realizado. Ver [evidencia de preparación](PILOTO-EVIDENCIA.md).

Publicar una rama específica con este contenido y CI aprobada, o desplegar este checkout explícitamente. No reemplazar main ni conectar la base productiva para desbloquear el piloto. La CI incluye PostgreSQL efímero; sus suites **no se ejecutan contra la base del local** porque crean/eliminan fixtures.

## Infraestructura de prueba

Crear un proyecto Supabase vacío `mesaya-staging`, y cuatro proyectos Vercel separados de cualquier servicio productivo. Los siguientes nombres son propuestos; confirmar los dominios que Vercel realmente asigne.

| Proyecto propuesto | Root Directory | Build Command | Output |
|---|---|---|---|
| mesaya-staging-api | `.` | `npm run vercel-build` | función `api/index.ts`; sin override de dist |
| mesaya-staging-client | `apps/client-web` | `npm run build` | `dist` |
| mesaya-staging-staff | `apps/staff-panel` | `npm run build:shared && npm run build --workspace=@mesaya/staff-panel` | `dist` |
| mesaya-staging-admin | `apps/admin-dashboard` | `npm run build:shared && npm run build --workspace=@mesaya/admin-dashboard` | `dist` |

Para Staff/Admin, ejecutar el build anterior desde raíz mediante `cd ../.. && ...` en el override de Vercel. Activar **Include source files outside of the Root Directory** para que se incluyan paquetes compartidos y el lockfile. Instalación reproducible: `npm ci` desde raíz (frontends: `cd ../.. && npm ci`). Fijar Node 22 en los cuatro proyectos, alineado con CI. El build raíz de API no publica los frontends. [Monorepos de Vercel](https://vercel.com/docs/monorepos/monorepo-faq).

Usar Preview para este ensayo y reservar un alias HTTPS estable que apunte al despliegue aprobado. Cada actualización debe conservar ese alias para que los NFC sigan funcionando. Configurar acceso al alias de prueba para que celulares sin cuenta de Vercel puedan abrir Comensal y API; revisar las opciones disponibles del plan. No distribuir un bypass secreto dentro del QR ni en JavaScript. El login propio de Staff/Admin sigue siendo necesario. [Protección de despliegues](https://vercel.com/docs/deployment-protection).

## Variables y base

Copiar cadenas reales desde Connect de Supabase. Session pooler 5432 sirve para migrar desde IPv4; no llamarlo conexión directa. Transaction pooler 6543 para serverless, con configuración compatible con Prisma 5 (`pgbouncer=true`). No inventar host, región o referencia. [Prisma/Supabase](https://supabase.com/docs/guides/database/prisma).

Desactivar Data API antes de migrar: este proyecto accede mediante Prisma/SQL, no necesita publicar automáticamente las tablas. Confirmar la configuración en Supabase. [Seguridad de datos](https://supabase.com/docs/guides/database/secure-data).

| Variable | Dónde | Valor |
|---|---|---|
| DATABASE_URL | API, Preview | Transaction pooler de staging |
| JWT_SECRET | API, Preview | Secreto aleatorio propio, ≥32 caracteres |
| ENCRYPTION_SECRET_KEY | API, Preview | Otro secreto distinto, ≥32 caracteres |
| NODE_ENV | API, Preview | `production` activa validaciones estrictas aunque el negocio esté en staging |
| CORS_ORIGIN | API, Preview | Tres orígenes HTTPS exactos, separados por comas, sin barra final |
| VITE_API_URL | Los tres frontends, Preview/build | `https://<alias-api>/v1` |
| VITE_CLIENT_WEB_URL | Admin, Preview/build | `https://<alias-comensal>` |
| MESAYA_PG_DATABASE_URL | Sólo operador de migración | Transaction pooler de staging |
| MESAYA_PG_DIRECT_URL | Sólo operador de migración | Session pooler o conexión directa de staging |

No usar `https://*.vercel.app`: el código lo rechaza. Dejar `PILOT_PUBLIC_ONBOARDING_ENABLED`, `ALLOW_LEGACY_DEMO_ROUTES` y `ENABLE_AI_FEATURES` sin habilitar. Ningún secreto pertenece a `VITE_*`, Markdown, chat o Git. Cambiar variables Vite exige reconstruir.

## Crear el local

En una terminal del operador, cargar las variables anteriores de manera privada. Confirmar que ambas conexiones apuntan al proyecto **staging vacío**. Desde raíz:

```powershell
npm --workspace=@mesaya/api run prisma:postgres:migrate
if ($LASTEXITCODE -ne 0) { throw 'Falló migración; detener puesta en servicio.' }
$env:DATABASE_URL = $env:MESAYA_PG_DIRECT_URL
$env:DIRECT_URL = $env:MESAYA_PG_DIRECT_URL
node scripts/prisma-generate.mjs postgres
if ($LASTEXITCODE -ne 0) { throw 'Falló generación Prisma.' }
# BOOTSTRAP_MANAGER_PIN: definir privadamente 4–6 dígitos, sin pasarlo por argv.
npm run bootstrap:restaurant -- --name 'MesaYA Piloto' --slug mesaya-piloto --manager Encargado --tables 3
if ($LASTEXITCODE -ne 0) { throw 'Falló bootstrap.' }
node scripts/prisma-generate.mjs sqlite
```

El bootstrap crea local, encargado y mesas; no crea carta, mozos ni turno. Repetirlo conserva el PIN existente salvo `--rotate-pin`. No ejecutar el seed demo. Ante una base existente, inventariar y respaldar antes de migrar; no usar reset o db push.

En Admin: entrar con el slug/PIN configurados, completar nombre y carta de prueba (al menos tres productos), crear mozo y asignación, revisar mesas y sectores, configurar coordenadas reales del local si se usa geofencing, abrir turno. Desde Staff habilitar atención/sesión de las mesas antes de probar llamados. Una mesa sin sesión activa muestra carta/estado inactivo: no es un error de QR.

Para probar cocina y cuentas usar pedidos identificados como PRUEBA y registros manuales de caja, sin cobros digitales reales. Verificar los permisos del mozo y del encargado por separado.

## Kit físico de QR y NFC

Editar `config/pilot-tables.json` con las etiquetas exactas existentes. Generar sólo después de verificar el alias HTTPS del Comensal:

```powershell
$env:NODE_ENV = 'production'
$env:MESAYA_PUBLIC_URL = 'https://<alias-comensal-real>'
npm run qr:pilot -- --slug mesaya-piloto --tables-json config/pilot-tables.json
if ($LASTEXITCODE -ne 0) { throw 'No usar el lote QR.' }
```

Entrega en `hardware/qr-generator/output/`: SVG por mesa y `nfc-manifest.json` con URL por etiqueta. El lote refleja sólo las mesas del manifiesto; retirar impresos sobrantes de pruebas anteriores. El generador conserva el viewBox del QR, tamaño 240×240 dentro de la tarjeta y margen de cuatro módulos. No imprimir un ejemplo con dominio ficticio.

Imprimir una muestra, escanearla y después preparar las tres mesas. En NFC Tools: Write → Add a record → URL/URI → pegar el campo `url` de la mesa → Write. Leer de vuelta el tag y comparar con el QR. Mantener tags regrabables durante la prueba. En superficie metálica verificar lectura con un soporte/tag apto para metal.

La URL física permanente es `/r/<slug>/mesa/<etiqueta>`. Nunca grabar `?token=...`: la sesión cambia al cerrar/reabrir mesa. La lectura NFC en segundo plano depende del dispositivo y su estado; Apple la documenta para iPhone XS y posteriores. El QR ofrece la vía alternativa. [Lectura NFC de Apple](https://developer.apple.com/documentation/CoreNFC/adding-support-for-background-tag-reading).

## Verificar y aceptar el piloto

Copiar `config/staging.example.json` a `.tmp/staging.json` y reemplazar los cuatro orígenes por URLs reales, slug y mesas. No contiene secretos. Ejecutar desde raíz:

```powershell
npm run staging:smoke -- .tmp/staging.json
```

Este smoke sólo lee: health con DB, HTML sin redirección a login de Vercel, CORS de cada frontend, rechazo de origen ajeno, resolución del local/mesa y rewrite del enlace físico. No sustituye las pruebas JavaScript, de permisos ni de hardware.

| Prueba presencial | Resultado exigido |
|---|---|
| Android + iPhone, QR y NFC, Wi-Fi y datos | Abre el local y mesa correctos sin cuenta de Vercel |
| Abrir turno y mesa; llamar al mozo | Aparece una vez y llega al personal asignado |
| Dos teléfonos en una mesa y otro en una mesa distinta | Participantes/sesiones separados correctamente |
| Pedido, cocina, entrega, cuenta | Ítems e importes coherentes en los tres paneles |
| Reintento por doble toque/microcorte | No duplica pedido ni registro manual de pago |
| Cerrar mesa y reutilizar pestaña vieja | La sesión anterior deja de operar |
| Reabrir y volver a escanear mismo tag | Nueva sesión, sin regrabar NFC ni imprimir QR |
| Negar ubicación y recuperar red | Mensaje comprensible; no confirma un éxito inexistente |
| Refrescar Staff/Admin y cerrar turno | Persiste lo confirmado; accesos correctos |

Registrar dispositivo, hora, mesa, resultado y error (sin tokens/PIN). **Aprobación del piloto:** smoke completo, recorrido presencial completo, ningún cruce de mesas/locales, ningún duplicado y totales correctos. Hasta entonces: entorno de ensayo, no operación aceptada.

Antes de usarlo para pedidos reales del local, probar backup/restauración en otra base y designar responsable. Si falla durante la prueba, cerrar el turno desde Admin y volver a atención manual. Revertir código al despliegue conocido sólo si sigue siendo compatible con el esquema; no borrar ni revertir datos a ciegas.
