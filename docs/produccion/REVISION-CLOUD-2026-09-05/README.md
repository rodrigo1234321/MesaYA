# MesaYA: decisión sobre Vercel + Supabase

Fecha: 2026-09-05. Commit auditado: `1f461c6bb26d524a041554d008ebc976c6169d5a`.

**No está listo para operar con clientes reales ni es correcto afirmar que no falta código.** La arquitectura permite avanzar a Vercel y Supabase, pero quedan correcciones concretas de acceso, bootstrap y dependencias, además de pruebas cloud. No hace falta reescribir el producto ni cambiar de plataforma para resolver lo encontrado.

## Decisión por entorno

| Objetivo | Decisión | Condición |
|---|---|---|
| Investigar y preparar configuración cloud | GO | Puede hacerse ahora. |
| Ensayo técnico privado con datos ficticios | GO condicionado | Aislamiento completo, Data API cerrada y control de acceso al entorno; no presentarlo como piloto funcional aprobado. |
| Staging abierto para probar todo el negocio | NO-GO hoy | Cerrar C01–C05 y verificar C06–C08 del informe. |
| Piloto con un restaurante real | NO-GO hoy | Lo anterior, restauración demostrada y recorrido real de dispositivos. |
| Producción comercial amplia | NO-GO | Obtener primero evidencia de piloto, carga, recuperación y operación. |

## Los puntos que cambian la conclusión anterior

1. **Admin no tiene un login para un PIN propio.** `App.tsx` intenta automáticamente `9999`. El formulario de alta pública no sustituye un login y esa alta está deshabilitada por defecto.
2. **El bootstrap restablece el PIN de un gerente existente**, incluso sin solicitar rotación; usa `9999` por defecto, imprime el PIN y acepta letras. Se reprodujo con dependencias simuladas, sin base de datos.
3. **Staff sólo permite introducir cuatro dígitos**, mientras la creación de personal admite hasta seis y bootstrap hasta ocho.
4. **La auditoría de dependencias sigue marcando cuatro paquetes de producción afectados:** uno crítico, dos altos y uno moderado. No son cuatro exploits demostrados, pero tampoco están resueltos.
5. **Faltan instrucciones esenciales:** `VITE_CLIENT_WEB_URL` en Admin, CORS con dominios exactos, generación explícita de Prisma PostgreSQL antes del bootstrap y pruebas sobre el artefacto Vercel.

## Lo que sí quedó acreditado

- La raíz Git es ahora el proyecto y el árbol estaba limpio al comenzar. El HEAD local coincide con el remoto de `rodrigo1234321/MesaYA`.
- La [CI del commit](https://github.com/rodrigo1234321/MesaYA/actions/runs/33945489084) terminó con éxito: instalación limpia, seis workspaces, matriz de rutas, paridad, suite SQLite y job PostgreSQL con build, migraciones, smoke y guardado atómico del plano.
- La revisión local volvió a aprobar 76 rutas clasificadas y paridad de schemas. Una ejecución enfocada terminó con **13/13 pruebas aprobadas**.
- El login Staff ya comparte el bucket persistido con Admin. El problema de ausencia total de limitación mencionado en la auditoría anterior fue corregido; quedan políticas/IP por verificar.
- Admin ya recibe el slug y contempla un dominio explícito para QR. Falta exigir/configurar ese dominio y recorrer el QR final.

## Cómo leer el dossier

| Archivo | Para qué sirve |
|---|---|
| [01-HALLAZGOS.md](01-HALLAZGOS.md) | Cambios a implementar, evidencias, severidad y criterios de aceptación. |
| [02-PUESTA-EN-SERVICIO.md](02-PUESTA-EN-SERVICIO.md) | Configuración corregida de los cuatro proyectos, base y región. |
| [03-PRUEBAS-Y-EVIDENCIA.md](03-PRUEBAS-Y-EVIDENCIA.md) | Resultados reales, límites, incidencia local y pruebas pendientes con GO/NO-GO. |

Esta revisión actualiza el estado, sin borrar el historial de `AUDITORIA-2026-09-05.md`: sus observaciones sobre raíz Git y CI sin ejecutar ya quedaron superadas; sus avisos de dependencias siguen vigentes. Se conservaron los archivos de código y workflows; esta entrega documenta la investigación y el trabajo pendiente. No se desplegó, migró, creó infraestructura ni publicó cambios en GitHub.

No se accedió a los paneles privados de Vercel/Supabase ni se verificó una base remota. La CI verde no demuestra aislamiento Data API, empaquetado Vercel, restauración ni funcionamiento en teléfonos reales.
