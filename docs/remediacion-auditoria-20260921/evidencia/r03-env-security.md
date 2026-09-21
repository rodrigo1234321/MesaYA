# Evidencia R03 — Entorno, Secrets, PINs y QR Local

Fecha: 2026-09-21
Candidato: `mdpmesasvivas-remediacion-20260921`
Rama: `codex/remediacion-auditoria-20260921`

## Hallazgos Auditados y Resueltos

| ID | Hallazgo | Estado Previo | Corrección Aplicada | Verificación |
|---|---|---|---|---|
| **SEC10-01** | PIN por defecto '1234' en onboarding público | `pin = '1234'` fallback en `auth.routes.ts:60` | Se eliminó el fallback. Se exige PIN numérico obligatorio de 4 a 6 dígitos (`isValidPinFormat`). Devuelve `400` con `code: 'INVALID_PIN'`. | `staff-access.test.ts` pasando (7/7 tests) |
| **SEC10-02** | Drift de variables en `.env.example` vs loader | `MESAYA_INSTANCE_MODE=MULTI_RESTAURANT` inválido, faltaba `HOST`, `PUBLIC_ONBOARDING_ENABLED`, `GEMINI_API_KEY`, `NODE_ENV` | Sincronizados `packages/api/.env.example` y `.env.example` raíz con enum real `MULTI_TENANT` y variables de runtime. | Verificado con schema y scripts |
| **SEC10-03** | Tolerancia de Gemini API key faltante | API fallaba si falta key al activar IA | IA opera como opt-in; sin key configurada las rutas de IA degradan elegantemente sin afectar el arranque de la API. | Verificado en `ai.service.ts` |
| **SEC10-04** | Botones de login rápido en producción | Reportado como riesgo en informe antiguo | Ya se encontraba condicionado estrictamente a `VITE_DEMO_MODE === 'true'` en `apps/staff-panel/src/components/LoginModal.tsx`. | Verificado en código fuente |
| **SEC10-05** | Generación de QR con API externa | Reportado uso de `api.qrserver.com` | No existe en el repositorio; la generación de QR usa `qrcode` (`QRCode.toDataURL`) 100% local y offline en `TablesManager.tsx` y `qr-generator`. | Verificado en código fuente |

## Pruebas Automatizadas Ejecutadas
- `npx vitest run packages/api/test/staff-access.test.ts`:
  - `onboarding público cuando está habilitado rechaza PIN faltante o inválido con 400 INVALID_PIN`: **PASS**
  - Total: 7 passed (7).
