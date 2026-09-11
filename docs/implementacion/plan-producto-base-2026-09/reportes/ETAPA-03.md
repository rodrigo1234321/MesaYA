# Reporte de etapa 03 — Provisioning y ciclo de vida de instancia

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- Contrato JSON versionado en `deploy/instance.example.json`.
- Validador de manifiesto sin secretos: `npm run instance:validate`.
- Validación de dominios, slug, timezone, moneda, módulos y release.
- Rechazo de claves/valores que parezcan secretos, tokens o URLs de base de datos.
- Modo `--production` exige HTTPS.
- Suite Node aislada del manifiesto con casos válido, HTTPS y secreto embebido.
- Nuevos comandos `instance:validate` e `instance:test`.

## Verificación

| Verificación | Resultado |
|---|---|
| `npm run instance:test` | 3/3 PASS |
| `npm run instance:validate` | PASS |
| `npm run instance:validate -- --production` | PASS |

## No ejecutado

No se crearon proyectos Supabase/Vercel, no se aplicaron migraciones remotas y no se cargaron secretos. La automatización remota queda para la fábrica de releases después de completar el código base.

