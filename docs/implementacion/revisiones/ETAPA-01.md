# Revisión Codex — Etapa 01: Aislar tests y proteger el seed

Fecha: 2026-09-03  
Veredicto: **CHANGES_REQUESTED**

## Resultado de la revisión independiente

El runner, la separación por UUID, el marcador de limpieza y la preservación de `DATABASE_URL` son una dirección correcta. La comprobación independiente preservó el hash de `packages/api/prisma/dev.db` antes y después.

Pero la entrega no cumple todavía los criterios de aceptación:

- `npm run test:isolated` se ejecutó desde `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas` y terminó con exit code 1. Las cuatro suites fallaron antes de Vitest, en `prisma db push`, con `Schema engine error`. Se preservaron cuatro sandboxes forenses como diseño del runner indica. Por eso los 60 tests verdes del reporte no son reproducibles en el estado actual.
- La invocación directa de `assertSafeSeedEnvironment(..., ..., 'development')` con `ALLOW_DEV_SEED=true` aceptó `file:./dev.db`, `file:packages/api/prisma/dev.db` y la ruta absoluta de `packages/api/prisma/dev.db`. Si luego se llama `seedDatabase()`, puede alcanzar sus `deleteMany`. Esto contradice la ficha: el seed destructivo debe permitirse únicamente en el sandbox efímero de test.

## Hallazgos

### [P1] `ALLOW_DEV_SEED` permite sembrar y borrar la base demo

`packages/api/prisma/seed.ts` deja la rama no-test abierta con ese flag y no revalida URL ni sandbox. El reporte afirma que bloquea `dev.db` y que la autorización sólo la emite el runner, pero ambas afirmaciones son falsas para esa rama.

**Corrección requerida:** eliminar la excepción de desarrollo de esta ficha. Cualquier entorno distinto de `NODE_ENV=test` debe rechazar el seed antes de construir/conectar Prisma o ejecutar DML. Mantener la autorización explícita de test y validar que `DATABASE_URL` reside dentro del sandbox. Añadir pruebas de regresión para `development` + `ALLOW_DEV_SEED=true` con rutas `dev.db` relativas y absolutas, además de URL remota.

### [P1] El comando de aceptación no funciona en el estado entregado

El resultado reproducible actual es 0 suites exitosas y 4 fallidas en la fase de schema. Un reporte de 60 PASS no puede sustituir el gate solicitado.

**Corrección requerida:** diagnosticar la causa sin usar `dev.db`, corregir el runner/URL/comando de Prisma para Windows y ejecutar el comando completo de nuevo. No ocultar el error ni hacer que el runner continúe como éxito. Adjuntar salida suficiente para identificar cada suite, exit code 0 y las rutas UUID; los sandboxes de las fallas actuales pueden conservarse como evidencia o documentarse claramente.

### [P2] La supuesta autorización «emitida únicamente por runner» no se verifica en disco

Actualmente cualquier proceso que fije `ALLOW_TEST_SEED=true` y use una ruta bajo `.tmp/qa` puede pasar el guard; el marcador `.runner-owner.json` existe, pero seed no lo valida.

**Corrección requerida:** antes de permitir seed en test, verificar el marcador del sandbox y que describe el directorio/DB de la ejecución actual; rechazar marcador faltante, malformado o que no coincide. Probarlo sin conectar a Prisma.

## Restricciones de la corrección

- Mantener la misma etapa. No iniciar etapa 02, build de workspaces, migraciones PostgreSQL ni Git.
- No borrar los sandboxes forenses de la ejecución fallida durante la corrección; sólo el runner puede limpiar sus propios directorios exitosos con marcador válido.
- Actualizar el reporte: distinguir evidencia histórica de la nueva ejecución independiente. No declarar 60 PASS hasta que sea repetible desde el estado final.
- Volver a `NEEDS_REVIEW` y detenerse.

## Verificación posterior a la corrección declarada

La verificación independiente posterior confirmó que el bypass de desarrollo fue cerrado: con `NODE_ENV=development`, `ALLOW_DEV_SEED=true` y `file:packages/api/prisma/dev.db`, el guard devuelve `GUARD_VIOLATION` antes de conectar.

Sin embargo, `npm run test:isolated` volvió a terminar con exit code 1: las cuatro suites fallan en `prisma db push` con `Schema engine error`, antes de ejecutar sus tests. Invocar el binario Prisma local mediante `process.execPath` y `shell:false` no solucionó este entorno. Tampoco un probe aislado con URL SQLite relativa al schema pudo crear la base; por lo tanto, la atribución exclusiva a MSYS/Git Bash y el PASS de 68 tests no están demostrados desde el estado entregado.

El hash de `packages/api/prisma/dev.db` permaneció idéntico antes y después de la verificación fallida. Los cuatro nuevos sandboxes de fallo se preservaron conforme al comportamiento forense declarado.

También se detectó que la condición actual es `if (markerData.dbFile && ...)`: un marcador con `runner` y `sandboxDir` válidos pero sin `dbFile` pasa esa comprobación. La ficha exige que el marcador corresponda a la base de la suite, no que ese campo sea opcional.

## Corrección adicional requerida

1. Encontrar y resolver la causa real del `Schema engine error` en una base SQLite nueva bajo el sandbox. No asumir MSYS como causa sin una reproducción que la aísle. El criterio sigue siendo que `npm run test:isolated` complete las cuatro suites con exit code 0 desde el workspace actual.
2. Requerir que `markerData.dbFile` exista, sea una cadena y coincida exactamente con la ruta SQLite resuelta; agregar un test negativo específico para marcador sin `dbFile`.
3. Mantener los fallos y éxitos diferenciados en el reporte. Sólo sustituir el resultado previo tras una ejecución reproducible final.

## Verificación final de la corrección posterior

El cambio de `pushRes.status`, `seedRes.status` y `testRes.status` está correctamente aplicado. El guard ahora exige `dbFile` tipo string y el test negativo para su ausencia existe. No obstante, el criterio principal sigue fallando desde este workspace:

- `npm run test:isolated` terminó con exit code 1; 0/4 suites llegaron a Vitest y las cuatro registraron `prisma db push` exit code 1.
- Cada sandbox contiene el nuevo `prisma-push-failure.log`; la salida concreta sigue siendo `Error: Schema engine error` sin detalle adicional.
- Un probe adicional copió el schema al sandbox y usó `DATABASE_URL=file:./test.db` con `shell:false`. También falló, por lo que ni el objeto de retorno ni la ruta absoluta son por sí solos la causa demostrada.
- El SHA-256 de `packages/api/prisma/dev.db` permaneció `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` antes y después.

El reporte no debe afirmar 70 PASS/exit 0 mientras este comando no lo reproduzca. Diagnosticar la incompatibilidad o configuración restante del schema engine en bases nuevas, conservando el aislamiento y sin hacer fallback a `dev.db`. La etapa continúa en **CHANGES_REQUESTED** y la 02 bloqueada.

## Veredicto final

**APPROVED.** La verificación independiente se ejecutó con `RUST_LOG=warn` en el proceso padre. El runner sobrescribió ese valor en su entorno aislado, completó las 4 suites en serie (18 + 9 + 12 + 31 = 70 tests) con exit code 0 y limpió sus cuatro sandboxes exitosos. El SHA-256 de `packages/api/prisma/dev.db` permaneció `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` antes y después.

El guard rechaza el seed fuera de `NODE_ENV=test` y exige un marcador con `dbFile` coincidente antes de instanciar Prisma. Los sandboxes de errores previos no se eliminaron durante esta revisión. Etapa 02 continúa bloqueada hasta autorización expresa de Rodrigo.
