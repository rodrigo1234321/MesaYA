# Reporte de ejecución — Etapa 07: Cerrar altas de personal y login admin

Fecha: 2026-09-04 09:05 (-03:00)  
Ejecutor: Codex, con autorización explícita de Rodrigo.

## Ejecutado

- `GET /staff` y `POST /staff` requieren manager vigente del tenant; el tenant se deriva del token y un `restaurantId` ajeno retorna 404 sin listar ni escribir.
- Se validan nombre, PIN numérico de 4–6 dígitos y rol permitido en el servicio; las respuestas no contienen PIN ni hash.
- `/auth/login-admin` sólo emite JWT para `MANAGER`; un mozo recibe 403 sin token. Las emisiones mantienen expiración de 12 horas.
- El onboarding público está deshabilitado por defecto mediante `PILOT_PUBLIC_ONBOARDING_ENABLED`; sin activación explícita retorna 403 antes de cualquier escritura.
- El consumidor administrativo conserva la credencial y ahora invalida sesión/muestra error ante 401/403, sin falso éxito.

## Pruebas ejecutadas

| Comando | Resultado |
|---|---|
| `node scripts/test-isolated.mjs packages/api/test/staff-access.test.ts` | Exit 0; 4/4 tests |
| `node scripts/build.mjs` | Exit 0; 6/6 workspaces |
| `node scripts/test-isolated.mjs` | Exit 0; 8/8 suites, 101/101 tests |

Los Jobs finalizaron con `ActiveProcesses=0`, sin ventanas visibles. `dev.db` mantuvo el hash `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

## No ejecutado

No se implementó superadmin ni invitaciones. No se activó onboarding, no se rotaron secretos y no hubo servicios, migraciones, seed real ni despliegues.
