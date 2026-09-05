# MesaYA — preparación para producción

Fecha de evaluación: 2026-09-05. Proyecto evaluado: `Projects/mdpmesasvivas`.

**Decisión actual: avanzar con la preparación de GitHub y staging; NO-GO para producción con clientes reales.** Las etapas 00–29 están aprobadas en el control histórico, pero esta auditoría detectó pendientes adicionales de seguridad, QR y operación.

1. Leer [el diagnóstico y sus evidencias](AUDITORIA-2026-09-05.md).
2. Ejecutar [el plan de salida, en orden](PLAN-SALIDA.md). Cada punto tiene una condición de cierre.
3. Registrar resultados en [la bitácora de lanzamiento](BITACORA-LANZAMIENTO.md).
4. Aplicar también el [runbook del piloto](../RUNBOOK_PILOTO.md) antes de atender un local real.

La arquitectura propuesta conserva el producto existente: GitHub privado, una API Node/Fastify en Vercel, tres frontends Vite en Vercel y PostgreSQL en Supabase. No hace falta reconstruirlo ni completar pagos digitales para ensayar el servicio de salón.

Esta entrega documenta la revisión. No corrige el código, no inicializa Git, no publica, no crea cuentas ni modifica bases remotas. Los pendientes del plan no deben confundirse con trabajo ya realizado.
