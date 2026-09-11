# Arquitectura de instancias por restaurante

## Unidad de despliegue

Cada restaurante se trata como una instancia independiente. Una instancia contiene:

- Supabase/PostgreSQL exclusivo;
- proyecto Vercel de API;
- proyecto Vercel del comensal;
- proyecto Vercel de salón/staff;
- proyecto Vercel de administración;
- dominios y CORS explícitos;
- secretos únicos;
- almacenamiento/assets y proveedores externos propios;
- versión del release y de migración instalada.

Aunque comercialmente se hable de “una cuenta de Vercel”, técnicamente el monorepo actual requiere un conjunto coordinado de cuatro proyectos. Podría consolidarse en el futuro, pero no es requisito para obtener aislamiento.

## Fuente única

La release base sigue siendo única, pero un restaurante puede recibir una rama de override aislada cuando necesita una personalización de código. El flujo normal es:

`main -> release candidata -> instancia de referencia -> release estable -> instancias de clientes`

Cuando un local necesita una excepción:

`release estable -> branch override/<instanceKey> -> cuatro despliegues del local`

El override registra siempre su `parentRelease`, `overrideBranch` y `overrideCommit`. No se promueve a otro local sin revisión y no se modifica de forma directa sólo desde Vercel.

Una instalación fija una versión. Las actualizaciones se promueven por versión y nunca por copiar carpetas manualmente.

## Configuración de instancia

Definir un manifiesto validado por `npm run instance:validate`, sin secretos, con al menos:

- identificador y slug;
- dominios de las cuatro aplicaciones;
- zona horaria, moneda, idioma y formato fiscal;
- módulos habilitados y dependencias;
- reglas de pedidos, validación, caja y cierre;
- identidad visual y assets;
- sectores, mesas y capacidad inicial;
- integración de reseñas/WhatsApp/pagos por estado;
- versión de aplicación y schema.
- modo de personalización: `BASE_RELEASE` u `LOCAL_OVERRIDE`;
- release padre y, si aplica, rama/commit de override.

Los secretos se cargan en Supabase/Vercel o un almacén aprobado; no se escriben en el manifiesto ni en Git.

## Single-restaurant mode

El modo de ejecución fija `MESAYA_INSTANCE_RESTAURANT_ID` y `MESAYA_INSTANCE_MODE=SINGLE_RESTAURANT` después del bootstrap. En este modo:

- una base limpia acepta un único restaurante raíz;
- el API deriva el tenant desde la instancia y valida todos los recursos;
- slugs ajenos no permiten enumeración;
- el admin no puede cambiar a otro local inexistente;
- el onboarding público queda fuera; la provisión es administrativa;
- tests A/B de aislamiento se conservan como defensa.

## Provisioning repetible

El repositorio incluye un plan declarativo (`npm run instance:provision:plan`) y un bootstrap idempotente. La aplicación real de recursos sigue siendo una operación externa, pero la secuencia verificable es:

1. preflight de Node, repo, revisión y variables;
2. comprobación de Supabase vacío o baseline explícito;
3. backup/restauración cuando corresponda;
4. migraciones `deploy`, nunca `db push` productivo;
5. creación del restaurante raíz y manager temporal;
6. importación opcional de mesas/carta/branding;
7. creación/configuración de proyectos Vercel;
8. carga de variables sin imprimir secretos;
9. deploy de la misma revisión en los cuatro proyectos;
10. smoke API/UI y recorrido mínimo;
11. rotación obligatoria del PIN inicial;
12. manifiesto de instalación con IDs, URLs y versiones, sin credenciales.

## Actualizaciones

Cada release declara:

- versión mínima/máxima de schema;
- migraciones forward-compatible;
- feature flags nuevas y valor por defecto;
- pasos manuales;
- pruebas de regresión;
- procedimiento de rollback de aplicación;
- estrategia de corrección hacia adelante para datos.

No se revierte una migración destructiva en caliente. Los cambios incompatibles usan expansión, migración de datos, cambio de consumidores y contracción en releases diferentes.

## Personalizaciones

Orden recomendado:

1. configuración del restaurante;
2. tokens/tema y plantillas;
3. reglas declarativas;
4. adaptadores de integración;
5. extensión versionada;
6. override aislado del local, con rama/commit y rollback propios;
7. cambio al producto base cuando la necesidad sea reutilizable.

La copia o rama específica por restaurante no es el modelo normal, pero está permitida para los locales boutique cuando la personalización lo justifica. Debe conservar una release padre, una diferencia auditable y una estrategia de actualización; nunca se considera una instalación anónima o manual.

## Backups y operación

Cada instancia mantiene inventario de responsables, retención de backups, prueba periódica de restauración, estado de integraciones, logs, alertas y release instalado. Un fallo en un restaurante no debe compartir secretos, base ni rollback con otro.
