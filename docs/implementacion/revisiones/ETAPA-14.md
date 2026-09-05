# Revisión Codex — Etapa 14: Validar pedidos del comensal

Fecha: 2026-09-04 (-03:00)  
Veredicto final: **APPROVED**

La implementación inicial cubrió correctamente el aislamiento de ítems por restaurante, cantidades, disponibilidad, cálculo de precio/total en servidor y el submit repetido. La revisión inicial detectó una condición incompleta de sesión activa; la corrección posterior la cerró sin ampliar el alcance de la ficha.

## Resultado de la corrección

- `OrderService.validateActiveGuestSession` exige ahora una relación `session.shift` existente, con `closedAt === null` y `restaurantId` igual al restaurante de `session.table`. El incumplimiento retorna `410` antes de consultar o mutar pedidos.
- Las pruebas HTTP reales sobre SQLite efímera cubren una sesión con `shiftId: null` y una sesión de mesa del restaurante A vinculada a un turno abierto del restaurante B. Ambos `GET /v1/orders/session/:token` y `POST /v1/orders/items` devuelven `410`; las aserciones comprueban cero órdenes y cero líneas creadas.
- Se verificó que `getActiveOrderForGuest`, `addItem`, `removeItem` y `submitOrder` pasan por el validador centralizado antes de sus lecturas o mutaciones de pedidos.
- La evidencia ejecutada en el reporte confirma build completo aprobado, `test:isolated` completo con 16/16 suites aprobadas, suite específica con 32/32 pruebas y `dev.db` intacta con hash `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

No se encontraron hallazgos bloqueantes ni cambios fuera de alcance. La Etapa 14 queda **APPROVED**. Se habilita exclusivamente la Etapa 15; las siguientes continúan bloqueadas.
