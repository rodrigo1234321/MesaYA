# Plan de cierre de hallazgos E2E — MesaYA

Fecha: 2026-09-11  
Estado: PLANIFICADO; no ejecutado  
Objetivo: corregir los defectos confirmados por la prueba integral, eliminar divergencias contables y alcanzar un GO verificable para un piloto físico controlado.

## 1. Resultado buscado

Al terminar este plan deben cumplirse simultáneamente estas condiciones:

- tocar un ticket desde `Operaciones` abre directamente su vista previa;
- toda comanda aceptada tiene un importe canónico válido en unidades menores;
- cuenta, cobro, reporte y ticket usan la misma proyección contable;
- ninguna comanda pendiente, rechazada o borrador integra consumo cobrable;
- el entorno local se inicia por IP con una base compatible y sin forzar pérdida de datos;
- el acceso público directo a Supabase queda bloqueado o expresamente protegido;
- la suite completa, los builds y el flujo navegador → API → DB → interfaces quedan verdes;
- el piloto físico documenta efectivo, débito, crédito, QR, impresión y recuperación de red.

Este plan no implementa procesamiento real de tarjetas/QR ni factura electrónica ARCA. El sistema registra esos medios de cobro manualmente. Si se requiere procesarlos o emitir comprobantes fiscales, corresponde abrir una fase distinta.

## 2. Hallazgos que debe resolver

### H1 — Navegación de tickets

Confirmado en `apps/admin-dashboard/src/components/SalesManager.tsx`: `handleViewReceipt()` obtiene y guarda el ticket, pero no cambia `subTab` a `tickets`. El GET responde 200; el usuario queda visualmente en `Operaciones` y debe cambiar de pestaña manualmente.

### H2 — Dos fuentes de verdad para el consumo

La cuenta agrega `Order.totalAmountMinor`, mientras que `ReceiptService` vuelve a calcular el consumo sumando líneas de `OrderItem`. La fixture E05 crea una orden `PENDING_VALIDATION` sin `totalAmount`/`totalAmountMinor`; al aceptarla cambia el estado pero no reconstruye el importe. Resultado posible: la cuenta y el cobro ignoran esa tanda, mientras el ticket sí suma sus ítems.

El flujo normal enviado desde la carta no reprodujo el problema porque `submitOrder()` persiste correctamente ambos totales. Aun así, la invariancia debe quedar protegida en el dominio, no depender de que todos los escritores se comporten bien.

### H3 — Base local histórica incompatible

`packages/api/prisma/dev.db` quedó detrás del esquema actual y contiene datos que impiden un `db push` no destructivo. No se debe usar `--accept-data-loss`. La prueba integral se completó contra una base aislada y actualizada bajo `.tmp/`.

### H4 — Arranque LAN inconsistente si se inicia sólo el API

`npm run dev` y `npm run dev:clean` construyen los orígenes CORS para la IP local. Ejecutar `npm run dev:api` de forma aislada puede conservar una configuración sólo para `localhost` y provocar `Failed to fetch` desde el teléfono. Es un problema de procedimiento y visibilidad del entorno.

### H5 — Hardening pendiente en Supabase

La aplicación usa Fastify/Prisma, no necesita que los navegadores consulten directamente PostgREST. Las tablas públicas no tienen RLS canónico en las migraciones. Antes de producción se debe comprobar Data API, grants efectivos y el comportamiento real de `anon`/`authenticated`, y cerrar esa vía sin romper la conexión del API.

### H6 — Validaciones que requieren el local

No se puede certificar automáticamente el conteo físico de efectivo, la aprobación real de un pago, la cámara/QR, NFC ni una impresora térmica. Son puertas humanas del piloto, no tests unitarios.

## 3. Orden de ejecución

### E00 — Preservar el punto de partida

Acciones:

1. Registrar rama, commit, `git status`, versiones de Node/npm/Prisma y procesos activos.
2. Crear una rama de trabajo, por ejemplo `codex/close-e2e-findings-2026-09-11`.
3. No incluir capturas, bases SQLite, `.env`, PDFs descargados ni secretos en el commit.
4. Copiar `packages/api/prisma/dev.db` a una ubicación fechada si contiene datos que se quieran conservar.
5. No ejecutar `db push --accept-data-loss`, `migrate reset` ni borrados de bases.

Gate E00:

- estado inicial registrado;
- respaldo verificable si corresponde;
- ninguna credencial aparece en diff o logs archivados.

### E01 — Establecer la invariancia monetaria de las comandas

Prioridad: P0.

Regla canónica:

