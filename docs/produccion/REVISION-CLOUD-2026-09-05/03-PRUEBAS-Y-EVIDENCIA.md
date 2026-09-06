# Pruebas, evidencia y puertas de salida

Fecha: 2026-09-05. Commit: `1f461c6bb26d524a041554d008ebc976c6169d5a`. Evidencia auxiliar local: `.tmp/cloud-readiness-20260905/` (ignorada por Git). Los resultados resumidos aquí sí quedan documentados.

## A. Comprobaciones realizadas

| Comprobación | Resultado | Alcance |
|---|---|---|
| `git status --short` inicial | Limpio | Copia local del proyecto. |
| `git log -1` y `git ls-remote origin HEAD` | Mismo SHA | Se revisó el código realmente publicado. |
| GitHub Actions run `33945489084` | `completed / success` | Consulta read-only de run y jobs. |
| Job `build-and-test` | Todos los pasos sustantivos success | npm ci, seis workspaces, paridad, rutas y runner SQLite. |
| Job `postgres` | Todos los pasos sustantivos success | npm ci, build PG, smoke con migraciones y prueba de plano atómico. |
| `node scripts/check-route-matrix.mjs` | PASS: 76 rutas | Clasificación estática; no prueba cada permiso dinámico. |
| `node scripts/sync_supabase_schema.js --check` | PASS | Paridad de fuentes, no estado de una DB remota. |
| Auditoría npm de producción | 4 paquetes afectados: 1 crítico, 2 altos, 1 moderado | Consulta nueva al registro; no se actualizaron paquetes. |
| Auditoría npm completa | 6 paquetes afectados: 1 crítico, 3 altos, 2 moderados | Incluye herramientas de desarrollo/build. |
| Pruebas enfocadas finales | **4 archivos, 13/13 PASS**, 11,08 s | auth-policy, environment-security, postgres-schema-parity, route-matrix-guard. |
| Probe de bootstrap/CORS con mocks | 4 comportamientos defectuosos reproducidos | Reset por omisión, PIN en logs, PIN alfabético y wildcard sin coincidencia. Sin conexión DB. |

