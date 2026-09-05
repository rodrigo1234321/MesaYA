# Etapa 00 — Inventario y punto de recuperación

Bloque: Fundación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: pedido de Rodrigo y estado READY.
Entrega: `docs/implementacion/reportes/ETAPA-00.md` (NUEVO al ejecutar).

## Misión

Inventario y punto de recuperación. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `package.json`
- `.gitignore`
- `.env.example`
- `docs/ARCHITECTURE.md`

Leer sólo lo necesario para inventariar. En esta ficha únicamente se crean el manifiesto y el reporte, y se actualiza CONTROL. No ejecutar pruebas ni modificar código, consumidores, schema o migraciones.

## Checklist en orden

1. [ ] Confirmar la ruta real y ejecutar git rev-parse --show-toplevel desde el proyecto. Si devuelve C:/Users/rodri, registrar que NO es un repositorio propio; no ejecutar git add, commit, clean ni reset allí.
2. [ ] Inventariar versiones Node/npm, scripts y archivos fuente; guardar un manifiesto SHA-256 de fuentes/configuración sin valores secretos en docs/implementacion/evidencia/00-baseline.json (NUEVO). Excluir .env, bases, node_modules, dist, capturas y repomix.
3. [ ] Registrar cambios preexistentes y estrategia de recuperación en el reporte. Si no hay Git propio, proponer su inicialización local para revisión, sin crear repositorios/remotos ni copiar el proyecto en esta ficha.
4. [ ] Contrastar README, PROYECTO_MAESTRO y plan técnico sólo en los apartados del piloto; anotar implementado/parcial/pendiente con archivo fuente. No ejecutar seed ni pruebas.

## Aceptación verificable

- [ ] Manifiesto reproducible y sin secretos ni datos de clientes.
- [ ] La ruta Git efectiva queda explícita y no se modifica el repositorio padre.
- [ ] No se cambia código de aplicación ni bases.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.

## Fuera de alcance

No instalar dependencias, iniciar servicios, inicializar Git ni corregir código.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 00».