```text
order.totalAmountMinor = suma(item.quantity × item.unitPriceMinor)
order.totalAmount      = order.totalAmountMinor / 100
```

Acciones:

1. Extraer una función pura para calcular el total snapshot de una tanda usando primero `unitPriceMinor` y sólo usando `unitPrice` como compatibilidad histórica.
2. En `OrderService.validateOrder()`:
   - cargar ítems y precios snapshot;
   - rechazar una orden vacía o con cantidad/precio inválido;
   - recalcular ambos totales;
   - persistir total, estado `IN_KITCHEN`, limpieza de `draftKey` y motivo de revisión en una única transacción;
   - conservar la idempotencia si dos mozos aceptan simultáneamente.
3. No tomar nunca precios actuales de `MenuItem` para reconstruir una orden histórica; usar el snapshot de `OrderItem`.
4. Mantener `PENDING_VALIDATION` fuera del consumo hasta que la transición haya confirmado y persistido el total.
5. Si la validación no puede producir un total confiable, devolver un error de dominio explícito y no avanzar el estado.

Archivos probables:

- `packages/api/src/services/order.service.ts`;
- un helper de dominio de dinero/órdenes si evita duplicación;
- `packages/api/test/e05-validation-exceptions.test.ts`;
- `packages/api/test/b06-submit-cart-races.test.ts`.

Pruebas obligatorias:

- orden pendiente normal conserva el mismo total al aceptarse;
- orden pendiente histórica sin total se repara desde sus líneas;
- orden sin líneas o con snapshot inválido no se acepta;
- dos aceptaciones concurrentes producen una sola transición y el mismo total;
- la cuenta vale cero antes de aceptar y el total completo después;
- precio posterior de la carta no cambia el snapshot de la tanda.

Gate E01:

- ninguna orden en estado cobrable queda con total nulo, negativo o distinto de sus líneas;
- pruebas de concurrencia e idempotencia verdes.

### E02 — Unificar cuenta, cobro, ticket y reporte

Prioridad: P0.

Acciones:

1. Definir `SessionAccount` como fuente canónica del consumo de una ocupación.
2. Hacer que `ReceiptService` use esa proyección para `consumoMinor`, `paidMinor`, `tipMinor` y `saldoMinor`.
3. Mantener las líneas del ticket para detalle, pero reconciliar su suma contra el consumo canónico antes de persistir el snapshot.
4. Si las líneas y la cuenta no coinciden, no emitir un ticket engañoso: devolver `RECEIPT_ACCOUNT_MISMATCH`, registrar contexto sin secretos y requerir corrección de datos.
5. Para `PAYMENT_RECEIPT`, comprobar además:
   - el settlement pertenece a la sesión;
   - `paymentTotalMinor = amountMinor + tipMinor - ajustes`;
   - la propina no se mezcla con consumo;
   - el saldo nunca se vuelve negativo.
6. Revisar `SalesReportsService` y `FiscalService` para que consuman `totalAmountMinor` con la misma semántica, sin sumar líneas de forma independiente.
7. Preservar la inmutabilidad: cambiar precios actuales o reimprimir no altera un ticket ya generado.

Archivos probables:

- `packages/api/src/services/receipt.service.ts`;
- `packages/api/src/services/order.service.ts` o un proyector compartido;
- `packages/api/src/services/sales-reports.service.ts`;
- `packages/api/src/services/fiscal.service.ts`;
- `packages/api/test/sales-reports-settle.test.ts`;
- `packages/api/test/b03-session-account.test.ts`;
- `packages/api/test/b04-account-settle.test.ts`.

Pruebas obligatorias:

- cuenta = suma de tandas aceptadas;
- cobro de consumo y propina queda separado y suma el total final;
- ticket = cuenta = reporte para efectivo, débito, crédito y QR;
- pagos parciales, ajustes y devoluciones mantienen saldo correcto;
- una inconsistencia sembrada impide emitir el ticket y no genera un snapshot parcial;
- reintento con la misma idempotency key devuelve el mismo comprobante.

Gate E02:

- en cada caso, `consumo`, `pagado`, `propina`, `total` y `saldo` coinciden en DB, API, Staff, Admin y PDF;
- ningún ticket inconsistente se persiste.

### E03 — Corregir fixtures y auditar datos existentes

Prioridad: P0 antes de migrar o desplegar.

Acciones:

1. Corregir la fixture E05 en `packages/api/prisma/seed.ts` para crear `totalAmount` y `totalAmountMinor` junto con la orden de 7 unidades.
2. Mantener el propósito de E05: la tanda debe seguir en `PENDING_VALIDATION` y fuera del consumo hasta ser aceptada.
3. Crear una consulta/script de auditoría de sólo lectura que detecte órdenes cobrables donde:
   - falte `totalAmountMinor`;
   - el total sea negativo;
   - el total difiera de la suma de líneas snapshot;
   - no existan líneas;
   - haya settlement superior al consumo sin justificación registrada.
