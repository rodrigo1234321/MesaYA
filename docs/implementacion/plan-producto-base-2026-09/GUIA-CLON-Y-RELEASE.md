# Guía de clonación y release por restaurante

Fecha: 2026-09-07  
Propósito: convertir este repositorio en una línea base reproducible que pueda clonarse desde GitHub y desplegarse como una instancia aislada por local.

## 1. Qué se entrega

El entregable es el código base versionado, no una copia de datos ni una instalación atada al local de referencia. Un clon limpio debe poder; un local que necesite código propio agrega después un override versionado y aislado:

1. instalar dependencias;
2. crear una base SQLite local y datos demo sin Supabase;
3. compilar los seis workspaces;
4. ejecutar la suite determinista sin alterar la base demo;
5. levantar comensal, API, pantalla compartida de salón y administración;
6. recorrer QR/NFC → sesión → carta → carrito/comanda → mozo → cocina → cobro presencial → cierre de mesa;
7. validar una configuración de instancia sin secretos.

La evidencia local certifica el código. No inventa evidencia de un proyecto Supabase, Vercel, dispositivo físico o backup que todavía no se haya conectado.

## 2. Arranque de un clon limpio

Desde la raíz del repositorio:

```bash
npm ci
npm run setup:local
npm run build
npm test
```

`setup:local` es idempotente y seguro para desarrollo:

- crea `.env` y `packages/api/.env` sólo si no existen;
- genera el cliente Prisma SQLite;
- ejecuta `db push` únicamente sobre `packages/api/prisma/dev.db` (o sobre el archivo indicado con `--db`);
- si la base está vacía, carga la demo; si ya tiene datos, no la sobreescribe;
- nunca llama a Supabase ni a un proveedor externo.

Para una verificación desechable:

```bash
npm run setup:local -- --db .tmp/local-smoke.db
```

Para levantar los servicios se pueden usar los scripts existentes (`npm run dev:api`, `npm run dev:staff`, `npm run dev:admin` y el workspace de cliente). Las credenciales demo sólo sirven para desarrollo local: mozo `1234`, encargado `9999`, mesa `Mesa 1`.

## 3. Gates de la línea base

Estos comandos son el mínimo antes de publicar una release desde GitHub:

```bash
npm run build
npm test
npm run check:routes
npm run check:supabase-schema
npm run instance:test
npm run instance:validate -- --production
npm --workspace=@mesaya/qr-generator run test
```

El build local usa SQLite. El build que se publica en Vercel usa `npm run build:pg`/`vercel-build` con `DATABASE_URL` y `DIRECT_URL` de PostgreSQL; después de comprobarlo se regenera el cliente SQLite si se continúa trabajando localmente:

```bash
npm --workspace=@mesaya/api run prisma:generate
```

El runner de `npm test` crea una SQLite efímera en `.tmp/test-local`, ejecuta un solo worker y elimina sólo su propio sandbox. La base demo nunca es un fixture de tests.

## 4. Estructura de una instancia real

Para cada restaurante se crea, fuera de este repositorio:

- un proyecto Supabase/PostgreSQL;
- un proyecto Vercel para la API;
- un proyecto Vercel para el cliente/comensal;
- un proyecto Vercel para la pantalla de salón/mozos;
- un proyecto Vercel para administración.

Los cuatro proyectos se despliegan desde la misma revisión base y reciben la misma versión de aplicación. Si el manifiesto declara `LOCAL_OVERRIDE`, los cuatro reciben el mismo commit de override del local. El aislamiento depende de la base, secretos, dominios, CORS, `restaurantId` raíz y `MESAYA_INSTANCE_MODE=SINGLE_RESTAURANT` de cada instancia.

## 5. Alta de un local

