# Evidencia de entrada y patrones útiles

## Qué corregir del diagnóstico antes de programar

Se leyó el archivo pegado por Rodrigo, los informes en `docs/auditoria-integral/20260914-7bcddf6`, el historial de Git y código del candidato. La carpeta `evidencia/` no contenía archivos al revisar. En el transcript no se identificaron ejecuciones de la suite ni recorridos de navegador que sustenten los 616 PASS o tiempos/clics declarados. Esto no invalida los riesgos estáticos, pero impide heredar una certificación dinámica.

| Afirmación | Tratamiento en este plan |
|---|---|
| H01 schema sin migración | Brecha estática verificada; reproducir mediante runner PG del proyecto, no copiar el comando/SQL del informe |
| H02 dos recibos siempre fallan con 503 | No demostrado. El código tiene cuatro intentos y en el último P2002 hace throw; no coincide con «tres intentos y siempre 503». Medir concurrencia y error efectivo; corregir causa comprobada |
| H03 bloqueo permanente | Riesgo condicionado a cambio de secreto. Definir rotación y recuperación; no afirmar irreversibilidad |
| H05 mozo no puede cobrar | Restricción actual confirmada, pero defecto de producto sólo si la política del local necesita delegarlo. Añadir capacidad concreta, no elevar rol completo |
| H06 cocina inexistente | Falta montaje dedicado de KDS legado; Servicio tiene información de preparación. Verificar acciones reales y canal físico. No concluir inexistencia de toda función de cocina |
| H09 ventas y cobros en días distintos | Pueden ser conceptos correctos. Definir ventas devengadas, caja por fecha de pago y jornada/turno antes de cambiar timestamps |
| H12 admin borró Ventas | El worktree parte de una base antigua. Ausencia allí no demuestra borrado ni pérdida en la release. Comparar y portar selectivamente |
| 28 controles/3–4 clics/inviabilidad de PC | Hipótesis UX a medir. Contadores no son necesariamente interactivos; mouse puede funcionar bien. No certificar peor ergonomía sólo por tipo de equipo |
| Oráculo del plan anterior | El plan original contenía un error de $1. El valor correcto es 2×1.234.567 + 3×123.456 = 2.839.502 centavos ($28.395,02); menos una bebida = 2.716.046 ($27.160,46). El informe usa esos valores correctos, pero no acredita ejecución contable |
| Rama ausente del remoto → ningún deployment | Sólo prueba ausencia de esa rama remota. Un despliegue manual puede existir; verificar deployment ID/SHA antes de afirmar ausencia |

No reescribir la auditoría histórica. Crear en E00 una clasificación adicional: confirmado estático, reproducido, descartado, decisión de producto o pendiente. Cada uno de los 15 H conserva trazabilidad incluso si se descarta su formulación.

## Competidores investigados en documentación oficial

Consulta: 2026-09-14. No se probó su software ni se compararon precios, disponibilidad comercial o rendimiento. Los patrones siguientes son inferencias de diseño para MesaYA, no evidencia de que éste ya sea igual o superior.

| Fuente primaria | Capacidad documentada | Decisión para MesaYA |
|---|---|---|
| [Fudo: permisos de usuario](https://soporte.fu.do/es/articles/11730992-funcion-de-permisos-de-usuario) | Permisos específicos para cobrar mesa, cerrar ventas y otras operaciones | Separar cobro, cierre y ajustes; evitar MANAGER como permiso universal |
| [Toast: opciones de interfaz](https://doc.toasttab.com/doc/platformguide/adminUiOptionsReference.html) | Configuración de botones y opciones de pedido según contexto | Mostrar las opciones necesarias al entrar a la tarea; no todos los controles en la portada |
| [Lightspeed Restaurant K-Series: usuarios y plano](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804579349-Managing-users-and-floor-plans) | Roles/permisos de usuarios y mesas/sectores reflejando el local | Identidad trazable y acceso rápido por mesa; mapa como vista alternativa, no editor obligado para el mozo |
| [Square KDS: completar y recuperar órdenes](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds) | Completar items/tickets y recuperar los terminados por error | Separar preparado de entregado, incluir recuperación segura y probar su alcance entre puestos |

**Síntesis propia:** MesaYA ya tiene una cola de trabajo que conviene conservar. Mejorarla con una portada breve, detalle de mesa progresivo, autoría clara, avisos persistentes y correcciones reversibles donde el dominio lo permita. No copiar una suite POS completa ni introducir split, reservas, pagos digitales o impresoras propietarias para cerrar este trabajo.

La investigación no justifica un diseño «mejor» por sí sola. E02 y E23 deben demostrar que la propuesta mejora el desempeño de personas en el local.