4. Ejecutar primero la auditoría en SQLite de prueba y después en Supabase staging.
5. Si aparecen registros históricos, preparar una migración de reparación separada, acotada e idempotente. Reparar sólo cuando los ítems tengan snapshots válidos; los casos ambiguos se exportan para revisión manual.
6. Repetir la auditoría después de la reparación y exigir cero inconsistencias no justificadas.

Gate E03:

- el seed nuevo nunca crea una orden que viole la invariancia;
- auditoría previa y posterior archivada con conteos, sin datos sensibles;
- ninguna reparación silenciosa ocurre durante una lectura o impresión.

### E04 — Corregir la navegación del ticket

Prioridad: P1.

Acciones:

1. En `handleViewReceipt()`, cambiar a `tickets` únicamente después de que `AdminApi.getReceipt()` responda correctamente.
2. Mantener al usuario en `Operaciones` y mostrar el error existente si falla la carga.
3. Añadir estado de carga o deshabilitar temporalmente el botón para evitar dobles clics si la latencia lo hace necesario.
4. Verificar teclado, click y dispositivo táctil.

Archivo principal:

- `apps/admin-dashboard/src/components/SalesManager.tsx`.

Pruebas obligatorias:

- tocar `TK-...` desde Operaciones abre `Tickets` y muestra el mismo número;
- `Descargar PDF` consulta el receipt seleccionado;
- un 404/403 no cambia de pestaña ni deja un ticket anterior como si fuera el solicitado;
- doble clic no duplica comprobantes ni descargas.

Gate E04:

- navegación directa y accesible por mouse, teclado y touch;
- cero errores de consola o requests no controlados.

### E05 — Estandarizar la ejecución local por IP

Prioridad: P1 para pruebas reproducibles.

Acciones:

1. Adoptar `npm run dev:clean` como comando canónico del piloto local de prueba.
2. Mostrar claramente al iniciar:
   - ruta de la base activa;
   - IP detectada;
   - URL de cliente, Staff, Admin y health;
   - orígenes CORS habilitados;
   - advertencia de que es una base demo aislada.
3. Documentar que `npm run dev:api` es para desarrollo parcial y requiere `CORS_ORIGIN` explícito si se consume desde LAN.
4. Para `dev.db` histórica:
   - si es descartable, archivarla y usar `.tmp/live-local.db`;
   - si contiene información útil, respaldarla y migrarla con un procedimiento específico;
   - nunca forzar pérdida de datos para hacer pasar el setup.
5. Añadir un smoke de arranque que verifique 200 en puertos 3000/5173/5174/5175 y una sesión real por IP.

Gate E05:

- una máquina limpia puede preparar e iniciar todo con un comando;
- un teléfono en la misma Wi-Fi abre la mesa sin error CORS;
- reiniciar conserva la base aislada o la regenera sólo mediante una acción explícita.

### E06 — Cerrar el acceso directo de Supabase

Prioridad: P0 para producción; ejecutar primero en staging.

Acciones:

1. Inventariar en Supabase:
   - si Data API está habilitada;
   - esquemas expuestos;
   - grants de `anon` y `authenticated`;
   - propietario/rol usado por Prisma;
   - tablas sin RLS y funciones con privilegios públicos.
2. Arquitectura recomendada para MesaYA actual:
   - deshabilitar Data API si el proyecto no la necesita;
   - revocar permisos a `anon` y `authenticated` sobre tablas, secuencias y rutinas del producto;
   - revocar también privilegios predeterminados para objetos futuros.
3. Evaluar RLS como defensa adicional en staging. No habilitarla masivamente en producción sin probar que migrations, runtime Prisma, health y flujo E2E conservan acceso.
4. Convertir la decisión en una migración SQL reproducible y versionada; no dejarla sólo como configuración manual del dashboard.
5. Ejecutar pruebas negativas con una clave pública contra tablas sensibles: deben responder 401/403/404 o no exponer filas.
6. Repetir por el API oficial: login, sesión, pedido, cobro, ticket y reportes deben seguir funcionando.
7. Ejecutar aislamiento cruzado entre dos restaurantes y exigir 403/404 sin filtración de existencia o datos.

Gate E06:

- acceso directo público bloqueado y demostrado;
- API Fastify/Prisma conserva todas sus operaciones;
- cero cruces de tenant;
- la migración puede repetirse de forma segura en un proyecto nuevo.