La [CI remota](https://github.com/rodrigo1234321/MesaYA/actions/runs/33945489084) se verificó por estado de pasos; no se extrajeron totales de tests de sus logs ni se volvió a ejecutar la suite completa localmente. El smoke PG de CI usa PostgreSQL 16 desechable, no Supabase.

Runtime local: Node 24.17.0, npm 12.0.2. CI declara Node 22. El resultado final de 13 pruebas se obtuvo con un `DATABASE_URL` SQLite temporal explícito, `NODE_ENV=test`, un worker y timeout de 30 s. Esas cuatro suites no requirieron poblar una base real. No equivale a instalación limpia nueva local; la instalación limpia está acreditada por CI.

Archivos auxiliares: `ci-jobs.json`, `npm-audit-production.json`, `npm-audit-all.json`, `safe-tests.log`, `focused-tests.log` y `probe.cjs`. La probe transpila el código actual e inyecta implementaciones falsas de Prisma/bcrypt; prueba el control de flujo del script, no la persistencia/transacción real.

## B. Incidencia de la primera ejecución local

La primera selección de pruebas incluyó `polling-clients-reconnect.test.ts` invocando Vitest directamente. Esa suite tiene un `beforeAll` que crea fixtures y depende del runner aislado. Al faltar una URL temporal explícita, tomó la base SQLite de desarrollo; creó un restaurante ficticio y falló al crear el turno porque esa base no tenía la columna `activeKey`.

Se identificó **un único registro nuevo** por ID, slug con timestamp y fecha exacta del intento, y se eliminó exclusivamente ese registro (`removedOwnFixture: 1`). No se ejecutó reset, migración ni borrado general de la base. No hay hash previo para afirmar identidad byte a byte del archivo SQLite; sí se retiró el efecto lógico identificado. El fallo de schema no se considera un fallo reproducido en la base PostgreSQL de CI ni en Supabase.

En esa misma ejecución, validación de schemas excedió el timeout por defecto de 5 s. Resultado inicial: 2 archivos fallidos/2 aprobados; 1 test fallido, 7 aprobados y 13 omitidos por fallo de setup. La validación de schemas se repitió dentro de las cuatro suites seguras con 30 s y aprobó. La suite de reconexión **no se reejecutó localmente**; su cobertura actual se apoya en el runner de CI, no en ese intento fallido.

Regla para la próxima ejecución: suites que crean datos sólo mediante runner aislado o una base explícitamente desechable. En Windows `test-isolated.mjs` y `build.mjs` exigen un supervisor Windows Job externo; no basta poner `MESAYA_BOUNDED_JOB=1`. No saltarse esa protección ni usar una DB local antigua para probar migraciones por conveniencia.

## C. Pruebas a agregar al implementar cambios

| ID | Prueba necesaria | Resultado de aceptación |
|---|---|---|
| T01 | Admin UI con navegador limpio y PIN propio | Login real, rol MANAGER, sin intento automático de demo; abrir/cerrar turno. |
| T02 | Logout, JWT vencido y cambio de restaurante | Regreso a login, sin snapshots anteriores ni acceso cruzado. |
| T03 | Bootstrap PG vacío/repetición/rotación | Datos correctos; repetición conserva PIN e IDs; rotación sólo explícita. |
| T04 | Bootstrap entradas inválidas | PIN ausente/alfabético, slug vacío, mesas inválidas fallan antes de escribir; logs sin secretos. |
| T05 | PIN UI/backend y duplicados entre roles | Toda longitud permitida puede introducirse; identidad inequívoca. |
| T06 | Dependencias actualizadas | CI completa y auditoría sin altos/críticos pendientes de tratamiento. |
| T07 | Admin/Staff login malformado | Null, número, array y textos excesivos dan 400; no 500 ni información interna. |
| T08 | Handler Node verdadero | Invocar exportación con req/res reales; verificar GET, POST JSON, query y OPTIONS, no sólo `app.inject`. |
| T09 | Generador QR y configuración ausente | URL del Comensal y slug correctos; producción falla claramente si falta dominio. |

## D. Ensayo sobre PostgreSQL desechable

1. Crear una DB de tests separada; nunca pasar URLs productivas al runner PG.
2. Migrar las cuatro revisiones sobre DB vacía y repetir `migrate deploy` sin cambios pendientes.
3. Generar cliente PG y ejecutar build/smoke del repo. Ampliar cobertura de concurrencia PG a llamados, sesiones, turnos, rate limits y pedidos, además de plano.
4. Ejecutar bootstrap corregido y su repetición; validar cantidades, hashes conservados y ausencia de turnos abiertos.
5. Simular dos clientes/instancias con escrituras concurrentes; comprobar unicidad de turno/sesión/llamado, conflictos controlados y ausencia de duplicados.
6. Revisar diferencias entre PG directo de CI y transaction pooler real: permisos, timeouts, prepared statements y conexiones.

El runner `scripts/test-postgres.mjs <ruta>` migra y restaura el cliente a SQLite al finalizar. Generar PG nuevamente antes de otra herramienta que lo necesite.

## E. Prueba cloud: los cuatro proyectos y el recorrido completo

Todas las pruebas de escritura se realizan con datos ficticios del entorno de ensayo. Registrar request IDs sin tokens/PIN.

| Área | Procedimiento | Aceptación |
|---|---|---|
| Build limpio | Desplegar los cuatro proyectos sin caché previa | Backend empaqueta Prisma; apps resuelven shared; assets con MIME correcto. |
| Salud | GET `/health` y `/v1/health`, arranque frío/caliente | 200, `status: ok`, `database: connected`; respuesta degradada controlada ante DB caída. |
| Routing | GET con query, POST JSON y OPTIONS por `/v1` | Cuerpo/query íntegros; status/error JSON, sin HTML de fallback. |
| CORS | Cada origen exacto y uno ajeno | Preflight y respuesta autorizados para los tres dominios; origen ajeno sin permiso CORS. |
| Autorización | Token inválido, WAITER en Admin, tenant A hacia B | 401/403/404 según contrato; ninguna lectura/escritura cruzada. |
| Supabase | Data API apagada y centinelas ficticios | Sin acceso público a tablas/rutinas; Prisma operativo. No basta consultar una tabla vacía. |
| Apertura | Login del encargado y varios mozos detrás del Wi-Fi del local | Apertura sin bloqueo por logins legítimos; comprobar política de rate limit. |
| QR | Generar/copiar/escanear desde Admin con teléfono | Abre Comensal HTTPS, local y mesa correctos, sin 5173 ni dominio Admin. |
| Servicio | Llamar mozo, atender, pedir cuenta, pedir/cocina, cobro manual | Estados consistentes en los paneles; ningún duplicado por reintento. |
| Cierre | Cerrar mesa y turno, reutilizar URL/token anterior | Revocación según contrato; no genera nuevos llamados sobre sesión cerrada. |
| Red | Wi-Fi a datos, offline/online, foco, teléfono bloqueado | Reconexión visible y consistente; documentar limitaciones de audio/background. |
| Dependencia externa | QR gráfico/carta si un proveedor externo falla | Error visible o alternativa operativa; no bloqueo silencioso del salón. |
| Recuperación | Falla temporal DB/API y retorno | Sin escritura duplicada ni necesidad de reset de datos. |

No basta probar con curl: CORS, entrada de PIN, audio, QR y navegación requieren navegador/dispositivo. No se realizó ese recorrido cloud en esta revisión.

## F. Carga y costos: medir antes de escalar

Los hooks Staff y plano Admin configuran polling cada 3 s. Estimación propia para un único endpoint activo por pestaña, sin backoff: `pestañas × 3600 / 3` solicitudes por hora. Diez pestañas implican unas 12.000 solicitudes/hora sólo de ese polling; no es el tráfico total ni una factura estimada.

Ensayar carga representativa del local (cantidad de mesas, dispositivos y horas acordadas), luego una ráfaga mayor. Medir p50/p95/p99 de API, edad del snapshot, errores, 429, conexiones y espera del pool, CPU/memoria y consumo Vercel/Supabase. Evitar cargas contra producción o terceros ajenos al entorno.

Umbrales iniciales propuestos, a ratificar antes del piloto: cero pérdidas/duplicados y cero cruces de tenant; p95 de acciones interactivas menor a 1 s en régimen normal; visibilidad de llamados en menos de 6 s para al menos 95% de casos con red estable. Registrar por separado arranque frío y recuperación. Son objetivos de prueba, **no SLA ni resultados medidos**.

## G. Recuperación y decisión final

- [ ] C01–C06 cerrados con commit nuevo y CI verde.
- [ ] Data API/permisos y aislamiento de ambientes acreditados.
- [ ] Build Vercel y handler real aprobados.
- [ ] Recorrido completo Admin/Staff/Comensal con PIN propio y QR físico de prueba.
- [ ] Pruebas de concurrencia y carga dentro de los límites acordados.
- [ ] Backup restaurado en otra DB; verificar filas, relaciones, login, turnos y pedidos.
- [ ] RPO/RTO y retención definidos y medidos; claves de cifrado recuperables de forma segura.
- [ ] Rollback de código ensayado con compatibilidad de schema; no confundirlo con rollback SQL.
- [ ] Responsables, canal de incidentes, ventana y procedimiento manual definidos.
- [ ] Commit, deployment IDs de los cuatro proyectos y evidencias finales archivados.

**Estado de estas puertas: pendientes al cerrar esta investigación.** Hasta completarlas, no declarar listo para operación real. Tras aprobarlas, el paso adecuado es un piloto limitado; ampliar sólo después de observarlo.
