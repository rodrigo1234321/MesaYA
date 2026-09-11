# Reporte de etapa 02 — Modelo single-codebase / single-instance

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- `MESAYA_INSTANCE_MODE` acepta `MULTI_TENANT` o `SINGLE_RESTAURANT`.
- `MESAYA_INSTANCE_RESTAURANT_ID` es obligatorio en modo single-instance.
- El modo y el restaurante raíz forman parte del `EnvironmentConfig`.
- La identidad de staff queda rechazada si no pertenece al restaurante raíz.
- `requireRestaurantAccess` y `requireManagedRestaurant` aplican el límite de instancia.
- El selector de restaurantes se limita al restaurante raíz cuando existe.
- Login admin no puede autenticarse contra otro restaurante en modo single-instance.
- Onboarding público queda rechazado explícitamente en una instancia single-instance.
- Se agregaron pruebas de normalización y validación de modo.

## Verificación

| Verificación | Resultado |
|---|---|
| `environment-security.test.ts` | 7/7 PASS |
| `instance-mode-auth.test.ts` | 2/2 PASS |
| API build directo | PASS |
| `npm run check:routes` | PASS previamente; no se agregaron rutas |

## Límite conocido

Los endpoints públicos de carta/sesión todavía deben adoptar el mismo resolvedor de instancia para eliminar toda posibilidad de enumeración por slug. Se cierra en la etapa 05 junto con QR/sesiones; el límite ya está documentado y no se debe presentar como aislamiento completo antes de esa etapa.

