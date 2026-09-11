# Reporte de etapa 13 — Propinas, feedback y reseñas

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- La pantalla del comensal permite cero, porcentajes configurados o monto libre de propina; la elección se comunica al llamado de cuenta y la pantalla de caja registra el monto final.
- La valoración privada exige una calificación real de 1 a 5 y comentario opcional; se puede abrir antes de liberar la mesa para respetar el token activo.
- La unicidad de sesión y el manejo de `P2002` convierten envíos concurrentes/reintentos en un 409 sin duplicados.
- El enlace de Google no tiene Place ID histórico en HTML: sólo se crea después de validar el Place ID configurado en la instancia.
- Feedback interno y Google quedaron separados: sin Place ID el feedback privado sigue operativo y Google se oculta; con Place ID válido aparecen ambos.
- Métricas distinguen rating 1–5 de la etiqueta histórica `npsAverage`; no se presenta NPS sin un dato específico de NPS.

## Verificación

| Verificación | Resultado |
|---|---|
| capabilities, configuración y política | 67/67 PASS |
| feedback, expiración, cierre y deduplicación | incluido en suite anterior; PASS |
| build shared/API | PASS |
| build client web | PASS |
| build admin dashboard | PASS; warnings conocidos de comentarios de Zod |

## Límite conocido

La propina seleccionada por el comensal es una sugerencia hasta que el encargado confirma el monto en caja; no se simula un cobro digital. La PAUSA C exige luego una prueba real del recorrido completo con el cierre de mesa y PostgreSQL desechable.
