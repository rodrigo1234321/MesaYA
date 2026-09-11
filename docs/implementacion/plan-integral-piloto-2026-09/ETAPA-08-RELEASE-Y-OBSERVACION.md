# Etapa 08 — Release agrupado y observación

## Objetivo

Promover sólo artefactos compatibles y poder volver al estado anterior con rapidez.

## Estrategia Vercel

1. Mantener los alias estables apuntando al último release aprobado durante el desarrollo.
2. Usar la misma revisión/commit para API, cliente, staff y admin; registrar los cuatro deployment IDs.
3. Ejecutar smoke en Preview con URLs explícitas, nunca asumir que un build Ready implica integración correcta.
4. Promover el tren aprobado como unidad y comprobar CORS/variables entre los alias finales.
5. Conservar el deployment anterior y procedimiento de rollback probado.

## Orden de promoción

1. Migración compatible hacia adelante, si existe.
2. API compatible con clientes anterior y nuevo.
3. Staff y admin.
4. Cliente de mesa.
5. Activación de capability flags del piloto.

## Observación de 48 horas de uso piloto

- health y latencia por endpoint;
- errores 4xx/5xx por flujo y tenant;
- sesiones atascadas;
- llamados pendientes;
- órdenes por estado;
- pagos pendientes/rechazados/conciliados, sólo sandbox hasta decisión posterior;
- webhooks duplicados o inválidos;
- cobertura de eventos de analytics;
- motor y abstenciones del Sommelier.

## Rollback

- Desactivar primero la capability afectada.
- Revertir aliases a los deployments registrados.
- No revertir una migración destructiva; usar cambios compatibles y corrección hacia adelante.
- Reconciliar pagos antes de tocar estados manualmente.
- Documentar causa, impacto, datos afectados y criterio para reintentar.

## Cierre

El piloto queda aprobado sólo si el guion físico pasa, los datos pueden explicarse y no hay funciones habilitadas sin recorrido completo. La habilitación de dinero productivo es una decisión posterior y separada.

