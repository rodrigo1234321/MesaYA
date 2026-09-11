# Protocolo de construcción del producto base

## Principio

Se construye una plataforma versionada con una release base y, cuando el negocio lo requiere, overrides aislados por restaurante. Cada cambio de la base debe funcionar en la instancia de referencia, en una instancia vacía y en una instancia con configuración distinta; cada override debe quedar limitado a su local y tener rollback propio.

## Flujo de una etapa

1. Confirmar `READY` y predecesora `APPROVED`.
2. Inventariar cambios existentes y abrir rama `codex/` o worktree acordado.
3. Cambiar la etapa a `IN_PROGRESS`.
4. Verificar contratos y datos antes de editar.
5. Implementar una unidad revisable; subdividir si crece materialmente.
6. Ejecutar pruebas locales y PostgreSQL desechable.
7. Verificar dos configuraciones cuando el cambio sea configurable.
8. Completar reporte y dejar `NEEDS_REVIEW`.
9. Detenerse hasta `APPROVED` o `CHANGES_REQUESTED`.

## Reglas de instancias

- No usar una base de cliente o referencia para tests automatizados.
- No ejecutar seed, reset, `db push` o migración experimental contra una conexión habitual.
- Preview compila y prueba; migración remota es un paso separado con aprobación.
- No copiar secretos entre restaurantes.
- No codificar slugs, URLs, Place IDs, teléfonos, precios ni branding de un local en el producto.
- No mantener arreglos sólo en Vercel/Supabase sin reflejarlos en código/configuración versionada.
- Toda instalación registra release y schema.
- Todo override registra release padre, rama, commit, responsable y procedimiento de actualización.

## Regla de personalización

Antes de escribir código específico para un local, clasificar el pedido como:

- dato de catálogo;
- branding/tema;
- regla configurable;
- integración mediante adaptador;
- extensión reutilizable;
- cambio del producto base.

Si no encaja, documentar el costo de divergencia y obtener decisión explícita. Un cambio específico de un local puede aprobarse como `LOCAL_OVERRIDE`, pero no se lo presenta como parte de la release base ni se lo replica automáticamente.

## Reporte obligatorio

Cada etapa informa archivos, migraciones, pruebas, configuraciones usadas, evidencia visual, compatibilidad, seguridad, no ejecutado, riesgos y rollback. Una captura prueba apariencia; no prueba persistencia. Un mock financiero no prueba conciliación. Un build no prueba el recorrido.

## Pausas

- **A (03):** arquitectura e instalación reproducible.
- **B (09):** operación central con terminal compartido.
- **C (13):** experiencia, IA y comercial coherentes.
- **D (18):** módulos avanzados completos.
- **21:** certificación de release candidata.
- **22:** aprobación de la fábrica de instalaciones.

Ninguna aprobación técnica autoriza crear cuentas, proyectos, dominios, procesar dinero ni desplegar a un cliente sin autorización específica.
