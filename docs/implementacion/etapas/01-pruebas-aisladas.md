# Etapa 01 — Aislar tests y proteger el seed

Bloque: Fundación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 00 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-01.md` (NUEVO al ejecutar).

## Misión

Aislar tests y proteger el seed. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/package.json`
- `packages/api/prisma/seed.ts`
- `packages/api/src/lib/prisma.ts`
- `packages/api/test/full-system-e2e.test.ts`
- `packages/api/test/rtms-fsm-analytics.test.ts`
- `packages/api/test/system-lifecycle.test.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Crear scripts/test-isolated.mjs (NUEVO) y comando raíz test:isolated. Comprobar la carga de dotenv para que nunca reemplace DATABASE_URL explícita del runner.
2. [ ] Crear una SQLite temporal absoluta y exclusiva por archivo/suite, con marcador de propiedad del runner bajo .tmp/qa/<uuid>. Generar cliente y crear schema de test sin apuntar a .env local; ejecutar preparación y tests en serie.
3. [ ] Permitir seed destructivo únicamente con entorno test + autorización explícita del runner + ruta SQLite validada dentro de esa carpeta. Rechazar producción, URL remota y cualquier otra ruta antes del primer deleteMany.
4. [ ] Adaptar los tres archivos existentes para fixtures aisladas. Eliminar dependencia de la demo persistente, conservar assertions funcionales y reportar fallos reales sin debilitarlas.
5. [ ] Limpiar sólo directorios creados por el runner y resueltos dentro de .tmp/qa; en fallo conservar evidencia sin secretos. Registrar comandos exactos en el reporte.

## Aceptación verificable

- [ ] Dos ejecuciones sucesivas usan bases distintas y no alteran la base demo (comparar hash antes/después, sin abrirla para escribir).
- [ ] Una prueba centinela comprueba que seed rechaza una ruta fuera del sandbox ANTES de conectarse/borrar.
- [ ] Runner propaga exit code no-cero si falla una assertion; ningún test usa la conexión del restaurante.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.

## Fuera de alcance

No arreglar módulos, habilitar Supabase ni ejecutar scripts legacy fuera del runner.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 01».
