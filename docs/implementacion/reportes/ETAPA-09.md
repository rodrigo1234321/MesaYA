# Reporte de ejecución — Etapa 09: Proteger todas las mutaciones del menú

Fecha: 2026-09-04 10:20 (-03:00)  
Ejecutor: Codex, con autorización explícita de Rodrigo.

## Ejecutado

- Categorías, ítems, importación, branding, template y generación IA requieren manager del restaurante resuelto por ID/slug y comparado con el tenant canónico.
- Categorías e ítems se validan por relaciones reales de DB; no basta cambiar body, URL o ID.
- Importación limita a 200 ítems, valida todos los campos antes de abrir transacción y no borra/reemplaza ante payload inválido.
- Se preservan GET público de menú/upsell y preview IA sin `autoApply`.
- La prueba histórica de preview IA se actualizó únicamente para aportar el manager que ahora exige la ruta; conserva las assertions de cero escrituras.

## Pruebas

| Comando | Resultado |
|---|---|
| `node scripts/test-isolated.mjs packages/api/test/menu-access.test.ts` | Exit 0; 3/3 tests |
| `node scripts/build.mjs` | Exit 0; 6/6 workspaces |
| `node scripts/test-isolated.mjs` | Exit 0; 10/10 suites, 107/107 tests |

Los Jobs terminaron vacíos y sin ventanas visibles. `dev.db` conservó el hash `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
