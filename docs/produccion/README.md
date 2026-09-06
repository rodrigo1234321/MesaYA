# MesaYA — preparación para producción

Fecha de evaluación: 2026-09-05. Proyecto evaluado: `Projects/mdpmesasvivas`.

**Decisión actual: preparar staging; NO-GO para producción con clientes reales.** GitHub y CI ya están verificados. Quedan correcciones de login Admin, bootstrap, contrato de PIN, dependencias y verificaciones cloud.

1. Leer [la revisión cloud actual y su veredicto](REVISION-CLOUD-2026-09-05/README.md).
2. Cerrar [los hallazgos y criterios de aceptación](REVISION-CLOUD-2026-09-05/01-HALLAZGOS.md).
3. Seguir [la puesta en servicio corregida](REVISION-CLOUD-2026-09-05/02-PUESTA-EN-SERVICIO.md) y registrar [las pruebas y puertas de salida](REVISION-CLOUD-2026-09-05/03-PRUEBAS-Y-EVIDENCIA.md).
4. Aplicar también el [runbook del piloto](../RUNBOOK_PILOTO.md) antes de atender un local real.

La arquitectura propuesta conserva el producto existente: repositorio GitHub, una API Node/Fastify en Vercel, tres frontends Vite en Vercel y PostgreSQL en Supabase. No hace falta reconstruirlo ni completar pagos digitales para ensayar el servicio de salón.

La [auditoría previa](AUDITORIA-2026-09-05.md) se conserva como historial; sus observaciones sobre Git y CI quedaron superadas por la nueva evidencia. Esta entrega documenta la revisión y no modifica código de aplicación ni infraestructura remota. Los pendientes no deben confundirse con trabajo ya realizado.