### E07 — Regresión completa automatizada y en navegador

Ejecutar, en este orden:

```powershell
npx vitest run packages/api/test/e05-validation-exceptions.test.ts packages/api/test/b03-session-account.test.ts packages/api/test/b04-account-settle.test.ts packages/api/test/sales-reports-settle.test.ts
npm run test:local
npm run check:routes
npx tsc --noEmit
npm run build
npm run check:supabase-schema
git diff --check
```

Matriz E2E mínima por navegador:

1. Cliente abre una mesa nueva.
2. Agrega, suma y resta cantidades.
3. Envía dos tandas y prueba un doble submit.
4. Resuelve una tanda `PENDING_VALIDATION` por aceptación y otra por rechazo.
5. Solicita cuenta con cada medio: efectivo, débito, crédito y QR.
6. Prueba propina 0%, 10%, 20% y monto manual, más valoración.
7. Staff ve medio, propina, total y responsable precargados.
8. Intenta cobrar con pendientes y confirma que el guard lo impide.
9. Cobra, cierra y comprueba `TO_CLEAN`.
10. Admin compara operación, resumen, CSV, PDF y ticket.
11. Marca `Mesa lista` y comprueba que la nueva ocupación inicia en cero.
12. Repite una ruta con pérdida y recuperación de red.

Para cada historia registrar:

- acción visible;
- request y status HTTP;
- fila/estado relevante en DB;
- resultado reflejado en la siguiente interfaz;
- consola del navegador sin errores.

Gate E07:

- cero tests fallidos y skips sólo explícitos/justificados;
- seis builds correctos;
- cero errores no tratados en Cliente, Staff y Admin;
- invariancias contables verificadas por caso y por método.

### E08 — Piloto físico controlado

Alcance inicial recomendado: una zona, dos mesas, un mozo, un encargado y 45–60 minutos antes de atender público.

Guion:

1. Escanear el QR generado por Admin desde Android y iPhone.
2. Confirmar que cada QR abre su mesa y no el dashboard ni otra mesa.
3. Hacer un pedido real y validar tiempos de aparición en Staff/cocina.
4. Ejecutar un cobro en efectivo contando caja inicial, ingreso y caja final.
5. Registrar débito, crédito y QR por separado; confirmar que son registros manuales y cotejarlos con los comprobantes externos.
6. Imprimir y reimprimir un ticket térmico; comparar importe, mesa, mozo, medio y propina.
7. Cortar Wi-Fi brevemente, recuperar y confirmar que no se duplican pedido, llamado ni cobro.
8. Limpiar la mesa y abrir una nueva ocupación con saldo cero.

Gate E08:

- caja teórica = caja física para el caso probado;
- totales de tarjeta/QR coinciden con los comprobantes del proveedor;
- QR, teléfono, impresora y red real aprobados;
- responsable del local firma GO o documenta cada desvío.

## 4. Condiciones de NO-GO

No avanzar a producción si ocurre cualquiera de estas condiciones:

- cuenta, settlement, ticket y reporte no coinciden;
- existe una orden cobrable con total inválido;
- se puede emitir un ticket sobre datos inconsistentes;
- el acceso público de Supabase devuelve datos del producto;
- se requiere `--accept-data-loss` para preparar el ambiente;
- hay errores de consola, 500, duplicados o cruces de tenant;
- un QR abre Admin/dashboard o una mesa incorrecta;
- pago físico, impresora o recuperación de red no fueron probados;
- se espera procesamiento real de pagos o factura ARCA, pero sólo está implementado el registro manual.

## 5. Entrega esperada de quien ejecute el plan

La entrega final debe incluir:

- commit exacto y diff revisado;
- lista de archivos modificados y motivo;
- salida resumida de cada gate;
- auditoría contable antes/después;
- evidencia de acceso público Supabase bloqueado;
- capturas o video corto de los flujos físicos;
- PDFs/CSV de prueba sin datos reales sensibles;
- riesgos residuales y decisión final `GO_PILOTO`, `GO_PRODUCCION` o `NO_GO`.

## 6. Estimación orientativa

- E00: 20–30 minutos.
- E01–E04: 4–7 horas según datos históricos encontrados.
- E05: 30–60 minutos.
- E06: 1–3 horas en staging, sin contar esperas del proveedor.
- E07: 2–4 horas.
- E08: 45–60 minutos con dispositivos y personal real.

La secuencia no debe comprimirse saltando gates: E01–E03 son el cierre contable; E06 es el cierre de seguridad; E08 es la única evidencia válida para hardware y operación física.
