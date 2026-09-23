# Informe de Ejecución E08 — Sommelier IA & Guía de Carta sobre Catálogo Activo

- **Etapa**: E08 — Sommelier IA & Recomendador en Vivo sobre Catálogo Activo
- **Fecha**: 2026-09-21
- **Branch**: `codex/plan-modulos-20260920` (worktree actual)
- **Estado**: `PASS_E08 / VERIFICADO_LOCAL` (22/22 tests focales E08, 57/57 tests de contención y diagnóstico E10, matriz de rutas 111/111, schema Supabase sincronizado y build monorepo 6/6 exitoso; sin credenciales reales ni validación cloud)
- **Autor/Ejecutor**: Agente Antigravity (ejecutor de verificación, suite focal E08, corrección de límites léxicos de bebidas y reporte; sin commits, pushes, deploys ni modificaciones fuera del worktree)
- **Revisión independiente previa y hallazgo resuelto**: La revisión independiente encontró que el código funcional de E08 estaba aplicado en `ai.service.ts` y rutas, pero faltaban dos componentes obligatorios: la suite focal `packages/api/test/e08-sommelier-catalog.test.ts` y el informe de ejecución `docs/ejecucion-plan-modulos/E08-SOMMELIER-Y-ASISTENTE-IA-2026-09-21.md`. Al crear y ejecutar la suite focal, se detectó además un bug léxico real en `ai.service.ts`: el uso de subcadenas crudas (`apa`, `ipa`, `mar`) causaba que platos con "papas fritas" o categorías "principales" coincidieran como cerveza o bebida (`p-apa-s`, `princ-ipa-l`), y que la consulta "qué tienen para tomar?" fuera capturada por `mar` (`to-mar`) como pescados. Se corrigió implementando límites estrictos de palabra (`\bapa\b`, `\bipa\b`, `\bmar\b`, `\btomar\b`) y soporte tipado/resiliente de tags (array o JSON string), agregando su correspondiente bloque de regresión.

---

## 1. Alcance y Objetivos

El objetivo de E08 es dotar a MesaYA de un Sommelier IA y Guía de Carta determinístico, seguro y fundamentado exclusivamente en el catálogo activo del restaurante:

1. **Catálogo Grounded (Fuente Única de Verdad)**:
   - Toda recomendación de platos o bebidas debe originarse y resolverse exclusivamente sobre los platos activos (`isAvailable: true`) del restaurante correspondiente a la mesa.
   - Prohibición absoluta de inventar platos, nombres, precios o descripciones que no pertenezcan a la base de datos operativa.
   - Si Gemini sugiere IDs inexistentes, IDs de platos pausados/agotados o combinaciones semánticamente incompatibles con el pedido del comensal, la respuesta externa se descarta en su totalidad y se activa el motor heurístico local sobre los platos reales de la carta.
2. **Contención y Abstención Estricta ante Alérgenos**:
   - Ante cualquier consulta de alergia, anafilaxia o intolerancia severa, el sistema se abstiene de inmediato: `recommendedDishIds: []`, `suggestedDishes: []`, `suggestedPairing: undefined`, `degraded: true` y derivación imperativa al personal de salón.
   - Las etiquetas del catálogo no garantizan ausencia de alérgenos ni contaminación cruzada; nunca se delega esta responsabilidad a la inferencia de un modelo generativo externo.
3. **Respeto Absoluto de Presupuesto y Precios Persistidos**:
   - Ante restricciones de presupuesto explícitas (ej: "hasta $10.000"), ningún plato devuelto supera el límite (`dish.price <= budgetMax`).
   - Los DTOs devueltos en `suggestedDishes` conservan fielmente el precio numérico persistido en la base de datos.
   - Si ningún plato activo se ajusta al presupuesto, el sistema se abstiene cortésmente explicando el límite detectado.
4. **Delimitación de Dominio y Consultas Fuera de Tema (Anti-Hallucination & Jailbreak)**:
   - Consultas no gastronómicas (fútbol, clima, política, programación, criptomonedas) o ambiguas reciben abstención inmediata recordando el rol del sommelier.
   - No se realiza fallback ciego a platos destacados ante consultas fuera de tema.