1. Copiar `deploy/instance.example.json` a un archivo de trabajo no versionado y completar nombre, slug, zona horaria, moneda, dominios, módulos y nombres de proyectos Vercel. Mantener `BASE_RELEASE` salvo que el local requiera código propio; en ese caso completar también la rama y el commit `LOCAL_OVERRIDE`.
2. Ejecutar `npm run instance:validate -- --production <manifiesto>`.
3. Ejecutar `npm run instance:provision:plan -- --production <manifiesto>` y revisar el plan. Este comando es sólo declarativo y no muta cuentas.
4. Crear el proyecto Supabase vacío y guardar sus URLs fuera de Git.
5. Cargar `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ENCRYPTION_SECRET_KEY`, CORS y las variables de instancia en los entornos protegidos.
6. Ejecutar migraciones PostgreSQL con `prisma migrate deploy` usando la conexión directa. En producción no usar `db push` ni el seed destructivo.
7. Ejecutar el bootstrap administrativo idempotente para crear el restaurante raíz, mesas iniciales y manager temporal. Rotar el PIN antes de abrir al público.
8. Crear los cuatro proyectos Vercel y desplegar la misma revisión. El cliente, staff y admin reciben `VITE_API_URL` apuntando al API de ese local.
9. Ejecutar health, configuración, carta, login de staff/admin, URL canónica de mesa y el recorrido de operación completo.
10. Registrar release, schema, override si existe, dominios, responsables, backup y resultado del smoke sin guardar secretos en el manifiesto.

El procedimiento se repite para cada local. Las diferencias de carta, branding, mesas, sectores, reglas y módulos son configuración; un cambio reutilizable vuelve al repositorio base.

## 6. Contrato funcional de la release base

### Operativo en el núcleo

- QR y NFC mediante el mismo enlace canónico por local/mesa.
- Sesión de mesa, vencimiento, reintento y cierre.
- Carta, categorías, precios, fotos, stock, etiquetas, notas e identidad grupal.
- Carrito colaborativo y comanda desde cliente o mozo, según la regla configurada.
- Pantalla compartida de salón: selección de actor, PIN, llamados, sectores, prioridades, sonido, reconexión y liberación.
- KDS de cocina para pedidos del cliente y del mozo.
- Cobro presencial en efectivo, tarjeta/POS o QR informado por el mozo; propina y registro idempotente.
- Cierre de orden, cierre de sesión y liberación de mesa.
- Administración de carta, mesas, sectores, branding, turnos, capacidades y métricas.

### Módulos con contrato propio

Fila virtual, Rewards, upselling, feedback, Sommelier y fallback de WhatsApp se activan sólo cuando su configuración y sus datos están listos. Cada módulo debe conservar UI, API, persistencia, permisos, diagnóstico y pruebas; si falta una dependencia, se muestra como no disponible y no como éxito simulado.

Mercado Pago en esta release es sólo una opción informativa para que el cliente indique una preferencia. No se usa SDK, token, webhook ni cobro automático. La división digital de cuenta permanece cerrada con `503 DIGITAL_PAYMENTS_UNAVAILABLE` hasta que exista un contrato financiero separado.

## 7. Qué no debe confundirse

| Evidencia | Demuestra | No demuestra |
|---|---|---|
| `npm test` y build | Contratos locales y compilación | Red, PostgreSQL remoto, dispositivos o backups |
| `build:pg` | Compatibilidad de compilación con Prisma PostgreSQL | Que una cuenta Supabase esté correctamente configurada |
| QR generado | URL canónica y contenido del artefacto | Que el QR físico haya sido impreso y probado en cada teléfono |
| `instance:validate` | Manifiesto sin secretos y con dominios válidos | Que existan esos proyectos Vercel |
| smoke local | Recorrido integrado en una instalación controlada | Concurrencia real de un salón hasta certificarla en la instancia |

La línea base se considera lista para clonación cuando todos los gates locales están verdes. La apertura de un local concreto agrega los gates de infraestructura, dispositivos, backup, observabilidad y aceptación humana de ese local.
