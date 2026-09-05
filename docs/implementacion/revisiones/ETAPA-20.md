# Revisión Codex — Etapa 20

Estado: **APPROVED**  
Fecha: 2026-09-04  
Predecesora: Etapa 19 APPROVED

## Veredicto

La primera revisión fue `CHANGES_REQUESTED`. Se corrigieron los cuatro hallazgos y se reprodujeron los casos relevantes:

1. `AIService.fetchGemini` mantiene un deadline único durante la recepción completa del cuerpo, limita bytes, cancela el reader y no registra cuerpos ni credenciales.
2. `POST /restaurants/:slugOrId/ai-sommelier` carga `shift` y rechaza antes de cuota/proveedor una sesión sin turno (410), turno cerrado (410) o turno de otro restaurante (403).
3. Una respuesta Sommelier que contiene cualquier ID desconocido no se acepta parcialmente; se descarta y se usa el heurístico local. El test activa explícitamente IA y mezcla ID válido/inventado.
4. `AIChefAssistantModal` no vuelve a generar ni informa una importación inexistente: queda como preview con advertencia y deriva al flujo explícito de edición.

## Evidencia

- Suite enfocada: `node scripts/test-isolated.mjs ai-containment` → **23/23**.
- Build: `node scripts/build.mjs` → **6/6 workspaces**.
- Suite completa: `node scripts/test-isolated.mjs` → **21/21 suites**, 0 fallas.
- `dev.db`: SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`, sin cambios.

La suite de IA usa fixtures y mocks de Prisma/fetch; no se presenta como prueba de persistencia HTTP SQLite. Los gates generales usan sandboxes SQLite efímeros.

## Pendientes no bloqueantes

No se realizó llamada a un proveedor IA real ni se habilitó la feature en producción. La importación efectiva de propuestas queda fuera de esta ficha y requiere un flujo explícito posterior.
