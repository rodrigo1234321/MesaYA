# Fauno: instalación única y estabilidad

## Objetivo autorizado

Conservar la carta y funciones actuales de Fauno, con enlaces de mesas, un staff y un admin; corregir latencia y pérdida de sesión y retirar la operación duplicada sin perder datos. Sin Docker, facturación ni proyectos nuevos.

## Baseline verificado (2026-09-24 UTC)

- Checkout canónico `main`, SHA inicial `11ad039798d52262a6f9421fb388b384e0d5a98f`. Documentos sin seguimiento ajenos preservados.
- Supabase Fauno: `zptpjdjvunyiytiopfgd`, `sa-east-1`; tenant `bf42d7b3-a01c-49d5-b099-6ebc3b0eb8d4`.
- API Fauno: `prj_cPUkJFneEYrUP0hvOgEOe1ssqRPW`, deployment `dpl_6vVydZ3DaaMuhutrt1TCQ4XEFGC1`, región `iad1`, fuente CLI `70b60dbc4d35194d5ea46f0f81730cece31617e7` (gitSource ausente).
- Cliente `prj_fam5JBiRiP0krL3ssH5e6vY5Qpxx`; staff `prj_JtU0iQNYGR8U2xXBmcJWHhV6gALy`; admin `prj_9032FFCVRIGwLnBkwA2NVlZVAZXn`.
- Hay **8 mesas**, 1–4 salón, 5–8 terraza, capacidad 4. Mesa 1 ocupada al inicio. No crear duplicadas ni modificar su sesión para las pruebas.
- Primera muestra desde PowerShell: admin login 3475 ms, listado de mesas 2243 ms, health 882 ms. Son muestras de diagnóstico, no percentiles.
- Existe otra instalación `mesaya-piloto` en API/cliente/staff/admin históricos. Inventariar dependencias y recuperación antes de retirar su operación; no borrar sus datos.

## Fichas y responsables

1. Arquitecto: identidad cloud, mediciones y configuración Vercel cercana a Supabase (`gru1`). Preservar aliases Fauno.
2. Luna sesiones: errores de red no deben borrar credenciales; 401 debe mostrar reautenticación; 403 de permisos no debe expulsar al operador; evitar consultas con slug vacío.
3. Luna polling: tiempo máximo de petición, cancelación, reintento y descarte de respuestas viejas con tests de regresión.
4. Luna API: eliminar consultas por cada cuenta en el snapshot del mozo con lecturas agrupadas y equivalencia de cálculos.
5. Integrador/revisor: pruebas enfocadas, builds secuenciales, revisión independiente, despliegues y mediciones comparables. Verificar 8 enlaces, dos clientes en una mesa de prueba, carrito, cuenta/split y visibilidad de mozo.
6. Consolidación: publicar un mapa único de enlaces; redirigir accesos históricos a Fauno y suspender operación duplicada reversible después de verificar recuperación y dependencias. No borrar proyectos/base como atajo.

## Contrato para agentes y prompts

Cada agente recibe una ficha con un único dueño de archivos, una pregunta verificable y un límite de mutación. El prompt debe exigir: leer el estado actual antes de editar, no tocar secretos ni otra instalación, no crear proyectos, no cambiar datos reales sin una prueba previa, ejecutar una prueba enfocada y devolver archivos, SHA, resultado y pendientes. El revisor recibe el diff y la evidencia, no el resumen del implementador, y debe poder rechazar la ficha por una regresión de aislamiento, autenticación, latencia o contabilidad.

Las fichas de producción se ejecutan en este orden: medición → cambio pequeño → pruebas locales → preview/deploy → smoke autenticado → revisión independiente → promoción. Si un agente queda sin cuota, el integrador continúa con el mismo contrato y deja la tarea marcada como no ejecutada; no se presenta una respuesta del agente como evidencia.

## Cierre verificado después de la implementación

- Código en `main` actualizado a `c6b489d` y publicado en `origin/main`.
- API Fauno: deployment `dpl_AbxNf623BSWnhtavXyhQjfWwfqow`, fuente de código `1f79ff7`, estado `Ready`, región `gru1`, alias de producción activo.
- Staff: deployment `dpl_EJzoUc3siV1oedDu6AwtoSR3Pmg5`, fuente `c6b489d`, estado `Ready`, alias de producción activo.
- Admin: deployment `dpl_EKHfwt5NHrHVhTgbXg5NczUZe3cv`, estado `Ready`, alias de producción activo. Cliente: deployment `dpl_BwSGTHWvcaaSXQPdTKqmLASPmg36`, estado `Ready`.
- Smoke autenticado repetido contra producción: admin y staff HTTP 200; mesas, plano y workspace HTTP 200; muestras recientes entre aproximadamente 100 y 630 ms por petición desde este entorno.
- Flujo real controlado en Mesa 8 (sin tocar Mesa 1): dos clientes agregaron productos con nombres de participante distintos al mismo carrito, la comanda se envió y el mozo la validó; la cuenta apareció en Caja/Servicio; se liquidó en dos partes iguales de 520000 centavos, el saldo terminó en cero y repetir la segunda clave devolvió replay idempotente HTTP 200. La sesión se cerró y la mesa se devolvió a `AVAILABLE`.
- El flujo anterior usa efectivo presencial de prueba; no se ejecutaron cobros digitales ni se inventaron precios. Los ítems elegidos fueron productos disponibles de la carta real.

## Criterios de cierre

- Staff y admin mantienen sesión ante fallos transitorios y se recuperan; autenticación inválida pide PIN.
- Ocho mesas accesibles y administrables; carta actual preservada.
- API, clientes y base corresponden a una única instalación operativa Fauno.
- Evidencia de pruebas reales, latencia antes/después, SHA, deploys y recuperación.
- QR/NFC físicos, dispositivos y red del local no se consideran verificados por pruebas de escritorio.

## Referencias técnicas

- [Regiones de funciones Vercel](https://vercel.com/docs/functions/configuring-functions/region): ubicar funciones cerca de la base; Hobby admite una región.
- SSE está deshabilitado explícitamente en esta aplicación; los paneles usan polling HTTP autoritativo.
