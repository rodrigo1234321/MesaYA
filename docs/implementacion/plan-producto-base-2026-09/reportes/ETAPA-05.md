# Reporte de etapa 05 — Mesas, turnos y QR/NFC definitivos

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- Los enlaces físicos usan únicamente `/r/:slug/mesa/:label`; el token de sesión se resuelve al escanear y no se imprime en el QR/NFC.
- Las rutas públicas de sesión aplican `SINGLE_RESTAURANT` y no revelan existencia, metadatos ni tokens de otro restaurante.
- El generador QR dejó de usar slug, dominio, mesas y textos históricos hardcodeados.
- El lote del generador exige `MESAYA_PUBLIC_URL` (o modo `--dev`), `MESAYA_RESTAURANT_SLUG` y `MESAYA_TABLES` explícitos.
- La salida impresa usa instrucciones genéricas compatibles con QR y NFC.

## Verificación

| Verificación | Resultado |
|---|---|
| `hardware/qr-generator npm test` | 3/3 PASS |
| aislamiento público de sesiones | 2/2 PASS |
| ciclo QR/sesión existente | 15/15 PASS |
| entorno/JWT/CORS | 7/7 PASS |
| API build directo | PASS |
| `check:routes` | PASS previo: 77 rutas clasificadas |

## Límite conocido

La generación física real, lectura con dispositivos NFC y smoke contra una instancia PostgreSQL/Supabase todavía requieren la certificación de despliegue. No se escribieron proyectos remotos ni credenciales.
