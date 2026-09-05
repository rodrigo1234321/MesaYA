# Revisión Codex — Etapa 04: Quitar fallbacks engañosos de IA

Fecha: 2026-09-04 03:50 (-03:00)  
Veredicto: **APPROVED**

## Evidencia revisada

- Ficha `etapas/04-ia-contencion.md` y reporte `reportes/ETAPA-04.md`.
- `packages/api/src/services/ai.service.ts`.
- `packages/api/src/routes/menu.routes.ts`.
- `packages/api/test/ai-containment.test.ts`.
- `packages/shared/src/index.ts` y registro en `scripts/test-isolated.mjs`.
- Hash de `packages/api/prisma/dev.db`: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

## Resultado de revisión independiente

- Las claves de Notion ya no se usan como credenciales Gemini; sin credencial válida la generación devuelve preview degradada, categorías vacías y `applied=false`.
- Una respuesta válida de Gemini sigue siendo sólo preview con revisión humana pendiente. La ruta ignora `autoApply` y no ejecuta escrituras ni borrados.
- Las consultas de alergia se abstienen. Las consultas gluten/vegana/vegetariana sólo recomiendan coincidencias determinísticas verificadas por tags; ante ausencia de coincidencias derivan al personal y advierten que las etiquetas no garantizan ausencia de alérgenos ni contaminación cruzada.
- Los IDs devueltos por Gemini se intersectan con el catálogo activo antes de exponer platos.
- La suite nueva pasó 10/10 con fixtures y mocks. No lee `.env` ni la base demo para sus datos.
- El build independiente pasó los seis workspaces. La regresión aislada pasó 5/5 suites, 88/88 tests. Ambos comandos terminaron con Job Windows vacío; no se detectaron ventanas visibles.
- `dev.db` conservó el hash esperado y no se ejecutaron servicios, despliegues, migraciones reales ni seeds sobre la base habitual.

## Limitaciones aceptadas

Las etiquetas del catálogo no constituyen certificación sanitaria. Esta etapa contiene el comportamiento y deriva al personal ante alergias o falta de evidencia; no implementa trazabilidad de ingredientes ni certificación de contaminación cruzada.

## Resultado

La etapa 04 cumple su ficha y queda aprobada. Codex habilita únicamente la etapa 05; las posteriores permanecen bloqueadas.