5. **Degradación Elegante y Operatividad Sin Conexión Externa**:
   - Sin credenciales configuradas (`GOOGLE_API_KEY` ni `GEMINI_API_KEY`) o con la bandera `ENABLE_AI_FEATURES` desactivada, el sommelier funciona al 100% de forma local mediante el motor heurístico (`poweredBy: 'heuristic-engine'`).
   - Ante timeouts, errores 500/503 del proveedor o respuestas malformadas, la experiencia del comensal no se interrumpe y degrada limpiamente al motor heurístico.

---

## 2. Decisiones de Seguridad, Contención y Catalog Source

1. **Hermeticidad y Cero Fuga de Secretos**:
   - Ninguna prueba realiza peticiones HTTP reales a la API de Google Gemini ni lee claves de producción.
   - Todas las llamadas externas están interceptadas con mocks locales (`fetchMock`).
2. **Validación Zod y Sanitización de Entrada**:
   - La consulta del comensal se valida mediante `AiSommelierInputSchema`:
     - Longitud acotada entre 3 y 300 caracteres.
     - Eliminación de saltos de línea y caracteres de inyección de delimitadores (` ` " \ { } `).
     - Validación obligatoria de `sessionToken` vinculado a una mesa activa con turno abierto.
3. **Cuotas y Protección contra Abuso**:
   - Límite de 10 consultas por sesión de mesa (`SommelierQuotaManager`).
   - Control de tasa por tenant (`AbuseControlService.consume` con política `AI_BY_TENANT`).
4. **Atribución Transparente (`poweredBy`)**:
   - `'gemini'`: Únicamente si el modelo externo respondió con HTTP 200, schema válido, IDs existentes en catálogo y coincidencia semántica verificada.
   - `'heuristic-engine'`: En cualquier escenario de clave faltante, bandera apagada, fallback por timeout/error o descarte de IDs inventados.
5. **Corrección de Límites de Palabra en Matchers Léxicos**:
   - Estilos de cerveza como APA e IPA se validan mediante expresiones regulares de límite de palabra (`/\bapa\b/`, `/\bipa\b/`) en minúsculas. Esto previene que palabras cotidianas de cocina argentina como "papas" (p-apa-s) o "principales" (princ-ipa-les) sean capturadas como bebidas alcohólicas.
   - El verbo "tomar" (`/\btomar\b/`) se incorpora explícitamente a `beer_or_drinks`, evitando que sea capturado por la subcadena `mar` (`to-mar`) en pescados y mariscos.

---

## 3. Archivos Involucrados y Modificados

### Creados
- `packages/api/test/e08-sommelier-catalog.test.ts`:
  - Suite focal completa con 22 pruebas unitarias e integradas con mocks herméticos de Prisma y Fetch.
  - Cobertura exhaustiva de los 9 criterios de aceptación del plan más bloque de regresión léxica.

### Modificados
- `packages/api/src/services/ai.service.ts`:
  - En `allActiveItems`: Parseo seguro de `i.tags` soportando indistintamente arrays nativos o strings serializados en JSON.
  - En `detectCulinaryIntent`: Reemplazo de subcadenas sueltas `apa`, `ipa` y `mar` por regexes con límites de palabra (`\bapa\b`, `\bipa\b`, `\bmar\b`), e inclusión de `\btomar\b` en `beer_or_drinks`.
  - En `isSpecificBeer` y `matchBeer`: Reemplazo de `apa` e `ipa` por regexes de palabra completa (`/\bapa\b/`, `/\bipa\b/`), y adición de coincidencia léxica para tags `beer` y `drink`.

---

## 4. Matriz de Casos de Prueba (22 Tests Focales)

| # | Categoría / Criterio | Caso de Prueba | Resultado |
|---|---|---|---|
| 1 | Cerveza / Bebidas | Devuelve sólo IDs de items activos correspondientes a cerveza por nombre, categoría, descripción o tags | `PASS` |
| 2 | Cerveza / Bebidas | Devuelve bebidas/cócteles si se piden tragos o bebidas, excluyendo platos de comida | `PASS` |
| 3 | Cerveza / Bebidas | Se abstiene limpiamente si se pide cerveza pero el catálogo no dispone de ninguna | `PASS` |
| 4 | Compartir / Pareja | Devuelve sólo platos marcados por catálogo como compartibles o para dos comensales | `PASS` |
| 5 | Compartir / Pareja | Se abstiene sin sugerir platos individuales si no existen opciones para compartir | `PASS` |
| 6 | Presupuesto | Ningún plato sugerido excede el límite y el DTO conserva el precio persistido | `PASS` |
| 7 | Presupuesto | Se abstiene si ningún plato activo está dentro del presupuesto fijado | `PASS` |
| 8 | Disponibilidad | No sugiere platos pausados o sin stock (`isAvailable: false`) presentes en la fixture | `PASS` |
| 9 | Disponibilidad | Descarta sugerencia de Gemini si intenta recomendar un ID pausado/no disponible | `PASS` |
| 10 | Alergias | Abstención completa sin IDs, sin maridaje y con derivación expresa al personal (maní, mariscos, shock anafiláctico) | `PASS` |
| 11 | Fuera de tema | Abstención completa ante consultas fuera de tema (fútbol, clima, python, dólar) sin recurrir a destacados | `PASS` |
| 12 | Fuera de tema | Abstención completa ante consultas ambiguas o sin sentido gastronómico | `PASS` |
| 13 | Fallback / Sin clave | Opera con motor heurístico local y `poweredBy: 'heuristic-engine'` cuando `ENABLE_AI_FEATURES` no está activo | `PASS` |
| 14 | Fallback / Sin clave | Opera con motor heurístico local cuando la bandera está activa pero falta la clave de API | `PASS` |
| 15 | Fallback / Error IA | Degrada a motor local si Gemini devuelve IDs inventados o inexistentes | `PASS` |
| 16 | Fallback / Error IA | Degrada a motor local si Gemini devuelve una recomendación semánticamente inconsistente | `PASS` |
| 17 | Fallback / Error IA | Degrada limpiamente ante timeout de red sin lanzar excepción al llamador | `PASS` |
| 18 | Fallback / Error IA | Degrada limpiamente ante respuesta HTTP 503 del proveedor | `PASS` |
| 19 | Integridad Catálogo | Todos los IDs y precios de `suggestedDishes` pertenecen al catálogo activo con precios persistidos | `PASS` |
| 20 | Integridad Catálogo | En fallback local el texto fundamenta las sugerencias con los nombres exactos de los platos del catálogo | `PASS` |
| 21 | Regresión Léxica | Platos con "papas fritas" o "principales" no son clasificados erróneamente como cerveza por la subcadena "apa" o "ipa" | `PASS` |
| 22 | Regresión Léxica | La consulta "qué tienen para tomar?" clasifica como bebidas y no como pescados de mar | `PASS` |

---

## 5. Comandos de Verificación y Resultados Reales Observados

### 5.1. Suite focal E08
```bash
node scripts/test-local.mjs e08-sommelier-catalog.test.ts
```
**Resultado observado**:
```
▶ crear esquema SQLite efímero (955ms)
▶ cargar fixtures demo en SQLite efímera
🌱 Sembrando datos demo para MesaYA (Trattoria del Puerto)...
✅ Seed completado con éxito!
▶ ejecutar suites Vitest en un worker

 RUN  v4.1.11 C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-plan-20260920/packages/api

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  07:48:59
   Duration  533ms (transform 111ms, setup 0ms, import 203ms, tests 164ms, environment 0ms)
```

### 5.2. Suites complementarias de contención y diagnóstico (E10)
```bash
node scripts/test-local.mjs ai-containment.test.ts e10-ai-diagnostics.test.ts
```
**Resultado observado**:
```
▶ crear esquema SQLite efímero (1.33s)
▶ cargar fixtures demo en SQLite efímera
🌱 Sembrando datos demo para MesaYA (Trattoria del Puerto)...
✅ Seed completado con éxito!
▶ ejecutar suites Vitest en un worker

 RUN  v4.1.11 C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-plan-20260920/packages/api

 Test Files  2 passed (2)
      Tests  57 passed (57)
   Start at  07:49:09
   Duration  1.47s (transform 185ms, setup 0ms, import 589ms, tests 608ms, environment 0ms)
```

### 5.3. Ejecución consolidada de todas las suites de IA (E08 + E10 + Contención)
```bash
node scripts/test-local.mjs ai-containment.test.ts e10-ai-diagnostics.test.ts e08-sommelier-catalog.test.ts
```
**Resultado observado**:
```
Test Files  3 passed (3)
     Tests  79 passed (79)
  Duration  2.11s (transform 232ms, setup 0ms, import 854ms, tests 789ms, environment 0ms)
```

### 5.4. Verificación de matriz de rutas
```bash
npm run check:routes
```
**Resultado observado**:
```
npm notice run node scripts/check-route-matrix.mjs
Matriz de rutas OK: 111 rutas clasificadas, sin novedades ni deriva.
```

### 5.5. Verificación de esquema Supabase vs SQLite
```bash
npm run check:supabase-schema
```
**Resultado observado**:
```
npm notice run node scripts/sync_supabase_schema.js --check
✅ schema.supabase.prisma está sincronizado con el schema canónico.
```

### 5.6. Compilación de paquetes y monorepo
```bash
npm run build:shared
npm run build
```
**Resultado observado**:
```
npm notice run @mesaya/shared@1.0.0 build
npm notice run tsc

🎉 BUILD COMPLETO EXITOSO (28.45s)
Resumen de compilación por workspace:
  ✓ @mesaya/shared             [OK] (1.16s)
  ✓ @mesaya/api                [OK] (5.22s)
  ✓ @mesaya/client-web         [OK] (1.57s)
  ✓ @mesaya/staff-panel        [OK] (7.85s)
  ✓ @mesaya/admin-dashboard    [OK] (10.99s)
  ✓ @mesaya/qr-generator       [OK] (1.66s)
```

### 5.7. Verificación de git diff
```bash
git diff --check
```
**Resultado observado**: Código de salida 0 (limpio, sin errores de espaciado ni conflictos).

### 5.8. Revisión independiente final

- **Dictamen**: `PASS_E08`.
- **Revisor**: Antigravity Pro (`gemini-3.1-pro-high`), modo plan/sandbox read-only, 2026-09-21.
- **Verificado**: catálogo activo y precios persistidos, filtrado estricto de IDs Gemini, intents y límites léxicos de cerveza/bebidas, abstención de alergias y fuera de tema, fallback ante proveedor no disponible, atribución segura del cliente, diagnóstico administrativo explícito y preview sin auto-aplicación.
- **Resultado de revisión**: no se detectaron hallazgos P0/P1/P2 bloqueantes; el revisor confirmó que no modificó el worktree.

---

## 6. Límites Restantes y Pendientes

> [!WARNING]
> **NO PRODUCCIÓN GO**: La presente verificación confirma la corrección estructural y unitaria de E08 en entorno local simulado. No constituye autorización ni habilitación para despliegue productivo directo.

### PENDING_CLOUD (Infraestructura, Credenciales y Modelo en Nube)
1. **Aprovisionamiento de Claves de Producción**: La activación de llamadas reales a Gemini en Vercel/Render/Cloud requiere la configuración segura de `GOOGLE_API_KEY` (o `GEMINI_API_KEY`) en el gestor de secretos de la infraestructura de backend. NUNCA incorporar estas claves en variables cliente (`VITE_*`) ni en repositorios.
2. **Validación de Cuota y Facturación Cloud**: Probar la latencia real bajo conexión TLS hacia `generativelanguage.googleapis.com` con los modelos vigentes (`gemini-3.8-flash` primario y `gemini-3.5-flash-lite` fallback), verificando que la cuota del proyecto de Google Cloud soporte la concurrencia proyectada en salón sin disparar `429 QUOTA_EXHAUSTED`.
3. **Monitoreo de Timeout y Red Externa**: Confirmar que el timeout de 8000ms (`AI_TIMEOUT_MS`) sea adecuado para la conectividad de la zona geográfica de los locales gastronómicos.

### PENDING_HUMAN (Revisión Gastronómica, Alérgenos y Experiencia de Usuario)
1. **Revisión de Alérgenos y Carta por Sommelier / Bromatología**:
   - Las etiquetas del catálogo (`GLUTEN_FREE`, `VEGAN`, `VEGETARIAN`) deben ser revisadas periódicamente por el encargado gastronómico y cocina de cada local.
   - Confirmar en salón que el protocolo de servicio instruya al personal ante la derivación presencial de comensales con alergias severas o celiaquía.
2. **Auditoría de Sugerencias de Maridaje**:
   - Evaluar con el equipo de sommelier/jefe de barra si las pautas de maridaje genéricas ("Copa de Malbec", "Cerveza artesanal", "Limonada fresca") se alinean con la carta de vinos y coctelería específica de cada temporada del restaurante Fauno.
3. **Prueba Piloto en Salón**:
   - Validar la experiencia de uso en teléfonos móviles de comensales en mesas reales, verificando que el modal del sommelier sea claro, legible y no confunda al cliente respecto de si está dialogando con un asistente local o un mozo de carne y hueso.
