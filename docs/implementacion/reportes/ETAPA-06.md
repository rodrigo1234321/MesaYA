# Reporte de ejecución — Etapa 06: Helpers de autorización y matriz de rutas

Fecha: 2026-09-04 08:34 (-03:00)  
Ejecutor: Codex, con autorización explícita de Rodrigo.

## Ejecutado

- Se creó `evidencia/MATRIZ_RUTAS.md` con método+ruta de todos los plugins, incluyendo lecturas, SSE, IA y excepciones públicas; define actor y tenant objetivo.
- `verifyStaffToken` verifica firma/expiración y reconsulta al staff por ID en DB. El tenant y rol canónicos se derivan de DB, no del JWT ni del body.
- Se agregó `requireRestaurantAccess` para recursos tenant-scoped: 401 para identidad inválida/no vigente y 404 para tenant ajeno. `verifyManagerRole` corta de forma explícita tras una respuesta previa.
- Se agregaron fixtures A/B para token inválido/vencido, usuario ausente/movido, rol falsificado y ausencia de continuación de handler.

## Pruebas ejecutadas

| Comando | Resultado |
|---|---|
| `node scripts/test-isolated.mjs packages/api/test/auth-policy.test.ts` | Exit 0; 4/4 tests |
| `node scripts/build.mjs` | Exit 0; 6/6 workspaces |
| `node scripts/test-isolated.mjs` | Exit 0; 7/7 suites, 97/97 tests |

Los Jobs supervisados finalizaron con `ActiveProcesses=0`, sin ventanas visibles. `dev.db` mantuvo el hash `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

## No ejecutado

No se aplicó un guard global ni se cerraron todos los módulos: ese trabajo está secuenciado por fichas 07–18. No hubo migraciones, seed real, servicios ni despliegues.
