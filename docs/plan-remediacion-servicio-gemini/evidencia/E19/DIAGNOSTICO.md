# E19 — diagnóstico: carta sin filtros dietarios fiables

## D1 confirmado: no había filtro por preferencia dietaria en la carta pública

- `renderDynamicMenu` (apps/client-web/app.js) renderizaba todas las
  categorías e ítems sin ningún filtro por tags; el cliente ya tenía
  `MENU_TAG_MAP` con `GLUTEN_FREE`/`VEGAN`/`VEGETARIAN` y los mostraba como
  insignias, pero no había forma de filtrar por ellas.
- Las pills existentes (`heroCategoryPillsContainer`,
  `modalMenuCategoryPillsContainer`) son sólo navegación por scroll, no un
  filtro combinable ni determinístico.
- El detalle del plato (`openDishDetailSheet`) no informaba nada sobre datos
  alimentarios confirmados vs. desconocidos.

## D2 confirmado: riesgo de inferencia honesta ausente, no de inferencia activa

- No se encontró código que deduzca Sin TACC/vegano desde
  nombre/descripción/imagen/IA para filtrar o etiquetar: las insignias salen
  de `item.tags` contra `MENU_TAG_MAP`. Decisión: mantener esa propiedad y
  blindarla en el filtro nuevo (sólo `tags.includes(filter)`).
- Residual observado, fuera de alcance E19 y sin tocar: el bloque de
  "Maridaje sugerido" en `openDishDetailSheet` usa heurística por nombre
  (`lowerName.includes('pasta'|'carne'|...)`) para sugerir bebidas. No es una
  afirmación dietaria ni un filtro, por lo que no se modificó; queda
  registrado aquí para una ficha futura si se quiere endurecer.

## D3 confirmado: MenuManager permite marcar tags sin aclarar que deben ser confirmados

- El formulario "Agregar Plato" lista `MENU_TAGS` como "Etiquetas
  Especiales" sin indicar que se muestran tal cual en la carta pública ni
  que sólo deben marcarse las confirmadas por el local. Decisión: agregar un
  hint mínimo (2 líneas, sin modelo nuevo) en vez de dejarlo intacto, porque
  el copy confuso alimenta etiquetas no confirmadas.

## D4 descartado: modelo de alérgenos nuevo

- Los tags existentes (`MENU_TAGS` en `@mesaya/shared`) ya son los campos
  estructurados disponibles y cubren Sin TACC/Vegano/Vegetariano. No se
  agrega ningún modelo de alérgenos ni se inventan datos, según el alcance.

## Decisión de producto

- Filtros determinísticos por tag confirmado + selector de categoría
  combinable + Todas/limpiar + estado vacío + conteo anunciado + advertencia
  honesta en barra y detalle + desconocido explícito. `ALL` conserva la
  carta completa; el vacío sólo corresponde a la combinación elegida.
