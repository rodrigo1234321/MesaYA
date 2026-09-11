# Reporte de etapa 04 — Terminal compartido e identidad del actor

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- `StaffLoginDTO` admite `terminalId` opcional.
- Staff API genera y conserva un identificador por terminal en `localStorage`.
- El login envía el terminal y el JWT lo devuelve como claim.
- El middleware conserva `terminalId` junto a la identidad vigente del actor.
- El panel rotula el uso como terminal compartido y permite “Cambiar mozo” sin perder la identidad del dispositivo.
- Validación de formato para terminales (alfanumérico, guion/guion bajo, sin secretos).
- El token de terminal no sustituye al `staffUserId`; ambos quedan separados para auditoría posterior.

## Verificación

| Verificación | Resultado |
|---|---|
| `staff-terminal-contract.test.ts` | 2/2 PASS |
| Staff panel build directo | PASS |
| API build directo | PASS |
| Shared source build | PASS |

## Límite conocido

La persistencia de `terminalId` en tablas de auditoría y la pantalla completa de selección de actor quedan para las etapas de llamadas/caja. En esta entrega ya no se usa una cuenta genérica implícita: cada login identifica actor y terminal en el token.

