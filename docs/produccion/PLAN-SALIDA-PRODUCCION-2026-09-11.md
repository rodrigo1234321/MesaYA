# Plan de salida controlada a producción — MesaYA

Fecha: 2026-09-11  
Estado: PLANIFICADO; no ejecutado  
Alcance: consolidación de release, staging Supabase/Vercel, verificación integral, piloto físico y promoción controlada.  

## 1. Resultado buscado

Publicar una única release trazable de MesaYA usando los cuatro proyectos Vercel existentes (`mesa-ya`, `mesa-ya-client`, `mesa-ya-staff`, `mesa-ya-admin`) y una base Supabase PostgreSQL separada por ambiente. La promoción a producción sólo ocurre si el mismo artefacto aprobado en staging supera pruebas de datos, seguridad, navegador, dispositivos físicos, recuperación y operación del local.

## 2. Estado de partida confirmado

- Repositorio: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas`.
- Rama actual: `antigravity/core-capabilities-stage00`, HEAD `0773ca6`.
- Worktree: 166 entradas modificadas/no versionadas; no es apto para desplegar directamente.
- Vercel CLI: instalada y autenticada.
- Proyectos Vercel existentes:
  - API: `mesa-ya`, raíz del repositorio, Fastify, Node 22, `npm run vercel-build`.
  - Cliente: `mesa-ya-client`, raíz `apps/client-web`, Vite, Node 22.
  - Staff: `mesa-ya-staff`, raíz `apps/staff-panel`, Vite, Node 22.
  - Admin: `mesa-ya-admin`, raíz `apps/admin-dashboard`, Vite, Node 22.
- Supabase CLI y herramientas `psql`, `pg_dump`, `pg_restore`: no instaladas.
- Última evidencia local: 65 archivos de pruebas aprobados, 601 tests aprobados y 3 skips explícitos; ventas/cobros 24/24; matriz de 105 rutas y paridad de schemas aprobadas.
- Bloqueos conocidos:
  - `npm run build:api` no puede regenerar Prisma mientras el API local mantiene bloqueado el DLL en Windows.
  - El API local activo usa el árbol anterior y todavía devuelve 404 en las rutas nuevas de ventas.
  - No hay migración, backup/restore ni smoke real en Supabase/Vercel.
  - No hay prueba física de QR/NFC/impresora ni E2E de navegador posterior a los últimos cambios.
  - El rate limit es local por proceso, no distribuido.

## 3. Decisiones e información que debe aportar el responsable del local

No se deben enviar contraseñas, tokens, cadenas de conexión ni PIN por chat o archivos versionados. El responsable inicia sesión directamente en los paneles o carga los secretos en sus gestores.

1. Alcance comercial del primer piloto:
   - confirmar si se acepta registrar cobros manuales por efectivo, débito, crédito y QR;
   - confirmar que el ticket inicial es informativo y no una factura fiscal;
   - si se exige procesamiento de pagos o factura electrónica ARCA, abrir una fase adicional antes del piloto.
2. Datos de la instancia:
   - nombre legal/comercial, slug público, zona horaria, moneda, cantidad y nombres de mesas/sectores;
   - nombre del primer encargado y PIN inicial, cargado por vía segura.
3. Infraestructura:
   - organización y plan de Supabase apto para el piloto;
   - aprobación de una región cercana a la API, a validar según disponibilidad;
   - decisión sobre dominios: URLs `vercel.app` para staging y dominios propios para producción, o dominios propios desde el comienzo;
   - plan Vercel apto para uso comercial.
4. Operación y seguridad:
   - ventana de mantenimiento para detener/reiniciar el API local y ejecutar el build canónico;
   - aceptación de un proveedor para rate limit distribuido, recomendado Redis/Upstash;
   - aceptación de monitoreo de errores y alertas, recomendado Vercel Logs más un servicio de seguimiento de errores;
   - responsable operativo y canal de incidentes.
5. Prueba física:
   - al menos un Android, un iPhone y el dispositivo real de Staff/Admin;
   - modelo de impresora térmica de 80 mm;
   - tags NFC si forman parte del piloto;
   - disponibilidad de 45–60 minutos para ejecutar el guion de aceptación en el local.
6. Recuperación:
   - confirmar retención, RPO y RTO. Propuesta inicial: backup diario externo, retención de 30 días, RPO máximo 24 h y RTO objetivo 4 h para el piloto.

## 4. Plan de ejecución y puertas

### E00 — Congelar y preservar el estado

Acciones:

- inventariar los 166 cambios y separarlos entre release, documentación, evidencia y artefactos locales;
- crear una rama de release fechada sin borrar ni resetear el worktree;
- revisar archivos grandes/no versionados, secretos, bases, capturas y artefactos que no deben entrar al commit;
- producir un commit coherente y una copia recuperable antes de cualquier operación de nube.

Gate E00:

- diff revisado;
- cero secretos o bases locales en Git;
- commit y árbol de release reproducibles;
- CI asociada al commit, no a un worktree sucio.

### E01 — Ventana local y build canónico

Acciones:

- registrar PIDs, estado y URLs actuales;
- detener sólo el API local dentro de la ventana autorizada;
- ejecutar `npm run build:api` para regenerar Prisma y compilar;
- ejecutar builds de shared, client, staff y admin;
- ejecutar suite completa, paridad de schemas, matriz de rutas, seguridad de entorno y auditoría de dependencias;
- iniciar el API actualizado y probar health más las rutas nuevas.

Gate E01:

- `npm run build:api` termina con código 0;
- suites y builds terminan con código 0;
- `/health` y `/v1/health` responden 200;
- las rutas de ventas ya no responden 404 por ausencia del handler;
- no se perdió el estado local necesario.

### E02 — Endurecimiento previo a nube

Acciones:

- resolver vulnerabilidades altas/críticas o documentar una excepción aprobada;
- reemplazar rate limit por una solución distribuida para serverless;
- verificar límites de payload, CORS exacto, roles, tenant isolation, errores, logs y headers;
- asegurar que ninguna variable `VITE_*` contenga secretos;
- dejar onboarding público, rutas demo, IA y pagos digitales incompletos apagados.

Gate E02:

- cero vulnerabilidades altas/críticas sin tratamiento;
- rate limit distribuido probado con dos instancias lógicas;
- pruebas negativas 401/403/404 y cruce de tenant aprobadas;
- escaneo de secretos limpio.

### E03 — Supabase de staging

Acciones:

- crear un proyecto vacío y separado de producción;
- desactivar o restringir Data API porque la aplicación usa Prisma por SQL;
- guardar en un gestor seguro la conexión transaction pooler para runtime y session/direct para migraciones;
- instalar las herramientas PostgreSQL necesarias;
- ejecutar `migrate deploy` sobre staging, nunca `db push`, `migrate dev`, reset ni seed demo;
- ejecutar bootstrap idempotente de la instancia con datos ficticios/controlados;
- repetir migración y bootstrap para probar idempotencia;
- verificar tablas, índices, claves foráneas, aislamiento y permisos.

Gate E03:

- historial completo de migraciones aplicado y sin pendientes;
- Prisma funciona por pooler bajo transacciones reales;
- bootstrap repetible sin cambiar IDs/PIN salvo rotación explícita;
- Data API no expone datos;
- evidencia archivada sin secretos.

### E04 — Backup y restauración antes del deploy

Acciones:

- generar un backup de staging con `pg_dump` o mecanismo equivalente aprobado;
- restaurarlo en otra base aislada;
- validar conteos, relaciones, login, mesas, pedidos, cobros, tickets y documentos asociados;
- medir duración real y documentar RPO/RTO;
- probar que el rollback de código no se confunda con rollback SQL.

Gate E04:

- restauración completa y funcional verificada;
- responsables, retención, ubicación y cifrado definidos;
- procedimiento reproducible sin usar producción como banco de pruebas.

### E05 — Vercel staging con los cuatro proyectos existentes

Acciones:

- auditar variables por proyecto y ambiente sin leer ni imprimir valores;
- configurar Preview/Staging con la base de staging, nunca con producción;
- cargar secretos sólo en API; cargar únicamente URLs públicas en frontends;
- configurar CORS con los tres orígenes HTTPS exactos;
- construir sin caché y desplegar previews de los cuatro proyectos;
- fijar Node 22, lockfile, región compatible y dependencia `packages/shared`;
- registrar commit, deployment IDs y URLs de staging.

Gate E05:

- cuatro despliegues READY del mismo commit;
- API empaqueta Prisma PostgreSQL y conecta a staging;
- assets y rutas SPA funcionan sin fallback incorrecto;
- no hay secretos en bundles, logs ni repositorio.

### E06 — Verificación completa navegador → API → base → interfaz

Historias obligatorias:

- login de Manager y Staff; logout, JWT vencido y cambio de restaurante;
- escaneo QR y, si aplica, NFC desde teléfono físico;
- apertura de mesa, múltiples rondas, reintento/doble submit y recuperación de red;
- pedido de cuenta con efectivo, débito, crédito y QR visible para el mozo;
- propina incluida en el total y opinión enviada en el mismo flujo;
- cantidades `+/-`, carta sin huecos/superposiciones, imágenes, zoom y scroll móvil;
- cobro parcial/mixto, vuelto, ajuste/devolución y responsable correcto;
- reporte diario/mensual/rango por método, propinas y ajustes;
- pre-cuenta y ticket de pago, PDF idéntico en reimpresión y descarga autenticada;
- cierre, `TO_CLEAN`, `Mesa lista` y nueva ocupación sin reutilizar saldo anterior;
- cruce tenant A→B, tokens inválidos y permisos por rol;
- recuperación tras Wi-Fi/datos/offline y dos clientes concurrentes.

Gate E06:

- cero duplicados, pérdidas o cruces de tenant;
- cero errores de consola o requests fallidos sin tratamiento;
- cada acción queda persistida y se refleja en las interfaces correctas;
- evidencia de navegador, API y base correlacionada por caso.

### E07 — Carga, observabilidad y operación

Acciones:

- simular cantidad real de mesas/dispositivos y polling durante una jornada;
- medir p50/p95/p99, errores, 429, conexiones y cold starts;
- configurar alertas de errores, disponibilidad y consumo;
- probar caída/recuperación temporal de API/DB sin duplicados;
- ensayar incidente, rollback Vercel y procedimiento manual del salón.

Gate E07:

- objetivos iniciales: cero pérdida/duplicado/cruce; p95 menor a 1 s en régimen normal; llamados visibles en menos de 6 s en al menos 95 % con red estable;
- logs suficientes para diagnosticar una falla;
- rollback y canal de incidentes ensayados.

### E08 — Piloto limitado y promoción

Acciones:

- etiquetar el commit y congelar cambios;
- hacer una última copia de seguridad;
- obtener aprobación humana del responsable del local;
- promover el mismo artefacto aprobado en staging, sin reconstruirlo;
- habilitar pocas mesas/usuarios y observar de 24 a 72 horas;
- ampliar sólo si no aparecen errores críticos ni inconsistencias contables.

Gate E08:

- GO conjunto técnico y operativo;
- deployment, commit, migraciones, backup y rollback identificados;
- monitoreo activo y responsable disponible;
- alcance fiscal y de pagos entendido por el local.

## 5. Condiciones de NO-GO

No se promueve a producción si ocurre cualquiera de estas condiciones:

- worktree o commit no trazable;
- build, test, migración o restore fallido;
- preview usando base productiva;
- secretos en Git, logs o bundle Vite;
- CORS con wildcard o dominios incorrectos;
- rutas nuevas ausentes, errores de consola o fallos de persistencia;
- duplicados, pérdida de pedidos/cobros o cruce de tenant;
- rate limit no apto para múltiples instancias;
- backup no restaurado;
- QR/NFC/impresora no probados físicamente;
- expectativa de factura electrónica o pago digital real no cubierta por el alcance;
- ausencia de aprobación del responsable del local.

## 6. División de responsabilidades

### Ejecución técnica

- Consolidación Git y release.
- Builds, tests, auditoría, migraciones y configuración.
- Staging Supabase/Vercel y pruebas automatizadas.
- Corrección de defectos encontrados.
- Evidencia, rollback, backup/restore y reporte GO/NO-GO.

### Responsable del local

- Iniciar sesión en Supabase/Vercel cuando sea necesario, sin compartir credenciales.
- Aprobar planes/región/dominos/proveedores con costo.
- Suministrar datos comerciales y PIN por vía segura.
- Confirmar el alcance manual/no fiscal del primer piloto o pedir la ampliación.
- Proveer dispositivos, NFC e impresora y ejecutar el guion físico acompañado.
- Dar el GO operativo final.

## 7. Orden inmediato recomendado

1. Confirmar alcance manual/no fiscal, dominios, dispositivos, impresora y ventana de mantenimiento.
2. Ejecutar E00 y E01; no tocar nube antes de tener release limpia y build API canónico.
3. Resolver E02 y crear staging Supabase.
4. Completar backup/restore E04 antes del primer deploy.
5. Desplegar los cuatro proyectos a staging y ejecutar E06–E07.
6. Realizar piloto limitado y sólo entonces promover a producción.

