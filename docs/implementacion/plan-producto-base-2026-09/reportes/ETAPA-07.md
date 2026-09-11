# Reporte de etapa 07 — Llamados, temporizador y recuperación

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- La creación de llamados exige sesión, turno y tenant válidos; una instancia single-restaurante no acepta tokens de otro local.
- Se conserva un único llamado activo por sesión mediante `activeKey` y el límite de abuso compartido.
- Las transiciones de llamado tienen una política explícita, con diagnósticos para estados finales y reintentos idempotentes.
- Cancelación por el comensal verifica pertenencia, TTL, turno y libera la clave activa.
- El panel de mozos mantiene snapshot por polling autenticado, backoff, reconexión, alerta sonora, filtros y temporizador por llamado.

## Verificación

| Verificación | Resultado |
|---|---|
| política de llamados | 3/3 PASS |
| llamadas, feedback y aislamiento | 37/37 PASS |
| abuso y liberación de clave | 3/3 PASS |
| API build directo | PASS |
| staff panel build directo previo | PASS |

## Límite conocido

La confirmación física de recepción en una pantalla compartida y el recorrido con varios mozos concurrentes quedan incluidos en la certificación de la etapa 21; el transporte SSE continúa intencionalmente deshabilitado y el polling es la fuente vigente.
