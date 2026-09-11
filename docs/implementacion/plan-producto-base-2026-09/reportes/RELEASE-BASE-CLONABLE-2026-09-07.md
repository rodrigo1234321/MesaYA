# Cierre de línea base clonable — 2026-09-07

## Resultado

La revisión deja una base de código clonable desde GitHub, ejecutable localmente y preparada para replicarse por restaurante. El arranque local no necesita Supabase, Vercel, Mercado Pago, WhatsApp, Gemini ni hardware físico.

El recorrido integrado verificado es:

`QR/NFC (URL canónica) → sesión → carta → carrito → comanda → validación de mozo → KDS → listo → servido → cobro presencial → cierre/liberación`

Mercado Pago se conserva como opción informativa. No hay SDK, token, webhook ni cobro automático. La división de cuenta permanece cerrada con `503 DIGITAL_PAYMENTS_UNAVAILABLE` hasta que se apruebe una etapa financiera independiente.

## Evidencia ejecutada

| Verificación | Resultado |
|---|---|
| `npm run setup:local` en base SQLite nueva | PASS; schema + seed demo idempotente |
| Repetición de `setup:local` sobre base existente | PASS; no sobreescribe datos |
| `npm run test:local` | 41 archivos PASS; 431 pruebas PASS; 3 skips PostgreSQL explícitos; SQLite efímera y seed Trattoria aislados |
| `npm run build` | PASS en shared, API, cliente, staff, admin y QR |
| `npm run build:pg` con variables sintéticas | PASS; luego se regeneró el cliente SQLite |
| `npm run check:routes` | PASS; 86 rutas clasificadas |
| `npm run check:supabase-schema` | PASS |
| `npm run instance:test` | PASS; 5/5 |
| `npm run instance:validate -- --production` | PASS; manifiesto sin secretos |
| `npm --workspace=@mesaya/qr-generator run test` | PASS; 3/3 |
| Smoke HTTP sobre base nueva | PASS; health, carta, QR, login, comanda, KDS, cobro `PAID` y cierre |
| Recorrido visual QR → activación de mesa | PASS; PIN `1234`, `Mesa 1: Asignar Mesa`, sesión activa en QR, avance FSM hasta `Disponible` |
| `git diff --check` | PASS; sin errores de whitespace |

## Cambios de base que quedan establecidos

- `npm run build` es reproducible en Windows sin exigir un supervisor de procesos; el runner aislado conserva su propio gate.
- `npm test` usa siempre una SQLite efímera propia y un worker, por lo que no contamina `dev.db`.
- `setup:local` crea sólo entornos locales faltantes y carga demo únicamente en una base vacía.
- `run-tsx.mjs` encapsula los comandos TypeScript y evita el fallo `uv_os_get_passwd ENOMEM` observado en Node 24 sobre Windows.
- `test:local` es el entry point reproducible de suites API con seed demo; quedó expuesto en `package.json`.
- La instancia `SINGLE_RESTAURANT` limita login, QR, carta, configuración y fila virtual al restaurante raíz.
- La pantalla compartida de staff selecciona local/actor y mantiene los accesos demo ocultos salvo habilitación explícita.
- La pantalla compartida de staff mantiene `Mesas en vivo` visible en todos los módulos y permite avanzar el ciclo de mesa desde la misma pantalla (`Asignar Mesa` → siguiente estado), con `expectedCurrentState` para evitar carreras y refresco tras conflicto.
- El alta pública está cerrada por defecto con `PUBLIC_ONBOARDING_ENABLED`; se acepta el alias legado durante la migración.
- La configuración modular se crea mediante `upsert`, evitando carreras en el primer acceso concurrente.
- El manifiesto y el plan de provisión declaran los cuatro proyectos Vercel sin incluir secretos, el restaurante Trattoria del Puerto y la política `BASE_RELEASE`/`LOCAL_OVERRIDE`.

## Gates todavía externos al código base

No se tocaron cuentas remotas ni se inventaron credenciales. Para abrir un local concreto todavía se debe ejecutar el runbook de [GUIA-CLON-Y-RELEASE.md](../GUIA-CLON-Y-RELEASE.md): Supabase/PostgreSQL real, cuatro proyectos Vercel, variables protegidas, dominios/CORS, backup/restore, teléfonos reales, impresión/lectura QR/NFC y aceptación del personal.

Esos gates certifican una instalación y sus dispositivos. No son necesarios para clonar, compilar, probar ni extender la línea base.
