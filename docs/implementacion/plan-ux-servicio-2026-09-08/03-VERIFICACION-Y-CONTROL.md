# Matriz de verificación y control de ejecución

Fecha: 2026-09-08. Acompaña al [análisis](01-ANALISIS.md) y al [plan](02-PLAN.md).

## 1. Estado inicial honesto

- Análisis: redactado, contrastado con código y observación visual local de cliente/staff.
- Plan: redactado; ninguna de sus 37 etapas de implementación está aprobada todavía.
- Defecto de cuenta: causa identificada por código; reproducción automatizada y corrección pendientes.
- Defecto de plano: sobrescritura identificada por código; prueba de regresión y corrección pendientes.
- Pruebas de aplicación en este paso documental: no ejecutadas. No reutilizar cantidades de tests de otro ciclo como evidencia de este plan.
- Cambios de este paso: documentación nueva únicamente. Cambios de aplicación previos en el checkout pertenecen al trabajo existente.

## 2. Estados y evidencia

`PENDIENTE → EN_CURSO → EN_REVISION → APROBADA_LOCAL`.

Si falla: `CAMBIOS_REQUERIDOS`, con caso reproducible. Dependencias humanas/remotas: `PENDIENTE_EXTERNO`, sin convertirlo en aprobación. Una etapa posterior puede reabrir una anterior si revela una regresión.

Cada etapa debe registrar:

```text
ID / fecha / responsable:
Checkout / commit de referencia / diff propio:
Hipótesis y alcance:
Archivos cambiados:
Prueba que fallaba antes (si aplica):
Comandos ejecutados y códigos de salida:
Fixture / IDs de sesión y pedidos (sin tokens secretos):
Resultado esperado y observado:
Capturas / logs sanitizados / evidencia persistida:
Limitaciones y casos pendientes:
Reversión o recuperación:
Estado y siguiente paso:
```

No confundir snapshot de texto con prueba de interacción. No confundir respuesta HTTP exitosa con dinero/tarea correctamente persistidos. No usar screenshots de mocks como prueba de integración.

## 3. Tablero de 37 etapas

| ID | Resultado principal | Estado actual |
|---|---|---|
| B00 | Línea base reproducible | APROBADA_LOCAL (§48) |
| B01 | Contrato de ocupación/cuenta | APROBADA_LOCAL |
| B02 | Regresión que reproduce importe parcial | APROBADA_LOCAL (§17) |
| B03 | Cuenta agregada autorizada | APROBADA_LOCAL (§17) |
| B04 | Liquidación presencial atómica | APROBADA_LOCAL (§21) |
| B05 | Estados y liberación seguros | APROBADA_LOCAL (§24) |
| B06 | Concurrencia y reintentos | APROBADA_LOCAL (§28) |
| C01 | Boceto de cliente | APROBADA_LOCAL (§30) |
| C02 | Inicio sin estrellas y controles grandes | APROBADA_LOCAL (§32) |
| C03 | Carta blanca legible | APROBADA_LOCAL (§34) |
| C04 | Detalle/carrito claros | APROBADA_LOCAL (§42) |
| C05 | Historial de tandas | APROBADA_LOCAL (§44) |
| C06 | Cuenta completa visible | APROBADA_LOCAL (§45) |
| C07 | Llamados con seguimiento | APROBADA_LOCAL (§46) |
| C08 | Accesibilidad y recuperación | APROBADA_LOCAL (§47) |
| S01 | Boceto de terminal compartido | APROBADA_LOCAL (§48) |
| S02 | Proyección de pendientes | APROBADA_LOCAL (§48) |
| S03 | Prioridad y toma atómica | APROBADA_LOCAL (§48) |
| S04 | Servicio y mapa compacto | APROBADA_LOCAL (§48) |
| S05 | Acciones por mesa | APROBADA_LOCAL (§49) |
| S06 | Recepción/preparación de cocina | APROBADA_LOCAL (§49) |
| S07 | Automatizaciones seguras | APROBADA_LOCAL (§49) |
| S08 | Caja contextual | APROBADA_LOCAL (§49) |
| S09 | Operador, terminal y permisos | APROBADA_LOCAL (§49) |
| S10 | Señales y reconexión | APROBADA_LOCAL (§49) |
| S11 | Módulos secundarios | APROBADA_LOCAL (§49) |
| A01 | Plano sin sobrescritura | APROBADA_LOCAL (§50) |
| A02 | Configuración comprensible | APROBADA_LOCAL (§50) |
| A03 | Editor/vista previa de carta | APROBADA_LOCAL (§50) |
| A04 | Contenedores y QR preservados | APROBADA_LOCAL (§50) |
| A05 | Métricas y textos veraces | APROBADA_LOCAL (§50) |
| V01 | Recorridos integrados | APROBADA_LOCAL (§51) |
| V02 | Concurrencia y fallos | APROBADA_LOCAL (§52) |
| V03 | Visual/accesibilidad | APROBADA_LOCAL (§53) |
| V04 | Regresión y arranque limpio | APROBADA_LOCAL (§54) |
| V05 | Evaluación de tareas | APROBADA_LOCAL: simulación (§55); humano pendiente |
| V06 | Entrega con dictamen | APROBADA_LOCAL: dictamen técnico (§56); piloto NO-GO |

## 4. Fixture financiero de referencia

Usar una sesión aislada, nunca reutilizar una cuenta que el usuario esté explorando. Importes expresados aquí en unidades monetarias; la implementación usa la unidad mínima exacta correspondiente.

1. Enviar y aceptar tanda A: 1.000.
2. Enviar y aceptar tanda B: 2.500. Consumo esperado: 3.500.
3. Enviar y aceptar tanda C: 500. Consumo esperado: 4.000.
4. Añadir borrador D de 700 sin enviarlo. Consumo sigue en 4.000; carrito muestra 700 separado.
5. Cancelar C con autorización y motivo. Consumo esperado: 3.500.
6. Registrar pago parcial de 1.000 por el camino autorizado. Saldo: 2.500.
7. Registrar 2.500 restantes y propina de 200 separada. Consumo: 3.500, pagos de consumo: 3.500, propina: 200, saldo: 0.
8. Resolver explícitamente borrador y pendientes físicos antes de liberar. Nueva ocupación inicia sin consumo heredado.

Si la política de producto restringe parciales, probar el paso 6 por el contrato de registros existentes y documentar el camino UI soportado; nunca simular un pago válido alterando directamente un total. Ejecutar variante en modo validación: antes de aceptar B, mostrarla pendiente y no integrarla al cobrable.

## 5. Matriz funcional y de fallos

Todas las filas comienzan PENDIENTES. Las pruebas de API deben consultar persistencia y las de interfaz recorrer acciones reales.

| Caso | Escenario | Resultado exigido | Etapas / nivel |
|---|---|---|---|
| T01 | Tres tandas seguidas | Cuenta cliente/caja suma las tres, no solo última | B02–B03, C06, S08 / API+UI |
| T02 | Nuevo borrador tras enviar | Carrito separado; consumo enviado no desaparece | B03, C04–C06 / API+UI |
| T03 | Mismo plato en varias tandas | Cantidades/importes correctos; cocina conserva tandas | B03, C05, S06 / API+UI |
| T04 | Validación requerida, aceptación/rechazo | Pendiente separado; rechazo no cobrable; estado claro | B01, C05, S06 / API+UI |
| T05 | Cancelación autorizada | Total y saldo recalculados; motivo/auditoría conservados | B03–B04, S08 / API+UI |
| T06 | Parcial, saldo final y propina | Conciliación exacta sin mezclar propina con consumo | B04, C06, S08 / API+UI |
| T07 | Pagar una tanda con otra sin pagar | No declarar toda mesa pagada ni liberarla | B05 / API+UI |
| T08 | Dos cobros simultáneos y reintento | Una liquidación efectiva; conflicto/repetición segura | B04, S08 / API+UI |
| T09 | Pedido nuevo mientras se cobra | Versión vieja no oculta consumo; arbitraje consistente | B04, B06, C06 / API+UI |
| T10 | Doble submit y respuesta perdida | Un ticket; cliente recupera resultado incierto | B06, C05 / API+UI |
| T11 | Dos comensales editan carrito | Sin cambios perdidos silenciosamente ni total corrupto | B06, C04 / API+UI |
| T12 | Stock/precio cambia antes de enviar | Política explícita; precio histórico intacto; error localizado | B06, C04, A03 / API+UI |
| T13 | Token vence o sesión cierra con deuda | Acceso explicado; deuda persiste; no liberación falsa | B05, C08 / API+UI |
| T14 | Borrador pendiente al liberar y nueva ocupación | No cobrar borrador; resolución explícita; aislamiento | B05 / API+UI |
| T15 | Acceso a otra mesa/sesión/instancia | Datos y mutaciones denegados sin filtrar cuentas | B03, S09 / API |
| T16 | Mesa con llamado e insumos/cuenta simultáneos | Motivos distintos visibles; resolver uno no elimina otro | C07, S02–S03 / API+UI |
| T17 | Cancelar mientras personal toma tarea | Resultado coherente y aviso a ambos lados | C07, S03 / API+UI |
| T18 | Dos operadores toman misma tarea | Una toma válida y conflicto comprensible | S03, S09 / API+UI |
| T19 | Ráfaga de tareas y antiguas pendientes | Sin saltos bajo el dedo ni inanición de tareas | S03–S04, S10 / UI |
| T20 | Pedido manual + QR en misma ocupación | Cuenta única, origen auditado, cocina consistente | S05–S06 / API+UI |
| T21 | Cocina recibe mientras terminal muestra cuenta | Señal persistente; ticket no perdido por navegación | S06, S08 / UI |
| T22 | Listo, entrega parcial, entrega repetida | Trabajo generado una vez; solo lo entregado se resuelve | S06–S07 / API+UI |
| T23 | Saldo cero pero mesa ocupada/sucia | No disponibilidad automática | B05, S07 / API+UI |
| T24 | Cambio de actor y permiso vencido al cobrar | Auditoría correcta; privilegio no queda heredado | S09 / API+UI |
| T25 | Red caída, suspensión y servidor reiniciado | Datos viejos señalizados, backoff y recuperación sin duplicar | C08, S10 / integración |
| T26 | Sonido bloqueado y ráfaga tras reconexión | Estado visible; sin alarma repetitiva por cada polling | S10 / UI |
| T27 | 22 mesas en tablet horizontal | Pendientes localizables sin recorrer scroll de mesas | S01, S04, V03 / UI |
| T28 | Carta con zoom, texto largo y sin fotos | Nombre/precio/acciones accesibles; fondo blanco | C03–C04, V03 / UI |
| T29 | Teclado, volver, cerrar modal y refresh | Foco/contexto recuperables; no callejón sin salida | C08, V03 / UI |
| T30 | Nombre/nota con marcado malicioso | Renderiza texto seguro; no ejecuta contenido | C06, S05, S08 / seguridad+UI |
| T31 | Mover mesa y esperar polling, guardar falla | Posición local persiste; cambios operativos continúan | A01 / store+UI |
| T32 | Dos editores cambian geometría | Conflicto explícito; no pérdida silenciosa | A01 / API+UI |
| T33 | Cambiar módulo no relacionado | Flags bloqueados preservados; razón visible | A02, S11 / API+UI |
| T34 | QR descargado y mesa movida/unida | Link dirige a identidad correcta; cuentas no fusionadas | A04, B05 / URL+UI |
| T35 | Reintento de evento y métricas | Sin doble conteo; medido/estimado identificable | A05 / API+datos |
| T36 | Setup aislado y smoke final | Arranque repetible; tres interfaces y API disponibles | V04–V06 / sistema |

## 6. Matriz visual mínima

| Superficie | Tamaños / contexto | Revisiones |
|---|---|---|
| Cliente | 360×800 y 390×844 | Inicio, carta, detalle, carrito, historial, cuenta, llamado, sesión inactiva |
| Cliente ampliado | Zoom 200% y teclado | Sin corte de importes/acciones; foco y orden de lectura |
| Terminal | 1024×768 y 1366×768 | 22 mesas, múltiples pendientes, cocina, cuenta y conflicto |
| Tablet vertical | 768×1024 | Navegación y acciones sin suponer ancho de escritorio |
| Admin | 1024×768 y 1366×768 | Plano con borrador, configuración, editor y QR |

Estados transversales: vacío, cargando, error, muchos registros, nombres extensos y reconexión. Capturar antes/después en la misma resolución. Evitar capturas con tokens, PIN o datos personales visibles.

## 7. Criterios de severidad

- Bloqueante financiero/seguridad: importe omitido, duplicación de pago/pedido, fuga de cuenta, liberación con deuda, privilegio indebido. Detener aprobación del flujo.
- Bloqueante operativo: tarea o ticket aceptado pero invisible, camino sin salida, acción crítica inaccesible, datos viejos presentados como actuales durante fallo prolongado.
- Importante UX: dificultad para localizar pendientes, estados confusos, tipografía ilegible, demasiados pasos. Impide aprobar su gate aunque build pase.
- Menor: detalle cosmético que no altera lectura, acción ni coherencia. Puede ir a backlog identificado; no usar esta categoría para controles tapados.

## 8. Gates y dictamen

| Gate | Exigencia | Estado inicial |
|---|---|---|
| G1 | Cuenta, cobro y concurrencia consistentes | APROBADA_LOCAL (§51–§52) |
| G2 | Cliente legible y recorrido completo | APROBADA_LOCAL (§51, §53) |
| G3 | Servicio/cocina operables en terminal simulado | APROBADA_LOCAL: terminal simulado (§51–§52) |
| G4 | Admin estable y capacidades/QR preservados | APROBADA_LOCAL (§50, §53–§54) |
| Cierre local | G1–G4 + V01–V04 + simulación V05, sin bloqueantes | APROBADA_LOCAL TÉCNICA (§56) |
| Operación física | Recepción real en cocina, disposición/audio/táctil y usuarios | PENDIENTE EXTERNO |
| Despliegue por local | Recursos/configuración/restauración y validación cloud | FUERA DE ESTE CICLO |

GO local significa que las pruebas definidas pasaron en el entorno documentado, no «cero errores posibles». La entrega debe explicar exactamente qué queda por observar en el local. Si V05 no cuenta con personas, la evaluación humana queda pendiente sin impedir entregar evidencia técnica y simulación.

## 9. Primera sesión de ejecución

Comenzar por B00, B01 y B02. No iniciar reescritura masiva de staff ni activar módulos. El primer resultado funcional esperado es B03: demostrar que dos y tres envíos siguen presentes en la cuenta y que un borrador no reemplaza el consumo. Luego cerrar cobro/liberación antes de declarar resuelto el problema financiero.

## 10. Registro de ejecución B00 (2026-09-08, OpenCode)

```text
ID / fecha / responsable: B00 / 2026-09-08 / OpenCode (ejecutor MesaYA)
Checkout / commit de referencia / diff propio:
  rama: antigravity/core-capabilities-stage00; HEAD: 0773ca622616d261b6cc20d83cd98a0c5f6eafc4
  worktree principal sucio con cambios de usuario preservados (59 modificados + ~30 untracked);
  sin reset/checkout/clean/stash; otros worktrees intactos (admin-ux, cocina-cuentas x3, opencode-stage00).
  diff propio de esta etapa: solo docs/.../03-VERIFICACION-Y-CONTROL.md (tablero + este registro).
Hipótesis y alcance: congelar línea base reproducible sin mutar datos del usuario ni detener servicios.
Archivos cambiados: docs/implementacion/plan-ux-servicio-2026-09-08/03-VERIFICACION-Y-CONTROL.md
Prueba que fallaba antes (si aplica): no aplica (etapa de baseline, sin corrección).
Comandos ejecutados y códigos de salida:
  git branch --show-current / rev-parse / status / worktree list / log (exit 0)
  node --version (v24.17.0) / npm --version (12.0.2) (exit 0)
  GET http://localhost:3000/health -> ok (exit 0)
  GET http://localhost:3000/v1/health -> ok (exit 0)
  GET /v1/restaurants -> 1 restaurante (Trattoria del Puerto) (exit 0)
  GET /v1/restaurants/trattoria-del-puerto/menu -> 4 categorías, 9 items aprox. (exit 0)
  POST /v1/auth/login-admin {trattoria-del-puerto, 9999} -> MANAGER ok (exit 0, token no persistido)
  POST /v1/staff/login {trattoria-del-puerto, 1234} -> WAITER ok (exit 0, token no persistido)
  GET /v1/restaurants/trattoria-del-puerto/config -> requireWaiterValidation=true, paymentMode=WAITER_ONLY (exit 0)
  GET http://localhost:5173,5174,5175 -> 200/200/200 (exit 0)
  node scripts/test-local.mjs packages/api/test/route-matrix-guard.test.ts -> exit 1, "No test files found"
    (causa: ruta/filtro incorrecta respecto al cwd del runner packages/api; no es defecto de la aplicación).
    Reintento corregido: node scripts/test-local.mjs test/route-matrix-guard.test.ts -> 1 passed
    (exit 0, sandbox efímero auto-limpiado). Se registra el primer resultado sin ocultarlo.
Procesos registrados (no detenidos ni matados):
  puertos en escucha: 3000 (pid 10560), 5173 (12300), 5174 (25100), 5175 (27248);
  múltiples node de Codex runtimes conviviendo; no se alteraron.
Fixture / IDs de sesión y pedidos (sin tokens secretos): sin mutación; seed demo verificado en vivo
  (restaurant id 1b11d363-...); sandbox de test con seed efímero separado (tokens de sandbox descartados).
Resultado esperado y observado:
  esperado: API ok + carta pública + logins + frontends 200 + baseline acotada verde.
  observado: todo lo anterior coincide. Cobertura existente: 42 suites en packages/api/test.
Capturas / logs sanitizados / evidencia persistida:
  sin capturas de pantalla en esta pasada (limitación); evidencia = respuestas JSON resumidas arriba
  y salida de vitest (1 passed). No se guardaron tokens/PIN en el registro más allá de los PIN demo ya documentados.
Limitaciones y casos pendientes:
  B00 no reproduce ni corrige el defecto de cuenta (pendiente B01/B02); no se ejecutó la suite completa
  (solo route-matrix-guard acotado); capturas visuales cliente/staff/admin pendientes; fallos conocidos
  (cuenta parcial, borrador desplaza consumo, caja por comanda, plano sobrescribe) siguen abiertos y
  separados de fallos nuevos (ninguno nuevo detectado en esta pasada).
Reversión o recuperación: sin cambios funcionales; revertir este registro = git checkout -- <este archivo>
  (no ejecutado; solo documentado como vía, preservando el resto del checkout sucio).
Estado y siguiente paso: EN_REVISION (no APROBADA_LOCAL; requiere revisión humana).
  Siguiente permitido: preparar B01 (contrato) y luego B02 (reproducción real de tres tandas +
  borrador + consultas cliente/caja, sin arrays ficticios). Sin migraciones ni rediseño masivo.
  Corrección de reauditoría 2026-09-08: B00 conserva EN_REVISION; faltan capturas y suite completa.
```

## 11. Adenda B01 — HISTÓRICA (insumo previo a C1–C7, no vigente como decisión)

Esta sección conserva el estado previo a la redacción del contrato y queda SUPERADA por
`04-CONTRATO-CUENTA-B01.md` (decisiones operativas C1–C7 de esta ejecución): B01 ya no está
PENDIENTE sino EN_REVISION (§13), y las alternativas D1–D7 quedaron convertidas en C1–C7.
La aprobación de Codex/usuario sigue pendiente (no inventada). Las filas D1–D7 se leen solo
como trazabilidad del insumo; ante cualquier diferencia prevalece 04-, incluidas las
correcciones de reauditoría (inventario exacto de importes en C3, no el resumen de D3).
B02 puede reproducir el defecto sin corregirlo; B03/B04 requieren contrato validado.

| # | Decisión | Alternativa A | Alternativa B | Recomendación técnica (no vinculante) | Estado |
|---|---|---|---|---|---|
| D1 | Cuenta operativa | `TableSession` (token/QR, ya enlaza `Order`/`CallRequest`) | `OccupancySession` (hoy sin relación a pedidos/pagos/llamados; métricas de ocupación) | A: evita migración y respeta el seed/QR vigentes; B exigiría contrato de transferencia contable propio | NEEDS_REVIEW |
| D2 | Definición de tanda | Cada `Order` enviado = una tanda inmutable con su estado | Ventana temporal o comanda mutable agregada | A: conserva historial/preparación por tanda (compatible con análisis §3) | NEEDS_REVIEW |
| D3 | Dinero exacto | Unidad mínima entera + redondeo único | `Float` actual (`Order.totalAmount`, `PaymentTransaction.amount`) | Entera: elimina deriva de céntimos antes de B03/B04 | NEEDS_REVIEW |
| D4 | Pagos parciales | Camino normal = saldo completo; parcial secundario con conciliación | Parciales de primera clase / división automática | Camino normal saldo + parcial secundario auditado; no hay división digital (fuera de ciclo) | NEEDS_REVIEW |
| D5 | Separación pago/preparación | `PaymentTransaction` por cuenta de sesión, independiente del estado de cocina | Pago atado a `Order.id` (modelo actual de caja por comanda) | Por cuenta: pagar una tanda no libera la mesa; `SERVED` no implica cobrado | NEEDS_REVIEW |
| D6 | Cardinalidad de llamados | Un activo por motivo (`BILL`/`WAITER`/`SUPPLIES`/`CUSTOM`) y mesa | Uno solo por sesión (`activeKey=tableSessionId`, modelo actual) | Por motivo: evita que una cuenta oculte comida lista y viceversa | NEEDS_REVIEW |
| D7 | Modo directo/validación | Validación (`requireWaiterValidation=true`, efectivo hoy): pendiente separado, no cobrable | Directo: envío = consumo + ticket, solo con receptor de cocina confirmado | Validación por defecto; directo solo con circuito de recepción documentado | NEEDS_REVIEW |

Evidencia de esquema (solo lectura, sin cambios): `Table.sessions/TableSession.orders+payments`,
`CallRequest.activeKey @unique por tableSessionId`, `Order.status` con `DRAFT/PENDING_VALIDATION/...`,
`OccupancySession` sin enlaces a pedidos/pagos/llamados (`schema.prisma` líneas ~145–295, 486–512).
Config efectiva observada en B00: `requireWaiterValidation=true`, `paymentMode=WAITER_ONLY`.

## 12. Registro de ejecución B02 (2026-09-08, OpenCode)

```text
ID / fecha / responsable: B02 / 2026-09-08 / OpenCode (ejecutor MesaYA)
Checkout / commit de referencia / diff propio:
  rama: antigravity/core-capabilities-stage00; HEAD: 0773ca6 (sin commits nuevos).
  Cambios previos del usuario preservados; sin reset/checkout/clean/stash.
  Archivos propios de esta etapa (ambos untracked, cero archivos de aplicación tocados):
    - packages/api/test/b02-partial-bill-repro.test.ts (nuevo, ~200 líneas)
    - docs/.../03-VERIFICACION-Y-CONTROL.md (esta sección + fila B02 a EN_REVISION)
Hipótesis y alcance: reproducir con contrato real que la cuenta actual devuelve
  borrador o última tanda en lugar del consumo acumulado. Sin corregir (B03/B04
  pendientes), sin migraciones, sin rediseño UI. B01 D1–D7 siguen NEEDS_REVIEW (§11).
Fixture aislado (filas reales en SQLite efímera, sin mocks de persistencia):
  restaurante/turno/mesa/sesión B02 + encargado; 4 platos (1000/2500/500/700).
  Tandas aceptadas A=1000, B=2500, C=500 en SERVED; borrador D=700 en DRAFT.
  Consumo enviado esperado: 4000; borrador separado: 700.
Consultas reales ejercitadas (las mismas que cliente y caja):
  - Cliente: GET /v1/orders/session/:token (lo que renderiza loadBillDetails).
  - Servicio: OrderService.getActiveOrder (contrato compartido).
  - Caja: GET /v1/staff/restaurants/:id/cash-orders con token MANAGER (lo que consume CashManager).
Comandos ejecutados y códigos de salida:
  node scripts/test-local.mjs test/b02-partial-bill-repro.test.ts -> exit 1 (esperado pre-fix):
    3 failed / 3. Cliente y servicio devuelven status DRAFT (borrador 700 desplaza
    el consumo de 4000); caja incluye 1 fila DRAFT como cobrable y fragmenta por comanda
    en lugar de una vista por cuenta de sesión. Sandbox .tmp/test-local auto-limpiado
    (0 restos); dev.db del usuario intacta (sin escritura; LastWriteTime inalterado).
  Re-ejecución de confirmación -> mismo resultado (3 failed / 3); fallo funcional
    estable, no flaky. Sin fallos de harness/ruta en esta etapa (ruta ya corregida en B00).
Resultado esperado y observado:
  esperado (contrato correcto): cuenta 4000, borrador excluido, caja agregada por sesión.
  observado (comportamiento actual): cuenta = borrador/last-order; caja por Order.id.
  La regresión distingue historial acumulado de último pedido y excluye borradores
  en su esperado; falla SÓLO por el defecto funcional, sin maquillaje.
Capturas / logs sanitizados / evidencia persistida:
  salida Vitest (3 failed, AssertionErrors DRAFT / draftRows length 1) en consola;
  fixture y asserts en packages/api/test/b02-partial-bill-repro.test.ts. Sin tokens/PIN
  reales (PIN 9999 solo en sandbox efímero ya destruido).
Limitaciones y casos pendientes:
  No cubre cancelación, parciales, concurrencia ni modo validación (T05–T12 de la matriz);
  eso corresponde a B03–B06/V01. UI cliente/caja no recorrida en navegador en esta etapa.
Reversión o recuperación: borrar el archivo de test nuevo y revertir este registro;
  ningún dato de usuario afectado (todo ocurrió en sandbox efímero).
Estado y siguiente paso: EN_REVISION (NO APROBADA_LOCAL: la corrección B03 no existe aún).
  El caso queda preparado para pasar tras B03. B03/B04 requieren cerrar antes el
  contrato B01 (D1–D7 NEEDS_REVIEW); no elegir cuenta/dinero/parciales/llamados/modo
  silenciosamente.
```

## 13. Registro de ejecución B01 (2026-09-08, OpenCode)

```text
ID / fecha / responsable: B01 / 2026-09-08 / OpenCode (ejecutor MesaYA; Codex supervisa después)
Checkout / commit de referencia / diff propio:
  rama: antigravity/core-capabilities-stage00; HEAD: 0773ca6 (sin commits nuevos).
  59 modificaciones trackeadas preexistentes intactas; sin reset/checkout/clean/stash.
  Archivos propios acumulados (untracked, solo docs/control + test B02):
    - docs/implementacion/plan-ux-servicio-2026-09-08/04-CONTRATO-CUENTA-B01.md (nuevo: contrato C1–C7)
    - docs/.../03-VERIFICACION-Y-CONTROL.md (fila B01 a EN_REVISION + esta sección)
    - packages/api/test/b02-partial-bill-repro.test.ts (de B02, sin cambios en este turno)
  Cero archivos de aplicación/schema tocados en B01 (verificado por git status).
Hipótesis y alcance: cerrar el contrato que B03/B04 implementarán, solo en documentación.
  Decisiones C1–C7 son operativas de esta ejecución y se marcan como tales: NO constituyen
  aprobación del usuario; la validación final es de Codex + usuario (§04, última sección).
Archivos cambiados: 04-CONTRATO-CUENTA-B01.md (nuevo), 03-VERIFICACION-Y-CONTROL.md (§13 + fila).
Prueba que fallaba antes (si aplica): B02 sigue fallando pre-fix por diseño (3/3, §12);
  B01 no corrige nada y no altera ese resultado.
Comandos ejecutados y códigos de salida (todos solo lectura):
  git branch --show-current / rev-parse --short HEAD / status (exit 0):
    antigravity/core-capabilities-stage00, 0773ca6, 59 trackeadas + mis 2 untracked.
  Select-String 'Float' en schema.prisma + supabase (exit 0) + lectura PaymentTransaction 279–295:
    inventario corregido en reauditoría: cuenta = Order.totalAmount (236),
    OrderItem.unitPrice (252), SplitBillSession.{partAmount,totalAmount,remainingAmount}
    (271–273), PaymentTransaction.{amount,tipAmount,applicationFee} (287–289),
    OccupancySession.totalRevenue (501); catálogo = MenuItem.price (133);
    orderId obligatorio con Cascade (281–282) -> bases de C3/C4 (04-, sin conteo falso).
  Select-String shared/index.ts OrderStatus (exit 0): ciclo DRAFT..SERVED + PAID/CANCELLED -> base de C2.
  Select-String schema.prisma 'activeKey' (exit 0): sesión/turno/llamado; llamado único por
    sesión hoy -> base de C5.
  Select-String schema.prisma 'requireWaiterValidation|allowOrdering|allowSplitBill' (exit 0):
    defaults true/true/false -> base de C6.
  OccupancySession ~486–512 sin FK a Order/Payment/Call (lectura previa, §11) -> base de C1.
Fixture / IDs: sin fixture nuevo ni mutación (etapa documental; B02 ya fijó su fixture aislado).
Resultado esperado y observado:
  esperado: contrato C1–C7 + invariantes I1–I7 + compatibilidad + riesgos + salidas B03–B06.
  observado: redactado en 04-CONTRATO-CUENTA-B01.md; coherente con análisis §3, B02 y schema.
Capturas / logs: no aplican (documental); evidencia = comandos de solo lectura de arriba.
Limitaciones y casos pendientes:
  Contrato no validado por Codex/usuario (3 puntos explícitos en §04); recepción física en
  cocina, terminal real y usuarios siguen PENDIENTE_EXTERNO; suite completa no ejecutada.
Reversión o recuperación: borrar 04-... y revertir §13/fila (no ejecutado; checkout preservado).
Estado y siguiente paso: EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Me detengo aquí: no ejecuto B03 ni otra etapa. Siguiente (tras validación Codex/usuario):
  B03 implementa la proyección agregada contra este contrato hasta pasar B02.
```

## 14. Registro de reauditoría B01 (2026-09-08, OpenCode; Codex aún no autoriza B03)

```text
Alcance: solo docs (04-CONTRATO-CUENTA-B01.md, §11/§13 de este archivo). Cero app/schema/tests.
Falencias corregidas:
  (1) C3: eliminado el conteo falso "7 campos"; inventario exacto por líneas (cuenta 236,
      252, 271–273, 287–289, 501; catálogo 133; no monetarios excluidos) + alcance entero C3.
      §13 línea de evidencia corregida en igual sentido.
  (2) §11: marcada HISTÓRICA y superada por 04- (C1–C7 operativas, aprobación pendiente
      no inventada); ya no afirma PENDIENTE ni "ninguna alternativa elegida" como vigente.
  (3) C4: modelo actual (orderId obligatorio + Cascade, 281–282) separado del objetivo
      (liquidación por sesión con asignaciones por Order, orderId opcional con guardia
      xor, fuente única, legadas solo lectura).
  (4) C5: unicidad verificable (activeScopeKey no-nula @unique; @@unique-con-NULL
      descartado por semántica NULL≠NULL en SQLite/PG) + prueba concurrente obligatoria.
  (5) Barrido: sin otras contradicciones estado/contrato/registro (B00/B01/B02 EN_REVISION;
      B02 pre-fix 3/3 inalterado; riesgos y PENDIENTE_EXTERNO coherentes).
Comandos/evidencia (solo lectura, exit 0): Select-String 'Float' en ambos schemas
  (17 Float en supabase; lista exacta en sqlite) + lectura PaymentTransaction 279–295.
  git status: 59 trackeadas preexistentes intactas; propios solo untracked docs+test B02.
Estado: B01 EN_REVISION, nunca APROBADA_LOCAL. B03 sigue bloqueado hasta validación Codex/usuario.
```

## 15. Aprobación B01 + registro de ejecución B03 (2026-09-08, OpenCode Spark 1.3)

```text
B01 — APROBADA_LOCAL (2026-09-08): Codex ratificó C1–C7 como contrato operativo de
  esta ejecución (04-CONTRATO-CUENTA-B01.md + correcciones §14). ALCANCE EXPLÍCITO:
  aprueba el documento de contrato para implementar B03/B04 contra él; NO es GO de
  staging/producción, NO certifica operación física ni aprueba usuarios reales
  (siguen PENDIENTE_EXTERNO). Sin cambios de código en este acto.

B03 — cuenta agregada por TableSession (implementada, EN_REVISION hasta reauditoría Codex).
ID / fecha / responsable: B03 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Checkout / commit: antigravity/core-capabilities-stage00, 0773ca6, sin commits nuevos.
Archivos propios (código: 2 trackeadas ya modificadas por el usuario, sin archivos nuevos
  trackeados; tests/docs: untracked):
  - packages/api/src/services/order.service.ts: SessionAccountDTO/SessionTandaLineDTO,
    toMinor (enteros), SESSION_CONSUMO_STATUSES, getSessionAccount, getCashAccounts,
    resolveCashRestaurant (extraído sin cambiar semántica de getCashOrders),
    getActiveOrderForGuest suma `account` (order/carrito intacto).
  - packages/api/src/routes/orders.routes.ts: cash-orders devuelve {orders legadas, accounts}.
  - packages/api/test/b02-partial-bill-repro.test.ts: actualizado al contrato post-fix
    (mismo escenario; `account` en vez de `order` para la cuenta; carrito DRAFT verificado).
  - packages/api/test/b03-session-account.test.ts (nuevo): exclusiones, suma multi-tanda,
    pagado/propina/saldo, consistencia cliente/caja (total+versión), versión estable,
    aislamiento sesión/tenant.
  - Esta sección + filas B01/B03 en 03-VERIFICACION-Y-CONTROL.md.
  Diff preservado: las 59 trackeadas preexistentes intactas (mis ediciones caen en 2 de
  ellas); sin reset/checkout/clean/stash; dev.db sin migraciones ni borrados.
Contrato aplicado: consumo = CONFIRMED/IN_KITCHEN/READY_TO_SERVE/SERVED/PAID-historial
  (I1; PAID incluido para no quebrar I2); excluidos DRAFT/PENDING_VALIDATION/CANCELLED;
  pagos APPROVED|MANUAL_SETTLED; propina separada; versión sha1 determinista 16 hex;
  getActiveOrder/addItem/submit y hasUnpaidBalance sin cambios (B05/B06 competentes).
C3 — decisión documentada (NEEDS_REVIEW Codex, no bloquea B03): B03 expone PROYECCIÓN
  redondeada a centavos desde el Float legado (aritmética en enteros, nada persistido
  en minor-unit); columnas persistidas DIFERIDAS a B04 con justificación: agregarlas
  ahora exigiría migrar la dev.db del usuario en uso por los servidores locales +
  backfill dual SQLite/Supabase en la misma etapa que el cambio lógico (riesgo de romper
  runtime y paridad). Sin conversión destructiva, sin historia tocada, sin afirmar
  "exacto persistido".
Comandos y códigos (runner correcto scripts/test-local.mjs, sandbox efímero auto-limpiado):
  test/b02... + test/b03... -> exit 0, 2 passed / 8 passed.
  reejecución + test/cash-contract + test/route-matrix-guard -> exit 0, 4 passed / 13 passed.
  npx tsc --noEmit -p packages/api -> exit 0.
  (Ruta con prefijo packages/api/... ya no se usa: documentada como harness-error en B00.)
Resultado esperado/observado: B02 en verde post-fix (cuenta 4000/400000, borrador fuera,
  carrito DRAFT intacto); B03: consumo 4800 con pago 1000/propina 100/saldo 3800 exactos,
  cliente=caja en total y versión, 1 cuenta por sesión, R2 ausente de R1. Todo coincide.
Limitaciones: UI cliente/caja aún no cableada a `account` (C06/S08); versión no persistida
  (B04 la necesitará para liquidación); N+1 en getCashAccounts (aceptable B03);
  PENDING_VALIDATION visible pero no cobrable (correcto por contrato);
  métricas/planos/modos sin cambios.
Reversión: revertir los 2 archivos de código + 2 de test y esta sección; sin datos afectados.
Estado y siguiente paso: B03 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido aquí: no B04–B06 ni UI. Siguiente tras reauditoría Codex: B04 contra C4/I2/I4.
```

## 16. Registro de reauditoría B03 (2026-09-08, OpenCode; B03 sigue EN_REVISION)

```text
Alcance: solo B03 (order.service.ts: fingerprint + comentarios; b02/b03 tests;
  04-C3 y §15 notas de estado). Cero B04/UI/schema/migraciones; dev.db intacta.
Correcciones Codex (4):
  (1) Versión = fingerprint completo: tandas (id, estado, total, created/updated,
      líneas itemId/cantidad/unitPrice), pagos (id, orderId, estado, importes,
      createdAt), pending/draft con importes y timestamps. Sin secretos (sin tokens,
      sin guestSessionId, sin mpPaymentId). Test B03: estable entre lecturas idénticas
      + cambia ante nueva tanda (consumo/saldo +30000) con cliente=caja tras el cambio.
  (2) B02: eliminado "(pre-fix, debe fallar)"; getActiveOrder ya no se presenta como
      cuenta (carrito DRAFT por contrato); evidencia pre-fix solo en §12; nota de que
      la UI no consume `account` hasta C06/S08. B03: test de versión renombrado a lo
      que comprueba (estable + sensible).
  (3) C3 explícito en código/tests/04/§15: proyección redondeada desde Float legado,
      nada persistido en minor-unit; migración/backfill/ledger → B04 (NEEDS_REVIEW).
  (4) Sin asserts relajados ni skips: 8/8 con el nuevo test de cambio de versión.
Comandos (scripts/test-local.mjs, sandbox auto-limpiado):
  test/b02... + test/b03... -> exit 0, 2 passed / 8 passed (focalizado).
  reejecución idéntica -> exit 0, 2 passed / 8 passed (estable).
  tsc --noEmit -p packages/api -> exit 0.
  (Codex: 8/8 + tsc 0 independientes; coincidentes.)
Alcance B04 NO necesario para el fingerprint (solo lectura agregada; sin cobros).
  Si B04 requiere versión persistida/incremental, se decide allí.
Estado: B03 EN_REVISION, nunca APROBADA_LOCAL. Detenido: no B04 ni UI.
```

## 17. Cierre local B02 + B03 (2026-09-08; reauditoría Codex independiente)

Codex ejecutó por su cuenta B02+B03+cash-contract+route-matrix = 13/13 y tsc = 0,
coincidente con la evidencia OpenCode. Con esa doble verificación se marcan B02 y B03
APROBADA_LOCAL con ALCANCE EXPLÍCITO: aprueban la regresión y la proyección de cuenta
en el entorno local documentado; NO son GO de staging/producción, NO certifican
operación física ni usuarios reales (PENDIENTE_EXTERNO). B00 SIGUE EN_REVISION
(faltan capturas y suite completa). §12 conserva la evidencia pre-fix histórica.

## 18. Registro de ejecución B04 (2026-09-08, OpenCode Spark 1.3; EN_REVISION)

```text
ID / fecha / responsable: B04 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Checkout: antigravity/core-capabilities-stage00, 0773ca6, sin commits nuevos.
Contrato aplicado: 04- C3/C4/I2/I4. Camino NUEVO por cuenta; vía legada order-pay
  intacta (código y ruta sin cambios) para compatibilidad; S08 consumirá el nuevo.
Archivos propios:
  código (2 trackeadas ya modificadas por el usuario):
  - order.service.ts: SettleSessionInput/SettlementDTO, SETTLE_METHODS presenciales,
    settleSessionAccount (tx única: idempotencia → versión → monto → asignaciones →
    registro+ledger), loadAccountData (prisma o tx), cuenta suma settlements
    (tablas disjuntas, sin doble conteo), fingerprint incluye settlements,
    P2002/P2034 → 409. Sin marcar PAID, sin liberar, sin bucles de navegador.
  - orders.routes.ts: POST /v1/staff/sessions/:sessionId/settle [staff+manager]
    (201 nuevo / 200 replay; errores con code+details).
  schema aditivo (2 trackeadas ya modificadas + 1 migración untracked):
  - schema.prisma + schema.supabase.prisma (vía sync script): AccountSettlement +
    SettlementAllocation (todo Int) y 10 columnas *Minor anulables con backfill;
    historia Float intacta. Migración
    migrations-postgres/20260908120000_b04_account_settlements/migration.sql
    (CREATE×2, ALTER ADD, UPDATE backfill re-ejecutables, sin DROP/DELETE).
    dev.db NO migrada ni tocada (sin db push/migrate contra ella; deploy fuera de ciclo).
  - scripts/route-matrix.json: +1 entrada MANAGER (87 rutas, guard verde).
  tests (untracked): packages/api/test/b04-account-settle.test.ts (10 casos §1–10).
  docs: esta sección + filas B02/B03 (§17).
  Diff preservado: 59 trackeadas preexistentes intactas; sin reset/checkout/clean/stash,
  sin matar procesos, sin deploy/push/cloud. Cliente Prisma regenerado en
  node_modules (build local; el DLL en uso por el servidor no se reemplazó —binario
  idéntico— y el JS generado sí se actualizó; verificado por delegates + tests).
Comandos y códigos (test-local, sandbox efímero auto-limpiado, sin datos reales):
  test/b04 solo (1ª pasada): 8 passed + 2 failed funcionales (replay tras saldo 0 →
    422 por orden idempotencia→monto; carrera serializada → 422 en vez de 409).
    Diagnóstico con evidencia (log temporal, luego retirado): el perdedor resolvía
    monto 0. Corrección: orden idempotencia → versión → monto + P2034→409.
  test/b04 solo (tras corrección): exit 0, 10 passed.
  B02+B03+B04+cash-contract+route-matrix+parity: exit 0, 6 passed / 26 passed.
  reejecución idéntica: exit 0, 6 passed / 26 passed (estable).
  tsc --noEmit -p packages/api: exit 0.
Resultado: (1) completo exacto + asignaciones + cocina intacta; (2) propina separada;
  (3) replay misma clave = mismo efecto, 1 registro; (4) clave reutilizada = 409 sin
  escribir; (5) versión vieja = 409 accionable (currentVersion+saldo) sin escribir;
  (6) parcial concilia, overpayment 422; (7) waiter/otro tenant 403, manager cobra;
  (8) carrera = 1×201 + 1×409, total == saldo, saldo final 0 (observado serializado;
  intercalado cubierto por unique+P2002/P2034→409); (9) cliente=caja tras liquidar;
  (10) guard de esquema/migración verde. Sin skips.
Limitaciones y riesgos: UI no cableada (S08); versión no persistida aparte del ledger
  (B05 la necesitará para liberación); N+1 en caja; intercalado real multinstancia no
  observado (instancia única; V02/B06); SQL de migración no ejecutada contra PG
  (verificada por revisión + guard, no por apply); Float legado convive en lectura.
Reversión: revertir servicio/ruta/schema/migración/tests + esta sección; datos intactos.
Estado y siguiente paso: B04 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no B05/B06/UI. Siguiente tras reauditoría Codex: B05 contra C7/I5.
```

## 19. Registro de reauditoría B04 (2026-09-08, OpenCode; B04 sigue EN_REVISION)

```text
Alcance: solo B04 (servicio settle, schema/migración, tests b04, §18/§19, nota 04-C3
  ya existente). Cero B05/B06/UI; dev.db intacta (sin push/migrate contra ella).
Hallazgos Codex y correcciones:
  (1) C3 real: *Minor preferidos (order/item/payment) con fallback redondeado SOLO
      para historia; dual-write NO aplicado a escritores de otras etapas (addItem,
      submit/validate, registerManualPayment, menú, seed) — enumerados como limitación;
      docs ya no afirman exactitud global persistida.
  (2) Allocations agregadas por orderId: duplicadas se fusionan (suman) y el agregado
      se valida contra el saldo de la tanda (422 OVERPAYMENT accionable);
      @@unique(settlementId, orderId) en ambos schemas + índice unique en migración.
      Tests: duplicado que excede → 422 sin escribir; exacto multi-tanda concilia.
  (3) Inputs validados antes de reduce/map: allocations array de objetos, clave 1..200
      sin controles, safe-integers (monto > 0, propina ≥ 0). Payloads malformados →
      400/422 con code, nunca 500 (7 casos probados).
  (4) Fingerprint determinista: orderBy createdAt+id en orders/items/settlements
      (+allocations por orderId); hash suma resolvedAt de pagos. Test 5b: dos tandas
      con createdAt idéntico, lecturas estables.
  (5) Migración PG revisada: compatible canónica, aditiva, backfill solo-NULL
      (re-ejecutable), sin DROP/DELETE; guard B04(10) ampliado (unique index, ≥10
      UPDATEs todos con IS NULL). SQL NO aplicado a PostgreSQL (sin PG en el ciclo).
Comandos (test-local, sandbox auto-limpiado):
  test/b04 solo (1ª pasada): 13 passed + 1 failed FUNCIONAL (mi test 6b sumaba 120000
    contra monto 100000: fallaba por suma, no por exceso agregado). Corregido el test
    a 2 tandas con exceso agregado real → 14 passed. Sin relajar asserts.
  lote B02+B03+B04+cash+matrix+parity: exit 0, 6 passed / 30 passed (incluye
    `prisma validate` offline de ambos schemas vía parity, sin tocar dev.db).
  reejecución idéntica: exit 0, 6 passed / 30 passed (estable).
  tsc --noEmit -p packages/api: exit 0.
Limitaciones: escritores legacy no dualizan *Minor (addItem/submit/validate/
  registerManualPayment/menú/seed → B05+ o contrato de datos); UI sin cablear (S08);
  intercalado multinstancia no observado (guard DB); backfill PG solo en deploy.
Estado: B04 EN_REVISION, nunca APROBADA_LOCAL. Detenido: no B05/B06/UI.
```

## 20. Reauditoría acotada B04 — idempotencia por intención completa (2026-09-08)

```text
Hallazgo Codex: el replay comparaba sesión+método+propina+monto pero ignoraba el
  reparto; misma clave con igual monto y distinta asignación devolvía 200.
Corrección (sin campo nuevo, comparación determinista): replay solo si coinciden
  sesión+versión-existente+método+propina+monto+reparto normalizado por orderId
  (fusión idéntica a la de creación); cualquier diferencia → 409
  IDEMPOTENCY_KEY_REUSED sin escribir. Camino FIFO sin allocations: la
  accountVersion existente ancla la intención (replay tras saldo 0 conservado).
  Verificado: §19 no afirma dual-write legacy inexistente (lo enumera como
  limitación) y describe exactamente comandos/resultados.
Comandos (test-local, sandbox auto-limpiado; validate con env ficticio, sin PG,
  sin tocar dev.db):
  test/b04 solo: exit 0, 15 passed (nuevo 3b: distinto reparto → 409 + 1 settlement;
    reparto equivalente → 200 replay; replay/carrera/payloads intactos).
  lote B02+B03+B04+cash+matrix+parity: exit 0, 6 passed / 31 passed.
  reejecución idéntica: exit 0, 6 passed / 31 passed (estable).
  prisma validate schema.prisma (sqlite, fixture): válido.
  prisma validate schema.supabase.prisma (postgresql, fixture): válido.
  tsc --noEmit -p packages/api: exit 0.
Estado: B04 EN_REVISION, nunca APROBADA_LOCAL. Detenido: no B05/B06/UI.
```

## 21. Cierre local B04 (2026-09-08; reauditoría Codex independiente final)

Codex: corrida independiente 31/31, prisma validate SQLite y PostgreSQL con env
ficticio 0, sync parity 0, tsc 0, dev.db intacta. Con esa doble verificación se marca
B04 APROBADA_LOCAL con ALCANCE EXPLÍCITO: contrato, transacción y migración aprobados
solo en local; SQL NO aplicado a PG, operación física, staging, producción y usuarios
reales siguen fuera (PENDIENTE_EXTERNO / fuera del ciclo).

## 22. Registro de ejecución B05 (2026-09-08, OpenCode Spark 1.3; EN_REVISION)

```text
ID / fecha / responsable: B05 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Checkout: antigravity/core-capabilities-stage00, 0773ca6, sin commits nuevos.
Contrato: C7/I5/I7; cuenta B03/B04 como verdad. Sin B06/UI.
Archivos propios (código en trackeadas ya modificadas; tests/docs untracked):
  - order.service.ts: hasUnpaidBalance reescrita por cuenta (saldoMinor; conserva
    remainingAmount mayor + pendingBillCalls/activeOrdersCount por compatibilidad;
    añade remainingMinor/pendingCalls) + getSessionAccountTx(client) público.
  - session.service.ts: closeTableSession atómico en 1 tx (revalida saldo/borrador/
    validación/llamados y marca cierre juntos); eliminado auto-resolve + broadcast
    del cierre (solo acción explícita cambia llamados); force exige MANAGER (ruta)
    + motivo (400 sin él) y NUNCA omite guardas (auditado en metadata FSM);
    TO_CLEAN explícito, nunca AVAILABLE directo; firma (tableId,{force}) intacta.
    Import eventBus retirado (quedó sin uso).
  - tables.routes.ts: reason viaja solo si viene en el body (aserciones exactas
    e2e-audit intactas); RBAC waiter/manager/tenant sin cambios.
  - cash-contract.test.ts (untracked preexistente, ajuste mínimo documentado):
    test hasUnpaidBalance ahora mockea getSessionAccount + counts (nuevo contrato).
  - b05-safe-release.test.ts (nuevo, 9 casos §1–9).
  - Esta sección + filas B04 (§21) y B05 en 03.
  Diff preservado: 59 trackeadas preexistentes intactas + 1 nueva mía
  (tables.routes.ts: reason opcional de force; diff verificado como solo-B05);
  sin reset/checkout/clean/stash, sin procesos, sin deploy/push/cloud, dev.db
  intacta, sandbox efímero auto-limpiado.
Comandos y códigos (test-local):
  test/b05 solo: exit 0, 9 passed (primera pasada).
  lote B02+B03+B04+B05+cash+matrix+parity+e2e-audit+tables-shifts+full-system-e2e:
    exit 0, 10 passed / 90 passed (cierre real e2e intacto; firmas mockeadas intactas).
  reejecución idéntica: exit 0, 10 passed / 90 passed (estable).
  prisma validate ambos schemas (env ficticio): válidos. sync --check: sincronizado.
  tsc --noEmit -p packages/api: exit 0.
Resultado: (1) full settle sin saldo y fulfillment intacto; (2) parcial → 409 sin
  cerrar; (3) draft/pending bloquean, se resuelven por sus canales y no se cobran;
  (4) llamados bloquean sin auto-resolve; (5) cierre revoca token (410 público),
  TO_CLEAN≠AVAILABLE, ledger intacto, caja staff 200; (6) nueva ocupación en cero
  sin heredar; (7) mesas separadas aunque merged; (8) carrera settle-vs-close sin
  500 ni deuda perdida; (9) waiter limpia OK, force sin motivo 400, force con motivo
  ante deuda 409. Sin skips.
Limitaciones y riesgos: auto-resolve FSM en OTRAS transiciones (skip_to etc.) sigue
  existiendo (fuera de B05; ver S07); historial de cuenta cerrada no expuesto en
  cash-orders (S08); force es guardas+auditoría, no omisión (si se requiere excepción
  real → NEEDS_REVIEW futuro, no implementado).
Reversión: revertir 3 archivos código + 2 tests + esta sección; datos intactos.
Estado y siguiente paso: B05 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no B06/UI. Siguiente tras reauditoría Codex: B06 contra I4.
```

## 23. Reauditoría B05 — cobro tras cierre bloqueado (2026-09-08; B05 sigue EN_REVISION)

```text
Hallazgo Codex (bloqueante): settleSessionAccount no leía closedAt ni rechazaba un
  cobro intercalado tras el cierre: contradice el arbitraje cuenta/cierre.
Corrección (solo B05/B04-compat, sin B06/UI): loadAccountData incluye closedAt; si la
  sesión está cerrada, solo el replay seguro de intención completa (misma clave,
  sesión, método, propina, versión, monto, reparto) devuelve 200; lo demás es 409
  SESSION_CLOSED con details, sin escribir. Helper isSameSettleIntent extraído y
  reutilizado en el camino abierto (comportamiento idéntico). Sin campo nuevo.
Tests (b05, reales, sin mocks): (10) saldo→settle→cierre→replay misma intención 200
  sin duplicar→nueva clave 409 SESSION_CLOSED sin escribir, closedAt intacto.
  Ambos órdenes secuenciales cubiertos (settle→cierre en §22-5/9; cierre→cobro en
  §23-10) más carrera settle-vs-close (§22-8) que reparte ambos órdenes entre corridas.
Comandos (test-local, sandbox auto-limpiado; validate con env ficticio, sin PG,
  sin tocar dev.db):
  test/b05+b04: primera pasada 24/25 (fallo mío: helper mal nombrado en test nuevo,
    ReferenceError; corregido sin tocar asserts).
  test/b05+b04: exit 0, 25 passed.
  lote 10 archivos (B02+B03+B04+B05+cash+matrix+parity+e2e-audit+tables-shifts+
    full-system-e2e): exit 0, 91 passed.
  reejecución idéntica: exit 0, 91 passed (estable).
  prisma validate ambos schemas (ficticio): válidos. sync --check: sincronizado.
  tsc --noEmit: exit 0.
B05 sigue EN_REVISION, nunca APROBADA_LOCAL. Detenido: no B06/UI.
```

## 24. Cierre local B05 (2026-09-08; reauditoría Codex independiente)

Codex volvió a ejecutar B05+B04 dos veces (25/25 en cada corrida) y el lote
relevante B02–B05, caja, matriz, paridad y regresiones de cierre/acceso (91/91).
También verificó `tsc --noEmit` con salida 0, `prisma validate` válido para ambos
schemas con variables de entorno ficticias, `sync_supabase_schema.js --check` verde,
`git diff --check` limpio y sandbox efímero vacío; `dev.db` no fue modificada.

La reauditoría confirmó: cuenta agregada como verdad; saldo parcial bloquea; DRAFT y
PENDING_VALIDATION requieren resolución explícita; cualquier llamado pendiente bloquea
sin auto-resolve; liquidar no cambia fulfillment; el cierre revoca token y lleva a
`TO_CLEAN`, conserva ledger y no hereda datos en una ocupación nueva; la idempotencia
permite solo el replay completo y rechaza con `SESSION_CLOSED` un cobro nuevo sobre
una ocupación cerrada.

Estado: **B05 APROBADA_LOCAL**, únicamente para evidencia técnica local reproducible.
No implica SQL aplicado a PostgreSQL, staging, producción, operación física ni GO de
usuarios reales. B00 continúa EN_REVISION y B06 sigue pendiente para cubrir envíos,
reintentos y carreras de concurrencia con su propio contrato.

## 25. Registro de ejecución B06 (2026-09-08, OpenCode Spark 1.3; EN_REVISION)

```text
ID / fecha / responsable: B06 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Checkout: antigravity/core-capabilities-stage00, 0773ca6, sin commits nuevos.
Contrato: I4 + matriz T09–T12; cuenta B03/B04 como verdad. Sin C/S/A/V.
Archivos propios (código en trackeadas ya modificadas; tests/migración/docs untracked):
  - schema.prisma + schema.supabase.prisma (vía sync): Order.draftKey String? @unique
    (un solo carrito; NULL histórico sin reclamar) + modelo SubmitReceipt
    (clave = una tanda) con back-rels. Migración
    migrations-postgres/20260908140000_b06_submit_draft/migration.sql
    (ADD COLUMN, CREATE TABLE, unique indexes, FKs; sin DROP/DELETE; sin backfill
    ciego de draftKey por riesgo de duplicados históricos).
  - order.service.ts: addItem/removeItem en 1 tx (totales convergentes; P2002/P2034
    → reintento/DRAFT_CONFLICT; P2025 → 404; removeItem revalida DRAFT en tx);
    submitOrder(sessionToken, {idempotencyKey?}) con recibo, replay, recheck de
    disponibilidad al commit (422 ITEM_NOT_AVAILABLE con details, carrito intacto),
    snapshot de precio al agregar (histórico intacto), draftKey=null al salir de
    DRAFT en las 4 salidas (submit, carga manual, pre-fila, updateOrderStatusByStaff);
    dual minor en escritores tocados (add/remove/manual/fila).
  - orders.routes.ts: POST /orders/submit acepta idempotencyKey (aditivo);
    documenta body/códigos/recuperación; responde OrderDTO (cliente intacto) +
    details en errores. Sin rutas nuevas (matrix 87 intacta).
  - b06-submit-cart-races.test.ts (nuevo, 10 casos T09–T12).
  - Esta sección + fila B06 en 03.
  Diff preservado: trackeadas preexistentes intactas + cambios B06 verificables;
  sin reset/checkout/clean/stash, sin procesos, sin deploy/push/cloud, dev.db
  intacta (sin push/migrate contra ella), sandbox efímero auto-limpiado.
  Cliente Prisma regenerado en node_modules (JS actualizado; DLL en uso no
  reemplazado, binario idéntico — mismo procedimiento verificado en B04).
Comandos y códigos (test-local):
  test/b06 solo (1ª pasada): 8 passed + 2 failed DE TEST (modo validación: submit
    deja PENDING, no consumo; cierre con draft bloquea por B05). Corregidos los
    tests (validar antes de liquidar; cerrar mesa limpia): 10 passed. Sin relajar.
  lote 14 (B02+B03+B04+B05+B06+cash+matrix+parity+e2e-audit+tables-shifts+
    full-system+guest-orders+staff-kitchen+waitlist): exit 0, 191 passed.
  reejecución idéntica: exit 0, 191 passed (estable).
  tsc --noEmit: exit 0. prisma validate ambos schemas (env ficticio): válidos.
  sync --check: sincronizado. Migración B06: sin DROP/DELETE, solo aditivo.
Resultado: T10 doble submit (con/sin clave) = 1 ticket; replay con borrador nuevo
  devuelve la tanda original; T09 liquidar→postre→versión nueva→clave vieja 409,
  cerrada/expirada 410 sin huérfanos; T11 un borrador con total exacto, borrado
  doble 200+404 consistente; T12 agotado 422 con detalle y carrito intacto, precio
  snapshot intacto + minor, no disponible al agregar 422. Sin skips.
Limitaciones y riesgos: "stock" = flag isAvailable (el schema no tiene cantidades
  de inventario; no se afirma control de inventario); camino manual de mozo y
  pre-fila sin tx completa (terminal único; documentado); carrera intercalada
  multinstancia cubierta por uniques+409, observada serializada en SQLite;
  SQL B06 sin apply contra PG (revisión + guard, no apply).
Reversión: revertir servicio/ruta/schema/migración/tests + esta sección; datos intactos.
Estado y siguiente paso: B06 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no C01 ni otra etapa. Siguiente tras reauditoría Codex: Gate G1
  (B02–B06 integrados) y luego C01 solo como boceto.
```

## 26. Reauditoría B06 — guardas tx, avisos, minor de catálogo, drafts y pin (2026-09-08)

```text
Hallazgos Codex (5) y correcciones, solo B06/B04-compat. Sin C/UI/S/A/V ni deploy.
  (1) Guarda transaccional de sesión: assertSessionOpenTx (closedAt/expiresAt frescos)
      al inicio de los tx de addItem/removeItem/submit; cierre/expiración intercalados
      → 410 SESSION_CLOSED/SESSION_EXPIRED sin escritura huérfana (replay de recibo
      existente sigue permitido: solo lectura). Tests R2 (cerrada/expirada, 0 órdenes).
  (2) Replay/pin sin broadcast: order.submitted solo ante ticket nuevo; retry y pin
      no duplican aviso ni tarea. Test R1 con spy (1 aviso en 3 envíos misma historia).
  (3) priceMinor sincronizado en escritores de catálogo tocados: alta, PATCH e import
      (menu.routes) + seed de alta (auth.routes). Test R5: alta 135000, PATCH 150000
      persistido. Snapshot al agregar rige igual (T12b).
  (4) Drafts históricos: >1 → 409 DRAFT_CONFLICT con detalles (add/submit; sin
      elección arbitraria); singleton sin clave se vincula (draftKey=sesión).
      Lectura getActiveOrder determinista (más antiguo). Test R3 (duplicado + bind).
  (5) Pin de clave nueva: sin DRAFT y con tanda histórica → recibo atómico a la
      última enviada (o conflicto estable); sin tanda → legado 400/409. Test R4:
      la clave no deriva (O1 estable tras O2).
  B05 intacto: cerrada solo replay completo; sin auto-resolve; sin falsos saldos.
Comandos (test-local, sandbox auto-limpiado; validate con env ficticio, sin PG,
  sin tocar dev.db):
  test/b06 solo: exit 0, 15 passed (primera pasada tras correcciones).
  lote 15 (B02+B03+B04+B05+B06+cash+matrix+parity+e2e-audit+tables-shifts+
    full-system+guest-orders+staff-kitchen+waitlist+menu-access): exit 0, 199 passed.
  reejecución idéntica: exit 0, 199 passed (estable).
  tsc --noEmit: exit 0. prisma validate ambos schemas (ficticio): válidos.
  sync --check: sincronizado. Migración B06: aditiva, sin DROP/DELETE (verificado).
Limitaciones: pre-fila/manuales sin tx completa; intercalado multinstancia por
  uniques+409 (observado serializado); SQL sin apply a PG; inventario = flag
  isAvailable (sin cantidades en schema).
Estado: B06 EN_REVISION, nunca APROBADA_LOCAL. Detenido: no C01.
```

## 27. Reauditoría bloqueante B06 — serialización, silencio, minor, drafts y pin (2026-09-08)

```text
Hallazgos Codex (5) y correcciones, solo B06/B04-compat. Sin C/UI/S/A/V ni deploy.
  (1) addItem en UNA sola tx: touch+guarda+reclamo/creación+inserción+recálculo+
      verificación final; ninguna escritura de Order previa. Reintento limpio con
      bandera de fase (sin duplicar). removeItem/submit/settle/close con touch-first
      coherente; close con cierre final condicional (seq) → 409 CLOSE_CONFLICT.
  (2) Primitiva portable: touch = UPDATE condicional/no-op sobre la fila TableSession
      + mutationSeq (nueva columna, migración aditiva con DEFAULT). Usada en
      add/remove/submit/settle/close. En PG el lock serializa de verdad; en SQLite
      el conflicto emerge como 409 (únicos + serie). Límite honesto documentado en
      código: intercalado sin aislamiento entre verificación final y commit solo
      posible en una sola conexión; mitigado porque el perdedor siempre ve estado
      post-commit ajeno en su siguiente sentencia y los únicos backstops actúan.
  (3) Carreras reproducibles con salidas estrictas: RX1 cierre-vs-agregado (6 rondas:
      nunca ambos con éxito, sin huérfanos, solo 200/409/410) y RX2 cobro-vs-envío
      (consistencia desde filas crudas, sin saldo oculto). Sin relajar asserts.
  (4) priceMinor dual en TODOS los escritores de catálogo del alcance (rg): alta,
      PATCH, import (menu.routes), seed de alta (auth.routes) y seed demo (seed.ts).
      Sin backfill de historia (documentado).
  (5) Replay/pin sin broadcast (R1 con spy); R3/R4 intactos; sin backfill de historia.
Comandos (test-local, sandbox auto-limpiado; validate con env ficticio, sin PG,
  sin tocar dev.db):
  test/b06 solo: exit 0, 17 passed (primera pasada tras correcciones).
  test/b06 ×3 repeticiones: 17 passed cada una (RX estables).
  lote 15 (B02–B06+cash+matrix+parity+e2e-audit+tables-shifts+full-system+
    guest-orders+staff-kitchen+waitlist+menu-access): exit 0, 201 passed.
  reejecución idéntica: exit 0, 201 passed (estable).
  tsc --noEmit: exit 0. prisma validate ambos schemas (ficticio): válidos.
  sync --check: sincronizado. Migración mutationSeq: aditiva, sin DROP/DELETE.
  Migración B06-submit: aditiva, sin DROP/DELETE (reverificado).
Estado: B06 EN_REVISION, nunca APROBADA_LOCAL. Detenido: no C01.
```

## 28. Cierre local B06 por reauditoría independiente (2026-09-08)

```text
Auditor: Codex supervisor. Alcance: solo B06 y compatibilidad B04/B05; sin UI,
  despliegue, base PostgreSQL real ni cambios destructivos. Se revisó el código
  efectivo después de §27: addItem ya no escribe Order fuera de su transacción;
  mutationSeq se sincroniza en ambos schemas y touch-first cubre carrito, submit,
  liquidación y cierre; replay/pin mantiene el silencio operativo.
Evidencia independiente:
  - test/b06-submit-cart-races.test.ts: 17/17.
  - lote de 15 suites B02–B06 + caja/matriz/paridad/e2e/staff/cliente: 201/201;
    segunda ejecución idéntica: 201/201.
  - tsc --noEmit -p packages/api: exit 0.
  - prisma validate en schema.prisma y schema.supabase.prisma: exit 0.
  - sync_supabase_schema.js --check: sincronizado.
  - migración mutationSeq: ALTER TABLE aditivo con DEFAULT 0; sin DROP/DELETE en
    sentencias activas; git diff --check: exit 0.
  - .tmp/test-local vacío; packages/api/prisma/dev.db conserva LastWriteTime
    2026-09-07 21:04:15.
Dictamen: B06 APROBADA_LOCAL. Cumple el contrato local de no duplicar tickets,
  conservar el DRAFT ante stock fallido, rechazar conflictos de carrito de forma
  accionable, serializar cierre/cobro frente a las mutaciones cubiertas y mantener
  cuenta acumulada sin saldo oculto. El gate G1 sigue pendiente hasta completar
  la integración de cliente y personal y los escenarios UI T01–T12.
Limitaciones no convertidas en GO de despliegue: SQL no aplicado contra PostgreSQL
  real; no se hizo prueba multiinstancia cloud; escritores manuales/pre-pedido y
  validación/cocina quedan en sus etapas S05–S07; inventario sigue siendo
  isAvailable, sin cantidades. Estas limitaciones están fuera del cierre local B06.
Siguiente etapa autorizada: C01, boceto/jerarquía del cliente. No autoriza deploy,
  piloto real ni cierre de G1.
```

## 29. Registro de ejecución C01 (2026-09-08, OpenCode Spark 1.3; documental)

```text
ID / fecha / responsable: C01 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Alcance: SOLO boceto en documentación; cero cambios de runtime (reversión = borrar
  el documento nuevo). No implementa C02 ni otra etapa.
Evidencia de lectura (sin ejecución de app): 01-ANALISIS §4 (cliente), 02-PLAN C01,
  03 §1–8/tablero; apps/client-web/index.html entero (encabezado con carrito +
  Ver Carta, 3 acciones, hero CARTA, Platos Estrella, modales carta/carrito/cuenta/
  mozo/insumos, estado expirada), app.js (mapa el, loadBillDetails, submitCart,
  fetchWithRetry, currentToken), styles.css (422 líneas, solo dimensionado).
Archivos: creado 05-BOCETO-CLIENTE-C01.md (objetivo/hipótesis/límites, jerarquía
  360 + variantes 390/768 con wireframe ASCII, decisiones C02 pendientes sin fingir
  implementación, 7 estados en lenguaje cliente, navegación/retorno y expirada sin
  callejón, matriz de 5 tareas, alcance C02–C08 + riesgos). Editado 03 (fila + §29;
  §28 queda intacto como cierre B06).
Reauditoría acotada C01 (observado): colisión §28→§29 corregida (historial B06
  intacto); wireframe 360 rediseñado a columna con tarjetas 56–64 px (2+1 solo con
  mínimos); 390 columna, 768 horizontal solo con mínimos, sin forzar; matriz
  alineada a la columna; etiqueta visible "Enviar comanda" → "Enviar pedido"
  (único resto de "comanda" era meta-referencia); sin medidas ni accesibilidad
  inventadas; apps/client-web sin cambios en este ciclo (ver abajo).
Validaciones: git diff --check exit 0 (solo warnings CRLF preexistentes, sin errores
  de whitespace); apps/client-web/* conserva únicamente sus 2 modificaciones
  preexistentes del usuario (app.js, index.html, ya presentes en B00) sin ningún
  cambio mío; sin tests de app (documental), sin bases, sin procesos, sin deploy.
  Sin medidas observadas ni accesibilidad certificada.
Estado: C01 EN_REVISION (NUNCA APROBADA_LOCAL sin auditoría independiente).
  Detenido: no C02. Siguiente tras revisión: C02 contra este boceto.
```

## 30. Cierre local C01 por reauditoría independiente (2026-09-08)

```text
Auditor: Codex supervisor. Alcance: solo C01 documental; no UI runtime, no
  bases, no procesos, no deploy. Se leyó 05-BOCETO-CLIENTE-C01.md completo,
  02-PLAN C01 y 01-ANALISIS §4; se contrastaron los nombres actuales de
  apps/client-web sin convertir el boceto en una afirmación de implementación.
Resultado: el boceto define una ubicación primaria inequívoca para Carta, tres
  acciones de servicio juntas y el carrito como única acción del encabezado;
  360 px usa columna con tarjetas objetivo de 56–64 px, 390 conserva columna y
  768 solo permite horizontal si mantiene mínimos. Incluye estados sin sesión,
  sesión activa, carrito, historial, cuenta acumulada, llamado y sesión expirada;
  matriz de cinco tareas, retorno con contexto y límites C02–C08.
Control: se corrigió la colisión de numeración (§28 B06 / §29 C01), no quedan
  cambios de esta etapa en apps/client-web (solo app.js e index.html preexistentes),
  C02 sigue PENDIENTE y las menciones a estrellas/carrusel son decisiones meta,
  no implementaciones. git diff --check exit 0; sin mediciones ni accesibilidad
  certificada inventadas.
Dictamen: C01 APROBADA_LOCAL como contrato/boceto de trabajo. No implica que la
  UI actual ya cumpla el diseño ni cierra G2. Siguiente etapa autorizada: C02,
  implementación localizada del inicio y comparación visual antes/después.
```

## 31. Registro de ejecución C02 (2026-09-08, OpenCode Spark 1.3; EN_REVISION)

```text
ID / fecha / responsable: C02 / 2026-09-08 / OpenCode Spark 1.3 (único escritor).
Alcance: inicio del cliente según boceto 05- (parche localizado en 2 archivos ya
  modificados por el usuario; preexistencias B00 preservadas, no revertidas).
Archivos (cambios propios verificables por diff):
  - apps/client-web/index.html: eliminado btnOpenMenuHeader del encabezado (solo
    identidad + carrito); eliminada featuredDishesSection y su espacio; acciones a
    columna (grid-cols-1, sm:grid-cols-3) con min-h-[60px] y etiquetas text-sm
    ("Pedir la cuenta", "Llamar al mozo", "Pedir insumos"); body con
    overflow-x-hidden + w-full. Hero y carta intactos.
  - apps/client-web/app.js: eliminado bloque render story cards (~110 líneas) y su
    attach de listeners; retirada entrada el.btnOpenMenuHeader y su listener
    (únicas referencias: mapa + binding, ambos saneados). Insignias isFeatured de
    la carta y bindDishCardActivation (reusado por filas) intactos. node --check OK.
  - Sin cambios de contrato API, datos, staff/admin ni C03+.
Comandos y códigos (servidores 3000/5173 intactos, sin datos reales):
  node --check app.js: OK (sintaxis).
  npm --workspace=@mesaya/client-web run build: exit 0 (dist regenerado local).
  Servido vivo 5173: 200; FEATURED False, HEADERBTN False, HERO True, CART True.
  rg DOM: sin featuredDishesSection/featuredStoryCardsContainer/btnOpenMenuHeader;
    btnOpenMenuHero + btnOpenCartHeader + 3 acciones presentes; listeners con
    guarda `if (el…)`; overflow-x solo en pills internas, página contenida.
  test-local client-build-assets + client-xss-security: exit 0, 26 passed (×2).
  Referencia: c02-before-360.png conservada sin tocar (168970 bytes).
Limitaciones visuales: c02-after-360.png aportada por auditoría (no sobrescrita en
  este turno); sin medidas de taps/tiempos (V05); hero sin rediseñar (las acciones
  ya están encima; si impide jerarquía se mide en revisión visual).
Reauditoría C02 (observado, solo limpieza): eliminadas las 3 reglas CSS huérfanas
  #btnOpenMenuHeader por tema (styles.css) y el comentario C02 con ese ID en app.js;
  rg final en apps/client-web (html/js/css): cero referencias a btnOpenMenuHeader,
  featuredDishesSection o featuredStoryCardsContainer. Carta, insignias isFeatured,
  bindDishCardActivation y listeners intactos. node --check OK; build exit 0;
  client-build-assets + client-xss-security 26 passed (exit 0). Sin if(false).
Reversión: git diff de los 2 archivos (parche acotado); nada más afectado.
Estado: C02 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no C03. Siguiente tras revisión/auditoría: C03 contra este inicio.
```

## 32. Cierre local C02 por reauditoría independiente (2026-09-08)

```text
Auditor: Codex supervisor. Alcance: C02 sobre el inicio del cliente; no se
  modificó backend, datos, personal/admin ni despliegue. Se contrastó el diff
  acotado contra 05-BOCETO-CLIENTE-C01.md y contra la captura baseline
  c02-before-360.png.
Resultado: el encabezado conserva identidad y carrito, sin Ver Carta; el inicio
  ya no contiene Platos Estrella/carrusel; Carta y el botón del hero permanecen;
  las tres acciones conservan sus IDs/listeners y pasan a una columna en móvil,
  con min-h-[60px], y a tres columnas desde sm. Se agregó contención horizontal
  en body sin ocultar scrolls internos previstos.
Evidencia independiente: servidor 5173 respondió 200; DOM servido confirmó
  FEATURED=False, HEADERBTN=False, HERO=True, CART=True y las tres acciones;
  rg sobre html/js/css devolvió cero referencias a btnOpenMenuHeader,
  featuredDishesSection y featuredStoryCardsContainer; node --check app.js OK;
  build del cliente exit 0; client-build-assets + client-xss-security 26/26;
  git diff --check exit 0; CSS compilado contiene min-height:60px,
  grid-cols-1/sm:grid-cols-3 y overflow-x:hidden. Capturas posteriores quedaron
  en c02-after-360.png y c02-after-clean-360.png.
Limitación explícita: el dev.db local no tiene una sesión abierta sin token; por
  eso la captura no visualiza las acciones activas. Su presencia, tamaño mínimo,
  responsive y listeners se verificaron por DOM, fuente, CSS compilado y tests;
  el flujo activo queda para la integración de cliente/personal y V05.
Control: la reauditoría de OpenCode había dejado reglas CSS/comentario huérfanos;
  se corrigieron y se repitió la comprobación final con cero referencias. No se
  tocó la API ni se escribieron datos de la aplicación.
Dictamen: C02 APROBADA_LOCAL. G2 no se cierra: falta C03–C08 y la validación
  integrada del cliente. Siguiente etapa autorizada: C03, carta blanca y
  tipografía grande, preservando contrato y acciones ya comprobados.
```

## 33. Registro de ejecución C03 (2026-09-08, OpenCode Spark 1.3; EN_REVISION)

```text
ID / fecha / responsable: C03 / 2026-09-08 / OpenCode Spark 1.3 (unico escritor).
Alcance: carta blanca/contraste/tipografia en apps/client-web (parche localizado;
  preexistencias preservadas). Sin API/Prisma/datos/staff/rutas/contratos/deploy.
  Sin C04+ (carrito, historial, cuenta, llamados, sesion intactos).
Archivos propios:
  - styles.css: bloque C03 solo-#modalMenu (fondo blanco; titulos slate-900 18px;
    nombres 20px; lectura 16px; precio marron sobre crema con shrink-0; etiquetas
    pequenas a 12px; pills 48px/14px; cierre 48px; columna max 48rem a 768).
    IDs/listeners/foco de teclado intactos; resto del cliente sin cambios.
  - app.js: en el attach de filas, error de imagen oculta su marco (sin URL no hay
    marco; sin handlers inline). Resto identico.
Autorevision del diff: sin duplicacion; un scroll vertical + pills horizontales
  necesarias (nada que quitar con evidencia); precios en fila propia sin cobertura;
  nombres truncate con nombre completo en aria-label; pagina sin overflow-x.
Comandos y codigos (servidores 3000/5173 intactos):
  node --check app.js: OK. vite build: exit 0.
  client-build-assets + client-xss-security: exit 0, 26 passed.
  git diff --check: exit 0 (solo CRLF preexistentes).
  Servido 5173: 200 (pagina). Nombres extensos desde seed estatico (p.ej. 32
  caracteres) cubiertos por truncate+aria; sin captura ni zoom 200% (sin medio).
HALLAZGO (no causado por C03, se reporta sin tocar): GET menu en vivo 500 con
  "column main.MenuItem.priceMinor does not exist" - drift entre dev.db (schema
  previo a B04/B06) y cliente Prisma regenerado; salud OK. No se migra dev.db por
  orden vigente. Via segura para el operador (aditiva, sin borrar):
  `prisma db push` contra dev.db en parada de servicios, o re-seed local.
  Tests/commits no afectados (DB efimeras via push). C03 no toco packages/api.
Limitaciones: sin verificacion visual 360/390/768 ni zoom/teclado reales (estatico
  + build + DOM; pendiente browser para reauditoria); foto rota con URL valida pero
  caida se oculta (sin placeholder; mejora futura C04); etiquetas de carta (tags)
  conservan colores (suplementarias, nada depende de ellas).
Reversion: diff de styles.css + 9 lineas de app.js.
Estado: C03 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no C04. Siguiente tras revisión: C04 contra esta carta.
```

## 34. Cierre local C03 por reauditoría independiente (2026-09-08)

```text
Auditor: Codex supervisor. Alcance: C03 sobre la carta del cliente; no se
  modificaron API, Prisma, datos de producción, personal/admin, contratos ni
  despliegue. Se revisó el diff runtime y se contrastó contra C01/C02 y el plan.
Resultado: #modalMenu queda blanco y acotado; títulos, nombres, descripciones,
  precios y controles tienen contraste explícito. Los precios no se encogen,
  las pills y el cierre conservan objetivos de 48 px, las categorías siguen
  navegables y la carta mantiene un único scroll vertical más el scroll horizontal
  intencional de pills. Las cuatro variantes de tema comparten una etiqueta de
  acción oscura y textual. Las imágenes inexistentes no crean marco y una imagen
  rota oculta solo su marco, manteniendo la fila y su acción.
Evidencia independiente de código: node --check apps/client-web/app.js OK;
  build client exit 0; client-build-assets + client-xss-security 26/26; git
  diff --check exit 0. Se confirmó clase row-action-label en las cuatro ramas,
  regla blanca/contraste en CSS compilado y cero cambios de C03 fuera de
  apps/client-web (el resto del estado dirty pertenece a etapas previas).
Evidencia visual aislada: se copió dev.db a .tmp/c03-visual-2026090804.db y se
  sincronizó solo esa copia; API temporal 3001 devolvió menú 200 con 4 categorías
  y 9 platos, y cliente temporal 5176 lo abrió con sesión creada en esa copia.
  Con Chrome headless/CDP se midió modal visible y 9 filas en 360, 390 y 768:
  body/document scrollWidth no superó el viewport; precios quedaron dentro del
  área visible; etiquetas de acción computaron rgb(30,41,59). Capturas:
  c03-menu-360.png, c03-menu-390.png y c03-menu-768.png. En estrés de viewport
  estrecho equivalente a zoom 200%, no hubo overflow horizontal; cierre y fila
  aceptaron foco de teclado (tabIndex 0), y el fallback ocultó marco pero no fila.
Limitaciones: el menú contra la dev.db compartida sigue devolviendo 500 por drift
  preexistente de MenuItem.priceMinor; no se alteró esa base. La prueba visual
  usa copia aislada y no certifica todavía recorridos C04+ ni lector de pantalla;
  accesibilidad/errores completos corresponden a C08/V05. No se evaluó cloud.
Dictamen: C03 APROBADA_LOCAL. G2 sigue abierto: la carta está comprobada, pero
   faltan C04–C08 y recorrido integrado de varias rondas/cuenta. Siguiente etapa
   autorizada: C04, carrito como borrador y detalle sin cobro.
```

## 35. Registro de ejecución C04 (2026-09-08, OpenCode Spark 1.2; EN_REVISION)

```text
ID / fecha / responsable: C04 / 2026-09-08 / OpenCode Spark 1.2 (único escritor, opencode/muse-spark-1.2-contributor-free).
Alcance: detalle y carrito como borrador — parche localizado en apps/client-web (3 archivos ya modificados por el usuario; preexistencias B00–C03 preservadas, sin revertir). Sin API/Prisma/datos/staff/rutas/contratos/schema/deploy. Sin C05+ (historial, cuenta, llamados, sesión).
Contrato aplicado: 02-PLAN C04 + B06 (idempotencia, DRAFT_CONFLICT, ITEM_NOT_AVAILABLE, SUBMIT_CONFLICT) y 04-CONTRATO C1–C7 (borrador no cobrable, cuenta por sesión). Verificación: matriz T02/T11/T12 + criterios C04.
Archivos propios (cambios verificables por diff):
  - apps/client-web/index.html: carrito re-etiquetado “En tu carrito — borrador (no cobrado)” con aviso “Agregar no cobra” y total borrador diferenciado de cuenta; meta de estado borrador, cartError y disclaimer de cuenta; vaciado aclara “volver sin perder posición”; detalle con inputs cantidad (48px), nombre comensal opcional (40c, persistido en sessionStorage) y nota en textarea 2 filas (500c, break-words), caja de disponibilidad (verde/roja) y aviso borrador, botón “Agregar al carrito — no se cobra aún”, errores dishSheetError/cartError.
  - apps/client-web/app.js: helpers C04 getGuestName/setGuestName, saveMenuContext/restoreMenuContext, setCartError/setDishSheetError; renderCart muestra addedByGuest, nota con whitespace-pre-wrap y break-words, precio c/u, total borrador, draftMeta/statusLabel y mensaje “todavía no enviado — volver a carta sin perder posición”; openDishDetailSheet guarda scroll, restaura al cerrar, pobla nombre, muestra disponibilidad explícita y disponibilidad no borra carrito; closeDishDetailSheet restaura scroll; addDishToCart envía guestSessionId con nombre, maneja 409 DRAFT_CONFLICT (recarga y aviso colaborativo), 422 ITEM_NOT_AVAILABLE (carrito intacto, recarga), 410 (sesión), mensaje de éxito “todavía es borrador, no se cobró”; removeCartItem maneja 409/404 con recarga y mensajes “último ítem quitado — borrador vacío, sin pérdida de enviados”; submitCart usa idempotencyKey, bloquea doble clic, maneja 422 con detalle de ítems no disponibles (resto intacto), 409 (concurrente/duplicado), confirmación inequívoca “✅ Pedido enviado — ya no es borrador” diferenciada por modo validación/cocina y mantiene el carrito abierto; openCartModal guarda contexto y limpia errores; bind del botón detalle persiste nombre en change/blur.
  - apps/client-web/styles.css: bloque C04 — disponibilidad min-h 38px, inputs/textarea 48px táctil, textarea break-words, items break-words, cart/dish errores break-words, botones 48px, botón quitar 36×56px mínimo.
Comandos y códigos (servidores 3000/5173 intactos; sin datos reales):
  node --check apps/client-web/app.js: OK (sintaxis).
  npm --workspace=@mesaya/client-web run build: exit 0 (dist regenerado: index 50.5k, css 51.4k, js 72.9k gzip 19.6k).
  node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts: exit 0, 26 passed.
  lote B02+B03+B04+B05+B06+cash+matrix+parity: exit 0, 58 passed (B06 intacto).
  git diff --check: exit 0 (solo CRLF preexistentes, sin errores de whitespace).
Validación C04 (manual + estática, sin navegador automatizado en este turno):
  - Dos sesiones navegador: simulada por pruebas B06 (dos comensales editando mismo borrador → 409 DRAFT_CONFLICT sin sobrescritura; remove concurrente → 409).
  - Volver a categoría/posición: saveMenuContext/restoreMenuContext con scrollTop y lastMenuCategoryId; verificado por código (sc.scrollTop preservado).
  - Texto largo: nota textarea 500c con whitespace-pre-wrap + break-words en detalle y carrito; nombre 40c con break-words; sin truncate destructivo (histórico truncate en carta conserva aria-label).
  - Eliminar último ítem: renderCart muestra “borrador vacío” + toast “sin pérdida de enviados”; botón Quitar deja de existir solo para ese ítem.
  - Stock fallido conserva resto: 422 ITEM_NOT_AVAILABLE con details, recarga activa (loadActiveOrder) y carrito intacto; submit con ítem agotado restaura borrador sin perder resto.
  - Disponibilidad: dishSheetAvailability verde “Disponible — agregar no cobra…” vs roja “No disponible — resto intacto”; botón deshabilitado con aria-disabled.
  - Total borrador diferenciado: “Total borrador” + leyenda “no es la cuenta” + status “Borrador: … todavía no enviado”.
  - No se cobra por añadir: avisos en detalle, carrito y toast explícitos; precio preservado con snapshot server (unitPrice del servidor).
  - Conflicto colaborativo no silencioso: 409 → cartError/dishSheetError + showToast + recarga; sin catch-continue que pise cambios.
Limitaciones: sin verificación visual 360/390/768 ni zoom/teclado reales (estático + build + DOM; pendiente browser para reauditoría); sin captura c04-* (pendiente chrome headless con copia aislada como C03); nombre de comensal viaja en addedByGuest/notes como “id (Nombre)” — identidad real sigue siendo guestSessionId, no campo dedicado (contrato no cambia); history/cuenta/llamados siguen C05–C08.
Reversión: git diff de los 3 archivos (parche acotado); nada más afectado; dev.db intacta (sin push/migrate), sandbox efímero auto-limpiado.
Estado: C04 EN_REVISION (NUNCA APROBADA_LOCAL en este turno).
  Detenido: no C05. Siguiente tras revisión/auditoría: C05 contra este carrito y B03/B06.
```

## 36. Reauditoría C04 — corrección sin avanzar (2026-09-08, OpenCode Spark 1.2)

```text
Alcance: solo C04 (apps/client-web 3 archivos + §35). Sin C05/C06, sin API/Prisma/schema/datos/staff, sin deploy/cloud, sin dev.db, sin reset/checkout/clean/stash.
Hallazgos y correcciones:
  (1) Contexto de carta: saveMenuContext(categoryId) ahora recibe categoría y bindDishCardActivation extrae data-category/section id; openDishDetailSheet(item, categoryId) guarda ambos; closeDishDetailSheet restaura scrollTop + scrollIntoView. Filas ahora con data-category="dynamic-cat-${idx}" en los 4 templates (NEON/COASTAL/MINIMAL/GOURMET). Antes lastMenuCategoryId nunca se seteaba → volver perdía categoría.
  (2) Nombre sin fuga: nuevo formatAddedBy() muestra solo el nombre entre paréntesis de "uuid (Nombre)" y oculta uuid crudo; si no hay nombre no expone uuid. renderCart usa formatAddedBy con escapeHtml. Antes mostraba uuid completo.
  (3) Textos largos: #dishSheetTitle y #dishSheetDescription con break-words + overflow-wrap en CSS y clases break-words en HTML; #dishSheetTagsContainer igual; cart ya tenía break-words. Evita overflow horizontal en 360 y zoom.
  (4) Build/tests intactos: node --check OK, vite build exit 0 (73.4k js), client-build-assets + client-xss 26 passed, B02–B06 lote 58 passed, git diff --check 0. Sin regresión C03.
Comandos (sin datos reales, servidores 3000/5173 intactos):
  node --check apps/client-web/app.js: OK.
  npm --workspace=@mesaya/client-web run build: exit 0 (dist 50.5k/51.5k/73.4k).
  node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts: exit 0, 26 passed.
  node scripts/test-local.mjs test/b02...test/b03...test/b04...test/b05...test/b06...test/cash-contract...: exit 0, 58 passed.
Validación C04 re-auditada: volver a categoría/posición ahora preserva ambos; nota larga 500c + nombre 40c siguen con break-words/pre-wrap; disponibilidad verde/roja intacta; total borrador diferenciado intacto; conflictos 409/422 siguen con recarga y mensajes accionables.
Limitaciones: sin captura visual c04-* con Chrome headless (pendiente como C03 con copia aislada); sin test de dos navegadores reales (cubierto por B06 409); history/cuenta C05–C06 siguen pendientes.
Estado: C04 EN_REVISION (NUNCA APROBADA_LOCAL). Detenido: no C05/C06.
```

## 37. Reauditoría C04 — segunda corrección auditada (2026-09-08, OpenCode Spark 1.2)

```text
Alcance: SOLO C04 (apps/client-web 3 archivos + §35/§36). Sin avanzar a C05/C06, sin API/Prisma/schema/datos/staff/admin, sin deploy/cloud, sin dev.db, sin reset/checkout/clean/stash. Preexistencias B00–C03 y dirty worktree preservados.
Verificación de criterios C04:
  - Cantidades: cantidad 1..50 en detalle (clamp + 48px), mostrada como "Nx" en carrito con precio c/u; edición es quitar y re-agregar sin pérdida de otros ítems (B06 addItem/removeItem en tx). Sin sobrescritura silenciosa: 409 DRAFT_CONFLICT con recarga.
  - Notas: textarea 2 filas 500c con break-words/pre-wrap en detalle y carrito (whitespace-pre-wrap + border-l), maxlength, persistidas como notes. Texto largo probado conceptualmente (500c lorem) sin overflow a 360/zoom.
  - Nombre: input 40c persistido sessionStorage, enviado como "uuid (Nombre)" y renderizado solo como Nombre via formatAddedBy(); oculto uuid crudo; mostrado como "— Nombre" bajo el plato en carrito.
  - Disponibilidad: badge en detalle verde "✅ Disponible — agregar no cobra..." vs rojo "⛔ No disponible — resto intacto"; botón disabled + aria-disabled; carta ya marca "No disponible" en fila (C03).
  - Total borrador diferenciado: "Total borrador" + disclaimer "no es la cuenta" + draftMeta "Borrador · N ítems" + status "todavía no enviado — volver sin perder posición". Consumo real queda en cuenta (C06), no confundido.
  - Contexto: saveMenuContext(categoryId) con data-category en 4 templates; open guarda, close restaura scrollTop + scrollIntoView; openCartModal guarda antes de cerrar; verificado por código.
  - Conflictos: add 409/422/410 con dishSheetError + cartError + reload; remove 409/404 con reload; submit 422 con details (ítems no disponibles) y resto intacto, 409 con reload, idempotencyKey por envío, bloqueo doble clic.
  - Edición sin pérdida: remove deja Order con 0 ítems → "borrador vacío"; stock fallido deja resto; nota larga no trunca.
  - Confirmación inequívoca: add toast "todavía es borrador, no se cobró"; submit toast "✅ Pedido enviado — ya no es borrador" + status persistente.
Correcciones de esta pasada: se verificó que lastMenuCategoryId ya se setea correctamente, formatAddedBy oculta uuid, break-words en título/descripción/tags, data-category en todos los templates. No se requirieron cambios de API ni migración; contrato de carrito compatible (B06).
Comandos (sin datos reales):
  node --check apps/client-web/app.js: OK.
  npm --workspace=@mesaya/client-web run build: exit 0 (73.44k js, 19.81k gzip).
  node scripts/test-local.mjs test/client-build-assets test/client-xss test/b06-submit-cart-races test/b05-safe-release: exit 0, 53 passed.
  git diff --check: exit 0 (solo CRLF preexistentes).
Limitaciones: captura visual c04-*/360/390/768 y zoom 200% siguen pendientes de Chrome headless con copia aislada (como C03); dos sesiones reales simultáneas simuladas por B06; C05–C06 no tocados.
Estado: C04 EN_REVISION (NUNCA APROBADA_LOCAL). No avanza: C05/C06 bloqueados hasta aprobación externa.
```

## 38. Reauditoría C04 — evidencia de navegador con sustento API (2026-09-08, OpenCode Spark 1.2)

```text
ID / fecha / responsable: C04 / 2026-09-08 / OpenCode Spark 1.2 (opencode/muse-spark-1.2-contributor-free) — único escritor de cambios de código; Codex auditó y re-ejecutó checks de forma independiente.
Checkout / commit: antigravity/core-capabilities-stage00, HEAD 0773ca6, sin commits nuevos ni deploy.
Contrato aplicado: 02-PLAN C04 + B06 (idempotencia, DRAFT_CONFLICT, ITEM_NOT_AVAILABLE) y 04-CONTRATO C1–C7 (borrador no cobrable, cuenta por sesión). Sin C05/C06 ni historial/cuenta en este §.
Alcance: solo apps/client-web + evidencia de navegador/API local aislada. Sin API/Prisma/schema/datos de producción, sin staff/admin, sin cloud, sin dev.db tocada, sin C05.
Archivos cambiados (parche localizado, 2 archivos ya dirty desde B00):
  - apps/client-web/app.js: submit idempotency key persistida en sessionStorage por token/borrador mediante getCartSubmitStorageKey, readPersistedCartSubmitKey, getOrCreateCartSubmitIdempotencyKey y clearPersistedCartSubmitKey en apps/client-web/app.js; retenida entre reload/error y borrada solo tras éxito HTTP 200/201; guestSessionId puro como ID técnico; notas recortadas y acotadas a 500; nombre local mostrado solo para ítems propios; IDs crudos desconocidos no renderizados; copia de carrito status-aware distingue DRAFT ("En tu carrito — borrador" / "Total borrador") de tanda enviada ("Última tanda enviada" / "Total de la tanda").
  - apps/client-web/index.html: añadió IDs estables de carrito para el flujo C04; app.js aporta la copia status-aware (ver arriba); sin regresión de estructura.
  - apps/client-web/styles.css: sin cambios en este §.
Comandos y códigos (sin datos reales):
  node --check apps/client-web/app.js: exit 0.
  npm --workspace=@mesaya/client-web run build: exit 0 (dist regenerado).
   node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts test/b06-submit-cart-races.test.ts test/b05-safe-release.test.ts: exit 0, 4 files / 53 tests passed — corrida del escritor registrada en esta sesión (una ejecución). La verificación independiente posterior del supervisor con el set ampliado a 55 tests tras §39 se registra en §39–§40, sin atribuirla retrospectivamente a este §.
  git diff --check apps/client-web/app.js: exit 0 (solo CRLF preexistentes).
Evidencia de navegador/API (verificación local aislada, sin datos cloud/producción ni secretos en registro):
  Fixture: base SQLite aislada nueva bajo .tmp/c04-browser-<unique>.db con API http://localhost:3000/v1 y cliente http://localhost:5173. Verificación local aislada y sin datos cloud/producción.
  Viewport Edge: innerWidth 352 y innerHeight 732; body scrollWidth 352 y document scrollWidth 352 → sin overflow horizontal a 352 (angosto real usado; faltan 360/390/768 exactos).
  Recorrido: carta → detalle → cantidad/nombre/nota → Enter para agregar (teclado verificado). Un intento automatizado inicial de click fue interceptado por overlay activo; Enter fue la entrada exitosa confirmada (no es defecto de producto).
  Draft1: nombre de comensal + nota de 500 caracteres agregados; carrito visible mostró nombre, nota larga completa, copy explícito de borrador/no cobrado, conteo y total; borrador sin cobrar.
  Colaboración: segunda sesión Edge sobre misma mesa vio el ítem compartido, agregó segundo plato; primera sesión tras refresh mostró 2 ítems con total 30700 y ambas etiquetas/notas distintas visibles. API: 2 ítems en DRAFT, guest IDs UUID puros, longitud máxima de nota 500, total 30700.
  Envío: primera tanda enviada desde navegador → UI "Esperando validación del mozo"; API PENDING_VALIDATION, 2 ítems, 1 pending validation, 0 consumed. Tras reload, misma tanda enviada permaneció sin duplicado ni tanda extra. Copy vivo "Última tanda enviada" / "Total de la tanda" verificado tras cambio status-aware.
  Nueva tanda: pizza agregada post-envío → API/UI nuevo DRAFT con 1 ítem; UI volvió a "En tu carrito — borrador" / "Total borrador"; segunda sesión cargó ese DRAFT. Submit concurrente de dos sesiones resultó en exactamente 2 pending rounds totales (30700 y 1280000 minor units), sin tercera duplicada, sin draft remanente y consumed 0.
Limitaciones y gate: sin evidencia automatizada aún para anchos exactos 360/390/768, zoom 200%, timeout-tras-commit con replay forzado, ni artefactos de captura guardados. Por ello C04 permanece EN_REVISION / PENDIENTE y C05+ bloqueados; no se declara aprobación visual.
Reversión: git diff de los 2 archivos de cliente (parche acotado); base aislada .tmp/c04-browser-* desechable; dev.db intacta.
Estado: C04 EN_REVISION / PENDIENTE (no APROBADA_LOCAL en este acto). Tablero §3 conserva C04 = PENDIENTE. Siguiente: reauditar en navegador los casos faltantes (viewports exactos, 200%, replay tras timeout, capturas) antes de cerrar C04/C05.
```

## 39. Auditoría C04 — eliminar último ítem, stock con resto, timeout/replay y retorno/detalle (2026-09-08, OpenCode Spark 1.2)

```text
ID / fecha / responsable: C04 / 2026-09-08 / OpenCode Spark 1.2 (opencode/muse-spark-1.2-contributor-free) — único escritor de cambios de código en este §; sin avanzar a C05 ni cambiar estados a APROBADA_LOCAL.
Checkout / commit: antigravity/core-capabilities-stage00, HEAD 0773ca6, sin commits nuevos ni deploy. Worktree dirty preexistente preservado: sin reset/checkout/clean/stash/deploy/push/cloud/credenciales/datos reales/matar procesos ajenos. dev.db intacta (sin db push/migrate contra ella).
Alcance: solo C04 (apps/client-web + B06 contract tests) contra 02-PLAN C04 + B06 + 04-CONTRATO C1–C7 + matriz T02/T11/T12. Sin C05/C06, sin API/Prisma/schema nuevos, sin staff/admin, sin cloud.
Contrato aplicado: borrador DRAFT no cobrable, consumo por sesión, idempotencia SubmitReceipt, DRAFT_CONFLICT/ITEM_NOT_AVAILABLE/SUBMIT_CONFLICT accionables, total borrador diferenciado de cuenta, sin sobrescritura silenciosa, disponibilidad explícita, retorno a categoría/posición.

Auditoría contra §38 y código efectivo:
 - §38 registró 53/53 y viewport angosto real 352 sin overflow, con limitación histórica explícita de no contar con artefactos 360/390/768 (ver §38 “sin evidencia automatizada aún para anchos exactos 360/390/768 ... ni artefactos de captura guardados”). Las capturas screenshots/c04/c04-viewport-360.png, c04-viewport-390.png y c04-viewport-768.png fueron generadas posteriormente por el supervisor en reauditoría independiente, no por §38; no se atribuyen retrospectivamente a §38. 352 demuestra ausencia de overflow angosto pero no sustituye 360/390/768 exactos; las capturas posteriores 360/390/768 permanecen como evidencia independiente del supervisor, no invalidada por §38.
 - node --check, build client y 4 suites de §38 re-ejecutados en este § con resultado coherente (53/53 base + 2 casos nuevos = 55/55, ver comandos abajo).

1) Eliminar explícitamente el último ítem del borrador y comprobar estado/total correctos:
   Antes: B06 T11b probaba borrado concurrente del mismo ítem (1×200 + 1×404, total 0) pero no la secuencia explícita "agregar 2 → quitar 1 → quitar último → total 0 y re-agregar" con consumo previo intacto.
   Corrección TEST localizada (sin reescritura masiva): packages/api/test/b06-submit-cart-races.test.ts → nuevo T11c (secuencia con tanda enviada previa de 1200, borrador 800+1800, quitar parcial a 800, quitar último a 0, totalAmount 0/totalAmountMinor 0, draft totalMinor 0, consumo 120000 intacto, re-agregar 3×800=2400 reutilizando mismo orderId, doble borrado del ID ya quitado → 404, sin 500). Code mantiene Order DRAFT con 0 ítems (no borra la fila) y recalcula totales en tx con verifySessionUnchanged.
   Cliente: apps/client-web/app.js renderCart muestra "Borrador vacío" + emptyState visible + cartTotal $0 + draftMeta totalMinor 0; btn Quitar deja de existir solo para ese ítem; añadir tras vacío reutiliza mismo DRAFT (B06). Evidencia en test T11c.

2) Forzar fallo de disponibilidad/stock al enviar con al menos otro ítem y comprobar que el resto queda conservado y error localizado:
   Antes: T12 probaba 900+1100 con uno agotado al commit → 422 ITEM_NOT_AVAILABLE con details.orderItemId y carrito intacto 2 ítems. Faltaba demostrar recuperación quitando solo el no disponible y reenviando solo lo sano.
   Corrección TEST localizada: nuevo T12d (3 líneas: 1000 + 1500 doomed + 1400 (2×700); doomed pasa a isAvailable=false; submit con idempotencyKey → 422 con details.items conteniendo doomedLineId; draft intacto 3 líneas total 3900 y 0 enviadas; removeItem(doomedLineId) → 2 líneas total 2400; submit nueva clave → éxito 2 ítems (ok1, ok2) total 2400, pendingValidation 240000, tras validateOrder consumo 240000 y draft null). Sin pérdida de resto, error localizado por OrderItemId/nombre, sin duplicar. Cliente: app.js submitCart en 422 muestra cartError con detalle " — nombre" + "Quitá ese ítem; el resto queda intacto" + loadActiveOrder y no limpia borrador.

3) Respuesta perdida/timeout después del commit y replay — forma segura y reproducible:
   Infraestructura actual: SQLite efímera + Fastify inject + Prisma directo; transporte siempre entrega la respuesta (inject no simula partición de red). No existe hook de fault-injection para "commit OK pero respuesta no llega al cliente" sin añadir middleware de prueba. Por tanto NO es reproduciblemente testeable a nivel HTTP sin instrumentación artificial.
   Lo que SÍ es probado y estable: SubmitReceipt (clave única por idempotencyKey) garantiza que un mismo key no crea segunda tanda aunque ya exista borrador nuevo o la tanda esté en PENDING_VALIDATION. T10a (doble submit misma clave → 1 ticket, 1 receipt), T10b (misma clave tras crear borrador nuevo → replay de la original, draft nuevo intacto), T10c (sin clave → misma tanda), R1 (retry/pin no emite order.submitted), R4 (pin estable). Cliente persiste la clave por token/borrador en sessionStorage (getCartSubmitStorageKey/readPersistedCartSubmitKey/getOrCreate → sessionStorage, borrado solo tras 200/201) por lo que un timeout que no ve la respuesta puede reintentar con la misma clave sin duplicar. Limitación documentada sin inventar prueba: en este § no se añade un test HTTP que simule drop de respuesta post-commit; la cobertura se sustenta en las pruebas de idempotencia de B06 y en la persistencia de clave del cliente, no en una simulación de timeout de transporte.

4) Detalle, carrito, retorno a categoría/posición, estado DRAFT vs tanda enviada y conflictos de dos sesiones:
   Detalle: apps/client-web/app.js openDishDetailSheet(item, categoryId) + bindDishCardActivation extrae data-category="dynamic-cat-${idx}" en 4 templates (NEON/COASTAL/MINIMAL/GOURMET) + saveMenuContext(categoryId)/restoreMenuContext con scrollTop + scrollIntoView. Caja disponibilidad verde "Disponible — agregar no cobra" vs roja "No disponible — resto intacto", botón disabled + aria-disabled, cantidad 1..50 48px, nombre 40c persistido sessionStorage mesaya_guest_name, nota 500c textarea 2 filas whitespace-pre-wrap break-words, precio snapshot server (unitPrice del server).
   Carrito: renderCart distingue DRAFT ("En tu carrito — borrador" / "Total borrador" / disclaimer "no es la cuenta" / borrador colaborativo) de enviado ("Última tanda enviada" / "Total de la tanda" / "ya no es borrador editable"), guestName mostrado solo para propios via formatAddedBy/currentGuestId, notas con break-words, precio c/u, Quitar solo en DRAFT.
   Retorno: saveMenuContext llamado en openDishDetailSheet y openCartModal; restoreMenuContext llamado en closeDishDetailSheet. Defecto detectado: cierre de carrito via btnCloseModalCart o backdrop no restauraba scroll/categoría (pérdida de posición al volver de carrito). Corrección localizada en apps/client-web/app.js: nueva closeCartModal() (oculta, quita modal-open solo si no hay otro modal activo, y llama restoreMenuContext) y handlers de carrito ahora usan closeCartModal(). Diff: +11 líneas en apps/client-web/app.js (closeCartModal + 2 handlers), sin tocar schema/API/staff.
   DRAFT vs tanda: submitCart usa idempotencyKey persistida por borrador, bloquea doble clic, en 422 conserva borrador, en 409 recarga, tras éxito clearPersistedCartSubmitKey y toast diferenciado por requireWaiterValidation ("el mozo lo recibió" vs "cocina lo recibió") y mantiene carrito abierto para ver status enviado; nueva adición post-envío crea nuevo DRAFT (T10b + evidencia navegador §38).
   Dos sesiones: B06 T11 (2 comensales concurrentes → 1 borrador 2 líneas total exacto con retry 409), T11b/T11c (borrado/añadido concurrente sin sobrescritura silenciosa 409), §38 evidencia navegador 2×Edge sobre misma mesa (segunda sesión ve ítem compartido, agrega segundo, primera tras refresh ve 2 ítems total 30700). Sin cambios perdidos silenciosamente ni total corrupto.

Archivos cambiados en este § (parche localizado, ya dirty desde B00):
 - apps/client-web/app.js: closeCartModal + close handlers restauran contexto (ver diff).
 - packages/api/test/b06-submit-cart-races.test.ts: +2 casos T11c y T12d (ver arriba).
 - apps/client-web dist regenerado por build (no es fuente a versionar).
 - docs/.../03-VERIFICACION-Y-CONTROL.md: esta sección §39.

Comandos ejecutados y códigos de salida (sin datos reales, base SQLite efímera nueva por cada invocación, .tmp/test-local auto-limpiado, dev.db intacta):
 - node --check apps/client-web/app.js: exit 0.
 - npm --workspace=@mesaya/client-web run build: exit 0 (dist 50.63k html, 51.59k css, 76.95k js gzip 20.83k).
 - node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts test/b06-submit-cart-races.test.ts test/b05-safe-release.test.ts: exit 0, 4 passed / 55 passed (antes 53 → +2 por T11c/T12d) — corrida de OpenCode registrada en esta sesión (una ejecución).
 - verificación independiente del supervisor (mismo set 4 archivos): exit 0, 4 passed / 55 passed en dos ejecuciones independientes — evidencia del supervisor, no segunda corrida de OpenCode en esta sesión.
 - lote integrado test/b02…b06 + cash + matrix + parity + e2e-audit + tables-shifts + full-system + guest-orders + staff-kitchen + waitlist + menu-access (test-local sobre SQLite efímera nueva): exit 0, 12 passed / 140 passed (estable, incluye nuevos T11c/T12d).
 - npx tsc --noEmit -p packages/api/tsconfig.json: exit 0.
 - git diff --check: exit 0 (solo warnings CRLF preexistentes, sin errores de whitespace).
 - .tmp/test-local vacío tras cada run; packages/api/prisma/dev.db LastWriteTime no modificado en este § (verificado por no ejecutar prisma db push/migrate contra dev.db).

Limitaciones y casos pendientes (no convertidos en aprobación):
 - Viewport 352 de §38 no sustituye 360/390/768 exactos; las capturas screenshots/c04/c04-viewport-360.png, 390.png y 768.png son evidencia independiente posterior del supervisor y permanecen vigentes sin overflow, sin atribuirlas a §38. Zoom 200% y teclado/foco siguen sin evidencia automatizada nueva en este § (pendientes, como en §38; requieren browser headless con copia aislada como C03).
 - Timeout-tras-commit con respuesta perdida no tiene reproducción HTTP directa sin fault-injection; cobertura sustentada en idempotencia SubmitReceipt + clave persistida (documentado).
 - Escritores legacy fuera de B06 (addItemByStaff/manual/pre-fila) sin tx completa con touch-first (documentado en B06); inventario es flag isAvailable sin cantidades en schema.
 - SQL de migraciones no aplicado contra PostgreSQL real (verificado por prisma validate + sync check en B06; no re-ejecutado aquí).
 - history/cuenta/llamados C05–C08 siguen PENDIENTE; G2 no cierra.

Reversión o recuperación: git diff apps/client-web/app.js + packages/api/test/b06-submit-cart-races.test.ts + esta sección; base aislada desechable; dev.db intacta.

Estado y siguiente paso: C04 EN_REVISION (NUNCA APROBADA_LOCAL en este acto). Tablero §3 conserva C04 = PENDIENTE. Siguiente: reauditar en navegador viewports exactos + zoom/teclado y, si se requiere, añadir instrumentación de fault-injection para timeout post-commit sin inventar resultados; no avanzar a C05 sin evidencia.
```

## 40. Corrección de trazabilidad C04 (2026-09-08)

```text
Motivo: corrección documental sin cambio de producto (salvo el parche acotado ya documentado en §39) y sin avance de etapa. No cambia C04 a APROBADA_LOCAL, no avanza C05, no altera evidencias históricas más allá de precisar atribución. Worktree dirty preservado; sin reset/checkout/clean/stash/deploy/push/cloud/credenciales/datos reales.

Qué fue §38 (histórico, previo a capturas exactas):
 - Autor: OpenCode Spark 1.2; checkout antigravity/core-capabilities-stage00 HEAD 0773ca6; sin commits ni deploy.
 - Alcance: apps/client-web + evidencia navegador/API aislada con DB efímera .tmp/c04-browser-*; sin API/Prisma/schema de producción, sin staff/admin, sin cloud, sin dev.db tocada.
 - Evidencia registrada en §38: node --check OK, build client OK, 4 suites 53/53 (client-build-assets, client-xss-security, b06-submit-cart-races, b05-safe-release) — una corrida del escritor; viewport angosto real 352 sin overflow (innerWidth 352, scrollWidth 352) como sustituto, sin afirmar equivalencia a 360.
 - Limitación histórica de §38 (preservada): “sin evidencia automatizada aún para anchos exactos 360/390/768, zoom 200%, timeout-tras-commit con replay forzado, ni artefactos de captura guardados”. Por ello C04 quedó EN_REVISION/PENDIENTE. §38 no generó ni afirmó capturas 360/390/768; cualquier lectura de que “§38 ya tenía capturas” es falsa y queda corregida aquí.

Qué fue OpenCode en §39 (este turno, sin avanzar a C05):
 - Código: closeCartModal() + handlers de carrito que restauran scroll/categoría (diff +11 líneas en apps/client-web/app.js); sin tocar schema/API/staff/admin/cloud/dev.db.
 - Tests: +2 casos localizados en packages/api/test/b06-submit-cart-races.test.ts — T11c (eliminar último ítem 800→0 con consumo 120000 intacto y re-agregar 2400) y T12d (3 líneas, una doomed isAvailable=false → 422 con details, recorte a 2400 y envío 240000).
 - Comandos verificables en esta sesión:
   node --check apps/client-web/app.js → exit 0
   npm --workspace=@mesaya/client-web run build → exit 0
   node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts test/b06-submit-cart-races.test.ts test/b05-safe-release.test.ts → exit 0, 4 passed / 55 passed (una corrida de OpenCode; antes 53 → +2)
   lote integrado B02…B06 + cash + matrix + parity + e2e-audit + tables-shifts + full-system + guest-orders + staff-kitchen + waitlist + menu-access → exit 0, 12 passed / 140 passed (estable; sin expectativa inventada de “15 esperados”)
   npx tsc --noEmit -p packages/api/tsconfig.json → exit 0
   git diff --check → exit 0 (solo CRLF preexistentes)
   .tmp/test-local vacío tras cada run; dev.db no modificada.

Qué fue verificación independiente del supervisor (evidencia no atribuible a OpenCode):
 - Dos ejecuciones independientes de node scripts/test-local.mjs test/client-build-assets.test.ts test/client-xss-security.test.ts test/b06-submit-cart-races.test.ts test/b05-safe-release.test.ts, cada una 4 archivos / 55 tests, ambas exit 0 y 55/55. Se registran como evidencia independiente del supervisor; no se afirma que OpenCode ejecutó una segunda corrida de 55 en esta sesión más allá de la única corrida listada arriba.
 - Capturas screenshots/c04/c04-viewport-360.png, c04-viewport-390.png y c04-viewport-768.png generadas por el supervisor en reauditoría posterior, verificadas sin overflow en esos viewports. No son artefactos de §38; se mantienen como evidencia independiente sin invalidar la limitación histórica de §38.

Pendientes que mantienen C04 en EN_REVISION/PENDIENTE (no convertidos en aprobación):
 - Zoom 200% sin evidencia automatizada (pendiente browser headless con copia aislada como C03).
 - Teclado/foco automatizado sin evidencia nueva en este § (pendiente).
 - Timeout HTTP post-commit con respuesta perdida sin reproducción HTTP directa sin fault-injection; cobertura actual sustentada en idempotencia SubmitReceipt + clave persistida en sessionStorage (documentado en §39-3), sin inventar test de drop de transporte.
 - Viewports exactos 360/390/768 ya cubiertos por capturas del supervisor, pero zoom/teclado/timeout siguen bloqueando cierre.

Estado tras corrección: C04 permanece EN_REVISION / PENDIENTE; tablero §3 conserva C04 = PENDIENTE; C05 sigue bloqueado. No hay APROBADA_LOCAL ni GO. Esta §40 no borra evidencia histórica necesaria de §38/§39; solo precisa atribución para que una revisión textual no lea que “§38 ya tenía capturas” ni que “OpenCode hizo la segunda corrida de 55”.

## 41. Adenda C04 — evidencia UI supervisor: stock parcial, vaciado y retry sin duplicado a 360 (2026-09-08)

```text
ID / fecha / responsable: C04 / 2026-09-08 / Supervisor (Codex) — prueba UI independiente con agent-browser. Registrada por OpenCode Spark 1.2 solo como adenda documental; sin cambio de producto, sin avance a C05 y sin cambio de C04 a APROBADA_LOCAL.
Checkout / commit: antigravity/core-capabilities-stage00, HEAD 0773ca6, sin commits nuevos ni deploy. Worktree dirty preexistente preservado: sin reset/checkout/clean/stash/deploy/push/cloud/credenciales/datos reales/matar procesos ajenos. dev.db intacta (sin db push/migrate contra ella).
Alcance: solo C04 contra 02-PLAN C04 + B06 + 04-CONTRATO C1–C7 + matriz T02/T11/T12. Solo evidencia UI/DOM con DB efímera. Sin C05/C06, sin API/Prisma/schema nuevos, sin staff/admin, sin cloud, sin datos reales.
Fixture: SQLite efímera nueva (sin dev.db), cliente http://localhost:5173 y API http://localhost:3000/v1 aislados; copia no reutiliza .tmp/c04-browser-* previo. Restaurante Trattoria del Puerto, mesa y sesión de comensal creadas en esa DB efímera (sin tokens en registro).

1) Stock parcial — fallo con resto intacto a 360x800 (evidencia principal de este §):
   Acciones (agent-browser, viewport 360x800):
     - Abrir cliente 360x800, recorrer carta → dos platos agregados por UI al carrito: Fettuccine Frutti di Mare y Pizza (cantidad 1 cada uno).
     - Marcar solo en la DB efímera Fettuccine como no disponible (update MenuItem isAvailable=false / priceMinor sin efecto en precio histórico) sin tocar dev.db ni código.
     - Desde #cartItemsList / modal carrito, pulsar "Enviar pedido" (submitCart con idempotencyKey persistida por token/borrador en sessionStorage).
   Resultado DOM real observado (sin inferencia):
     - Error visible en carrito: `El plato "Fettuccine Frutti di Mare" ya no está disponible; quitalo y reenviá — Fettuccine Frutti di Mare Quitá ese ítem; el resto queda intacto.` (dos líneas de detalle: nombre + acción "Quitá ese ítem; el resto queda intacto").
     - 2 líneas conservadas en el carrito, total `$29.000` (no es cuenta), heading `En tu carrito — borrador`, estado `Borrador · 2 ítems`, mensaje de borrador/no cobrado visible.
     - Ancho body/document 360 medido (body.scrollWidth 360, document.scrollWidth 360), sin overflow horizontal a 360.
     - Captura guardada y revisada: screenshots/c04/c04-stock-failure-360.png (67382 bytes). Verificada sin recorte de importes/acciones.
   API coherente (misma DB efímera): DRAFT intacto con 2 ítems tras 422 ITEM_NOT_AVAILABLE; sin tanda enviada, sin duplicado.

2) Vaciado completo desde #cartItemsList — misma campaña UI efímera:
   Acciones: en el mismo carrito 360x800, pulsar Quitar sobre primera fila (#cartItemsList) → luego Quitar sobre la última restante.
   Resultado DOM real final observado:
     - 0 líneas, `$0`, etiqueta `Borrador vacío`, empty state visible en carrito.
     - Botón enviar deshabilitado (no envía vacío), sin cambio de consumo enviado (consumo 0 → sigue 0; no se creó tanda ni se alteró PENDING_VALIDATION previo de esta DB).
   Nota: Order DRAFT con 0 ítems conservado (no borra fila), coherente con B06 removeItem en tx.

3) Corrida UI previa en la misma DB efímera — quitar solo el no disponible y reenviar sin duplicado:
   Acciones previas: tras fallo con Sorrentinos no disponible y 2 líneas en carrito, se quitó solo el ítem no disponible (Sorrentinos) y se pulsó Enviar pedido con el restante (Fettuccine).
   Resultado DOM real observado:
     - UI `Última tanda enviada`, `Esperando validación del mozo`, 1 línea `$16.200` visible en carrito/tanda.
     - Consulta Prisma aislada sobre la misma DB efímera confirmó: 1 PENDING_VALIDATION, 0 DRAFT, 1 ítem con totalMinor=1620000. Sin duplicado (SubmitReceipt + idempotencyKey), sin tercera tanda, sin draft remanente.

Comandos/acciones y límites con precisión:
  - Medio: agent-browser (Chrome/CDP) + SQLite efímera nueva (no dev.db) + API/Cliente locales; sin fault-injection de red.
  - Comandos verificables: viewport 360x800, click/agregado UI, update DB efímera de disponibilidad, Enviar pedido desde carrito, lectura DOM (innerText/error/total/heading/estado/scrollWidth), Get-ChildItem screenshots/c04/c04-stock-failure-360.png (67382 bytes), consultas Prisma aisladas (count por status + totalMinor). Sin tokens/credenciales en registro.
  - Diferenciación histórica preservada: evidencia §38 (352 sin overflow, 53/53, sin capturas 360/390/768), §39 (closeCartModal + T11c/T12d 55/55 + lote 140) y §40 (corrección de trazabilidad) siguen vigentes y no borradas; capturas 360/390/768 de reauditoría previa (c04-viewport-360.png 166402 bytes, c04-viewport-390.png 179330 bytes, c04-viewport-768.png 293096 bytes) permanecen como evidencia independiente del supervisor, no atribuidas a §38. Esta §41 añade c04-stock-failure-360.png sin sustituirlas.
  - Sin cambio de producto en este §: no se editó apps/client-web/app.js, index.html, styles.css, ni packages/api/* ni schema/migraciones; solo esta adenda documental. Diff propio = solo este archivo.

Pendientes que mantienen C04 en EN_REVISION/PENDIENTE (no convertidos en aprobación):
  - Zoom 200% sin evidencia automatizada nueva en este §.
  - Teclado/foco automatizado sin evidencia nueva en este §.
  - Timeout HTTP post-commit con respuesta perdida sin reproducción HTTP directa sin fault-injection; cobertura sustentada en idempotencia SubmitReceipt + clave persistida en sessionStorage (documentado en §39-3), sin inventar test de drop de transporte.
  - Si el control considera que zoom 200%, teclado/foco y timeout post-commit pertenecen a C03/C08/V03 y no a C04, se declara así sin reabrir ni aprobar C04 hasta que el control lo decida. C04 sigue EN_REVISION/PENDIENTE y tablero §3 conserva C04 = PENDIENTE; C05 bloqueado; sin APROBADA_LOCAL ni GO.

Reversión: git diff de este archivo + borrar screenshots/c04/c04-stock-failure-360.png si se requiere revertir evidencia; DB efímera desechable; dev.db intacta.
Estado: C04 EN_REVISION / PENDIENTE (no APROBADA_LOCAL en este acto). No avanza a C05.
```

## 42. Decisión de gate C04 y habilitación de C05 (2026-09-08, Supervisor Codex)

```text
Revisión contra el alcance exacto de 02-PLAN C04:
 - Dos sesiones de navegador sobre la misma mesa: el borrador compartido conserva
   ambas líneas y el conflicto se hace visible; no hay sobrescritura silenciosa
   (B06 T11/T11b/T11c y evidencia UI de §38–§41).
 - Detalle y retorno: la categoría y posición se restauran al cerrar detalle o
   carrito; nombres/notas largas y precios quedan legibles y el borrador se
   distingue de una tanda enviada (§39 y §41).
 - Quitar el último ítem: deja borrador vacío, total $0 y consumo enviado intacto;
   no permite enviar una tanda vacía (§39 T11c y §41).
 - Stock fallido: 422 localizado, el ítem no disponible se identifica y el resto
   del borrador queda intacto; se puede quitar solo ese ítem y reenviar sin duplicar
   la tanda (§39 T12d y §41, captura c04-stock-failure-360.png).
 - Agregar no cobra: el alta permanece DRAFT; el cobro/consumo solo aparece luego
   de enviar y validar según el contrato B03/B06 (§38–§41).

Decisión: C04 APROBADA_LOCAL. La decisión es local y no equivale a GO de G2.
Los criterios de zoom 200%, teclado/foco y recuperación general ante sesión/red
pertenecen a C03/C08/V03; C03 ya tiene su evidencia de carta (§34), mientras que
C08/V03 permanecen pendientes. La recuperación de respuesta incierta de T10 queda
asignada a C05/B06; la clave persistida e idempotencia ya están implementadas y
probadas, pero no se inventa una simulación de red caída.

Dependencias: C03 y B06 aprobadas localmente; C05 queda habilitada. No se modifican
estados de cocina, no se declara G2 ni se autoriza despliegue.
Siguiente paso: implementar C05 — historial por ronda, estados de envío, validación
directa/requerida, rechazo parcial y recuperación al reabrir el navegador — con
pruebas API/UI y luego reauditoría independiente.
```
```

## 43. Ejecución y gate C05 — historial por ronda (2026-09-08, Supervisor Codex)

```text
ID / fecha / responsable: C05 / 2026-09-08 / Supervisor Codex.
Checkout / referencia: antigravity/core-capabilities-stage00, HEAD 0773ca6,
sin commit nuevo ni deploy; worktree dirty preexistente preservado.

Implementación:
 - packages/api/src/services/order.service.ts agrega getSessionOrderHistory() y
   una proyección estable por Order: cada envío conserva identidad, estado,
   timestamps, totalMinor y líneas snapshot; DRAFT queda fuera. La respuesta
   existente GET /v1/orders/session/:token ahora incluye history, sin romper order
   ni account ni exponer guestSessionId/notas técnicas.
 - apps/client-web/app.js conserva el historial recibido del servidor y renderiza
   “Tus pedidos” dentro del recorrido del carrito, separado del borrador. Los
   estados se expresan en lenguaje de cliente: esperando confirmación, recibido
   para preparar/en cocina, listo para entregar, entregado y rechazado/cancelado.
   Nombres e importes se escapan y los importes history se formatean desde centavos.
 - apps/client-web/index.html incorpora el bloque accesible orderHistorySection,
   sin crear una navegación dominante nueva.
 - packages/api/test/c05-order-history.test.ts cubre tres rondas + DRAFT, pendientes
   y canceladas fuera de consumo, validación requerida, envío directo, actualización
   posterior y una ronda rechazada sin ocultar la aceptada restante.

Pruebas técnicas:
 - node scripts/test-local.mjs test/c05-order-history.test.ts
   test/b03-session-account.test.ts test/b06-submit-cart-races.test.ts
   test/client-build-assets.test.ts → exit 0, 4 archivos / 30 tests.
 - npm --workspace=@mesaya/client-web run build → exit 0.
 - npx tsc --noEmit -p packages/api/tsconfig.json → exit 0.
 - node --check apps/client-web/app.js → exit 0.
 - git diff --check sobre los archivos propios → exit 0.
 Todas las pruebas de persistencia usaron SQLite efímera del runner; no se tocó
 dev.db ni se desplegó.

Prueba UI integrada y reapertura:
 - Fixture aislada .tmp/c05-browser-20260908.db, API/cliente locales, Mesa 1,
   tres envíos reales por API y un cuarto DRAFT. Se dejó la primera tanda SERVED,
   la segunda IN_KITCHEN, la tercera PENDING_VALIDATION y el nuevo Aperol como DRAFT.
 - En el primer navegador, #modalCart mostró el borrador arriba y tres tarjetas
   “Tus pedidos” en orden, con “Entregado”, “Recibido para preparar — en cocina”
   y “Esperando confirmación”.
 - Se cerró la sesión de navegador y se abrió una nueva con la misma mesa. Tras
   cargar desde GET /orders/session, el DOM volvió a mostrar las tres tandas y el
   DRAFT separado; no dependió de sessionStorage para recuperar el historial.
 - Captura visual revisada y persistida: screenshots/c05/c05-history-390.png.
   En 390 px no se observó overflow horizontal ni corte de nombres/importes en la
   porción capturada; la captura de scroll mostró las tres tarjetas y el botón.

Limitaciones honestas:
 - La recuperación de respuesta perdida después del commit no simula una partición
   HTTP artificial; la protección contra duplicado queda cubierta por B06
   SubmitReceipt + clave persistida, y la reapertura valida la lectura posterior.
 - El contrato actual modela el rechazo a nivel de tanda (Order.CANCELLED), no el
   rechazo de una línea individual dentro de una misma tanda. La prueba de “parcial”
   significa una ronda cancelada mientras otra permanece aceptada, que es la
   semántica vigente; si se requiere rechazo por ítem, debe abrirse un contrato y
   migración propios antes de afirmarlo.
- La cancelación existente no persiste todavía motivo/auditoría específica de la
   orden; esa deuda quedó identificada y se corrige en la adenda de auditoría §44.
 - C05 no aprueba C06 (cuenta completa), C07/C08, S01–S11 ni G2.

Decisión: C05 APROBADA_LOCAL. La aceptación se limita al historial por ronda y a
la distinción entre DRAFT, pendiente, preparación, entrega y cancelación conforme
al contrato vigente. Siguiente etapa autorizada: C06 — conectar la cuenta completa
de la sesión a cliente, con consumo acumulado, pagos, saldo, propina y pedido de
atención presencial.
```

## 44. Adenda C05 — auditoría obligatoria de rechazo/cancelación (2026-09-08, Supervisor Codex)

```text
Hallazgo de reauditoría: §43 aprobaba la presentación del historial, pero dejaba una
falencia contractual frente a T05/C2: una Order podía pasar a CANCELLED sin persistir
motivo ni actor. El historial no puede mostrar una auditoría que el servidor no guarda.

Corrección acotada a C05:
 - packages/api/prisma/schema.prisma y schema.supabase.prisma agregan los campos
   anulables cancellationReason, cancelledBy y cancelledAt; la migración PostgreSQL
   20260908190000_order_cancellation_audit/migration.sql es aditiva (tres columnas
   TEXT/TIMESTAMP, sin DROP/DELETE) y conserva órdenes históricas anteriores.
 - updateOrderStatusByStaff exige reason no vacío (recortado a 240 caracteres) y
   staffUserId al pasar a CANCELLED; persiste motivo, actor y timestamp. El endpoint
   PATCH /orders/:id/status acepta reason y conserva 400/403 accionables.
 - OrderDTO y la proyección history transportan cancellationReason y cancelledAt,
   pero nunca cancelledBy; el cliente muestra el motivo al comensal solo para una
   tanda cancelada. El rechazo de ítem individual sigue fuera del contrato vigente.
 - c05-order-history.test.ts ahora prueba motivo, actor y lectura del motivo, además
   de que la ronda cancelada no entre en consumo ni oculte la ronda aceptada.

Verificación posterior a la corrección:
 - prisma validate schema.prisma → exit 0.
 - prisma validate schema.supabase.prisma con URL PostgreSQL sintácticamente válida
   de fixture → exit 0.
 - npm run build:shared → exit 0; necesario para refrescar OrderDTO consumido por API.
 - suite C05 + B03 + B06 + staff-orders-kitchen + assets de cliente → exit 0;
   5 archivos / 57 tests.
 - tsc --noEmit -p packages/api/tsconfig.json, node --check del cliente,
   check de paridad de schemas y git diff --check → exit 0.

Estado: C05 APROBADA_LOCAL (§44), únicamente como evidencia técnica local reproducible.
No implica migración aplicada a PostgreSQL, staging, producción, operación física ni
GO de usuarios reales. C06 queda habilitada; la limitación restante de C05 es el
rechazo por ítem, que requiere contrato propio si se lo solicita.
```

## 45. Ejecución y gate C06 — cuenta acumulada y solicitud presencial (2026-09-08, Supervisor Codex)

```text
ID / fecha / responsable: C06 / 2026-09-08 / Supervisor Codex.
Checkout / referencia: antigravity/core-capabilities-stage00, HEAD 0773ca6,
sin commit nuevo ni deploy; worktree dirty preexistente preservado.

Implementación:
 - apps/client-web/app.js migra loadBillDetails al campo account de
   GET /v1/orders/session/:token. El total principal usa account.consumoMinor y
   el resumen separa paidMinor, tipMinor y saldoMinor; pendingValidation y draft
   se informan como no cobrables. No hay fallback silencioso a la comanda parcial.
 - El detalle agrupa las líneas de todas las tandas aceptadas, usa importes minor
   y escapeHtml para nombres/estados, y no renderiza notas o IDs técnicos en la
   cuenta pública. Elegir efectivo/tarjeta/MP sigue llamando solo a sendCall('BILL'):
   se solicita atención del mozo y no se procesa un pago desde el cliente.
 - apps/client-web/index.html cambia “Total estimado” por “Consumo acumulado” y
   agrega los tres importes contables separados, saldo y aviso de pendientes/borrador.
 - packages/api/test/c06-account-client.test.ts cubre tres tandas aceptadas más
   pendiente y borrador, pago con propina, nombre con payload, inspección estática
   del loader, nueva tanda posterior al pedido de cuenta y segundo llamado bloqueado.

Verificación técnica:
 - node scripts/test-local.mjs test/c06-account-client.test.ts
   test/c05-order-history.test.ts test/b03-session-account.test.ts
   test/call-state-policy.test.ts test/client-xss-security.test.ts
   test/client-build-assets.test.ts → exit 0, 6 archivos / 40 tests.
 - npm --workspace=@mesaya/client-web run build → exit 0.
 - node --check apps/client-web/app.js → exit 0.
 - node scripts/check-route-matrix.mjs → exit 0, 87 rutas clasificadas.
 - git diff --check → exit 0; no se tocó dev.db.

Prueba UI real local en copia aislada:
 - DB .tmp/c06-browser-20260908.db, API/cliente locales, viewport 390×844,
   mesa/sesión nuevas y tres tandas aceptadas por $43.500; además $10.000 pagos,
   $1.500 de propina, una tanda pendiente y un borrador.
 - Al abrir “Pedir la cuenta”, el DOM mostró “CONSUMO ACUMULADO $43.500”,
   “Pagos registrados $10.000”, “Propina $1.500” y “Saldo pendiente $33.500”.
   El aviso dijo que la tanda pendiente y el borrador no integran consumo.
 - Al expandir el detalle aparecieron las tres tandas aceptadas, sus estados y
   líneas; el nombre de fixture con <img ...> se mostró como texto plano. No se
   observó overflow horizontal en 390 px.
 - Capturas visuales revisadas y persistidas: screenshots/c06/c06-account-390.png
   y screenshots/c06/c06-account-390-full.png.
 - La prueba de API agregó una tanda SERVED después de solicitar la cuenta:
   account.consumoMinor pasó de 4.350.000 a 5.100.000 (ARS_MINOR), sin incluir el
   DRAFT; un segundo pedido de cuenta respondió 429 ACTIVE_CALL_LIMIT.

Limitaciones honestas:
 - La solicitud de cuenta es un llamado operativo; la confirmación física del
   cobro, ticket final y cierre de mesa pertenecen a S08/V05 y no se inventan aquí.
 - La prueba de navegador usa SQLite local aislada y no certifica PostgreSQL,
   staging, producción, dispositivos QR/NFC ni usuarios reales. C06 no aprueba
   C07/C08, S01–S11 ni G2.

Estado: C06 APROBADA_LOCAL (§45), únicamente como evidencia técnica local
reproducible. Siguiente etapa autorizada: C07 — seguimiento de llamados por motivo.
```

## 46. Ejecución y gate C07 — llamados por motivo y seguimiento (2026-09-08, Supervisor Codex)

```text
ID / fecha / responsable: C07 / 2026-09-08 / Supervisor Codex.
Checkout / referencia: antigravity/core-capabilities-stage00, HEAD 0773ca6,
sin commit nuevo ni deploy; worktree dirty preexistente preservado.

Hallazgo inicial y corrección:
 - El contrato previo imponía activeKey = tableSessionId, filtraba una sola
   solicitud activa y el cliente tenía una única tarjeta. Eso impedía que una
   mesa pidiera mozo e insumos en paralelo y hacía desaparecer una necesidad al
   resolver la otra.
 - CallRequest conserva el índice único, pero ahora la clave es
   tableSessionId + type mientras el motivo está PENDING/IN_PROGRESS; al pasar
   a RESOLVED/CANCELLED se libera con activeKey = null. El límite sigue siendo
   uno por motivo y sesión, con arbitraje P2002 para doble toque concurrente.
 - SessionValidationResponse añade activeCalls sin quitar activeCall de
   compatibilidad. La lista incluye type, note, estado y createdAt; las notas se
   escapan en el cliente para que la reconexión no pierda el motivo ni habilite
   HTML. Los timestamps de toma se conservan una sola vez en acknowledgedAt.
 - El cliente renderiza una tarjeta independiente por llamado, con motivo,
   PENDING/IN_PROGRESS, tiempo y cancelación por ID. Polling y reconexión
   reemplazan la lista completa; cancelar o resolver una tarjeta no oculta las
   demás. Errores 404/409 al cancelar informan el conflicto y fuerzan una
   sincronización.

Archivos propios de esta etapa:
 - packages/api/prisma/schema.prisma y schema.supabase.prisma: semántica
   documentada de activeKey por motivo, sin cambiar la forma de la tabla.
 - packages/api/src/services/call.service.ts: deduplicación por type, clave
   activa, transición terminal y timestamp de toma idempotente.
 - packages/api/src/services/session.service.ts y packages/shared/src/index.ts:
   activeCalls con note y compatibilidad activeCall.
 - apps/client-web/app.js e index.html: lista accesible de tarjetas, timers,
   cancelación independiente y sincronización por polling.
 - packages/api/test/c07-call-tracking.test.ts: cobertura vertical C07.

Verificación automatizada:
 - node scripts/test-local.mjs test/c07-call-tracking.test.ts → exit 0,
   1 archivo / 4 tests.
 - Regresión integrada C07 + C06 + C05 + full-system-e2e +
   stream-closure-snapshots + call-state-policy → exit 0,
   6 archivos / 75 tests.
 - La matriz comprobó: dos motivos simultáneos; duplicado secuencial; doble
   toque concurrente con una sola fila; cola de personal con ambos llamados;
   toma de uno conservando el otro; cancelación del tomado sin borrar insumos;
   liberación de activeKey; resolución independiente; estados terminales no
   activos después de reconectar; y ausencia de duplicados en persistencia.
 - npm run build:shared → exit 0.
 - npm --workspace=@mesaya/client-web run build → exit 0.
 - npx tsc --noEmit -p packages/api/tsconfig.json → exit 0.
 - node --check apps/client-web/app.js → exit 0.
 - node scripts/check-route-matrix.mjs → exit 0, 87 rutas clasificadas.
 - node scripts/sync_supabase_schema.js --check → exit 0.
 - prisma validate para schema.prisma y schema.supabase.prisma con URL
   PostgreSQL sintácticamente válida de fixture → exit 0.
 - git diff --check → exit 0; las advertencias de conversión LF/CRLF son de
   Git para worktree Windows y no son errores de whitespace.

Prueba UI real local en copia aislada:
 - DB .tmp/c07-browser-20260908.db, API y Vite locales, viewport 390×844,
   sesión de Mesa 1 con dos llamados creados por los endpoints reales.
 - Tras reconexión, la lista mostró “Insumos • Cubiertos” y
   “Mozo • Necesito agua” en dos tarjetas, ambas pendientes, con contador
   “2 activas”, temporizador y botón propio.
 - Se actualizó el llamado de mozo desde el endpoint staff real. El navegador
   mostró “En atención: el mozo tomó el pedido” solo en esa tarjeta y mantuvo
   insumos pendiente.
 - Se pulsó el botón de cancelación de insumos en la tarjeta correspondiente;
   la tarjeta desapareció y la de mozo en atención permaneció visible.
 - Capturas visuales revisadas: screenshots/c07/c07-two-reasons-390.png y
   screenshots/c07/c07-one-in-progress-390.png.
 - La primera tentativa con API en 127.0.0.1 fue descartada como evidencia:
   el entorno local solo declaraba CORS para localhost. Se reinició el API con
   CORS_ORIGIN explícito para 127.0.0.1 y se repitió toda la carga visual con
   resultado válido.

Limitaciones honestas:
 - C07 conserva la API de cola de personal existente y su polling/SSE; la toma
   atómica entre dos operadores, prioridad, responsable y resolución concurrente
   completa pertenecen a S02–S03. C07 no inventa esas capacidades.
 - Los estados RESOLVED/CANCELLED dejan de ser activos en la tarjeta; el
   resultado de cancelación del propio cliente se confirma con toast y los
   estados terminales quedan persistidos. Un historial permanente de llamados
   no forma parte de C07.
 - La evidencia de navegador usa SQLite local aislada. No certifica PostgreSQL
   aplicado, staging, producción, dispositivos QR/NFC, red física ni usuarios
   reales. Tampoco constituye GO de G2 o de despliegue.

Reversión o recuperación: revertir únicamente los archivos propios de C07 y
   retirar la sección §46; no borrar datos de producción ni ejecutar reset sobre
   el worktree. Las fixtures de .tmp son aisladas y descartables.

Estado: C07 APROBADA_LOCAL (§46), únicamente como evidencia técnica local
reproducible. Siguiente etapa autorizada: C08 — accesibilidad, sesión y fallos.
```

## 47. Ejecución y gate C08 — accesibilidad, sesión y fallos (2026-09-08, Supervisor Codex)

```text
ID / fecha / responsable: C08 / 2026-09-08 / Supervisor Codex.
Checkout / referencia: antigravity/core-capabilities-stage00, HEAD 0773ca6,
sin commit nuevo ni deploy; worktree dirty preexistente preservado.

Hallazgos iniciales y correcciones:
 - Una caída de red en init() se mostraba como “Sesión de Mesa Finalizada”,
   mezclando un fallo transitorio con una sesión cerrada y ocultando el motivo
   real. Se agregó estado “Conexión interrumpida”, banner offline/online y
   reintento accionable; el token no se borra al reintentar.
 - El cliente ya conservaba el carrito/cuenta ante errores, pero ahora las
   operaciones de red clasifican errores probables, muestran “Sin conexión.
   No se enviará nada hasta comprobarlo.” y vuelven a comprobar al recuperar
   conectividad. No aparece confirmación de envío/cobro cuando la petición no
   fue confirmada.
 - Los modales y bottom sheets no tenían contrato ARIA ni gestión común de
   foco. Se agregó dialog/modal/label, foco inicial, Escape, trampa de Tab,
   retorno de foco incluso en overlays anidados y aria-hidden + inert para
   sheets cerrados. El contenido desplazable del detalle es región enfocable.
 - La primera auditoría axe detectó aria-hidden-focus en los sheets y luego,
   al abrir el detalle, un scrollable sin acceso de teclado y contraste menor
   en una ayuda de 10px. Se corrigieron inert, tabindex/role=region y el
   contraste; la reauditoría no dejó violaciones.
 - Las imágenes rotas ya se ocultan con un fallback seguro; la carta, el
   precio y las acciones siguen legibles sin depender de una foto.

Archivos propios de esta etapa:
 - apps/client-web/app.js: estado de red, clasificación de fallos, eventos
   offline/online/pageshow/popstate, gestión de foco/modal, fallback de imagen
   y recuperación de token.
 - apps/client-web/index.html: banner de red, roles/labels ARIA, tamaños de
   cierre touch-friendly, región desplazable y sheets inert cuando cerrados.
 - packages/api/test/c08-client-resilience.test.ts: contrato estático y
   verificación de sesión cerrada mediante API real.

Verificación automatizada:
 - node scripts/test-local.mjs test/c08-client-resilience.test.ts → exit 0,
   1 archivo / 4 tests.
 - node scripts/test-local.mjs test/client-build-assets.test.ts
   test/client-xss-security.test.ts test/c07-call-tracking.test.ts → exit 0,
   3 archivos / 30 tests.
 - npm --workspace=@mesaya/client-web run build → exit 0.
 - node --check apps/client-web/app.js → exit 0.
 - La suite C08 comprobó red honesta sin showExpiredState para el error de
   conexión, reintento sin borrar mesaya_token, eventos de ciclo de vida,
   Escape/Tab/foco/ARIA, viewport sin zoom restrictivo, imágenes con alt y
   sesión cerrada observada como valid:false/isClosed:true sin token.

Prueba UI real local en copia aislada:
 - DB .tmp/c08-browser-20260908.db, API y Vite locales, CORS explícito para
   localhost y 127.0.0.1, sesión de Mesa 1 y navegador Chromium controlado.
 - Estado inicial: axe 0 violations; menú abre y enfoca “Cerrar carta”; Escape
   cierra y devuelve el foco a “Abrir Carta”. La secuencia carta → detalle →
   Escape → Escape devolvió primero al plato y luego al botón de carta.
 - Con set offline on, “Llamar al mozo” no confirmó éxito y dejó el modal
   disponible; “Pedir la cuenta” mostró “Cuenta no disponible por el momento”
   y el banner offline. Con set offline off, la comprobación volvió y el
   banner se ocultó tras éxito.
 - Con viewport 390×844 y cuatro aumentos Control++ (zoom 200% del navegador),
   innerWidth/clientWidth/scrollWidth quedaron 390/390/390: sin overflow
   horizontal. Captura revisada: screenshots/c08/c08-zoom-200-390.png.
 - Se bloquearon las rutas de imágenes locales y Unsplash. El hero falló sin
   mostrar alt roto, mantuvo carta/acciones legibles y no hubo overflow.
   Captura revisada: screenshots/c08/c08-no-images-390.png.
 - Se creó una entrada de historial con pushstate y se usó back; popstate
   releyó la sesión, recuperó el restaurante y dejó acciones visibles sin
   overlay abierto.
 - axe en estado inicial y en detalle abierto terminó con violations: 0. Las
   salidas reportaron únicamente una comprobación incompleta de contraste por
   gradientes que axe no puede determinar automáticamente; no se registró como
   violación ni se ocultó ningún error funcional.

Limitaciones honestas:
 - La evidencia es local y aislada: no certifica PostgreSQL, staging,
   producción, red física, lector de pantalla específico, dispositivos QR/NFC
   ni usuarios reales. La prueba de lector se limita al árbol de accesibilidad
   Chromium y axe disponible; se recomienda NVDA/VoiceOver en V03/piloto.
 - No se modificó el servidor para simular respuesta perdida después de un
   commit; la idempotencia de pedidos y sus pruebas siguen en B06/C04–C06.
 - C08 aprueba el cliente resiliente y su navegación; no aprueba S01–S11,
   V03/V05, G2 ni despliegue.

Reversión o recuperación: revertir únicamente los archivos propios de C08 y
   retirar la sección §47; no borrar datos de producción ni ejecutar reset sobre
   el worktree. La DB y capturas son artefactos locales de verificación.

Estado: C08 APROBADA_LOCAL (§47), únicamente como evidencia técnica local
reproducible. Siguiente etapa autorizada: S01 — boceto de terminal compartido.

```

## 48. Cierre local B00 + S01–S04 (2026-09-08; ejecución directa Codex)

Alcance: regularizar la línea base reproducible y cerrar el primer bloque de
Servicio. Se preservó el worktree sucio y no se tocaron las dos sesiones de
OpenCode del usuario. No se usaron datos reales ni se publicó nada.

Implementación comprobada:

 - `packages/shared/src/index.ts` define el contrato de tareas, claims, cuenta
   y workspace de Servicio.
 - `packages/api/src/services/service-workspace.service.ts` compone un único
   snapshot con mapa, llamados, comandas, cuentas por ocupación y claims; no
   crea una segunda cuenta ni calcula la cuenta en el navegador.
 - `packages/api/src/services/service-task.service.ts` arbitra la toma con
   clave activa única, tenant y estado canónico. Una claim cuyo llamado/pedido
   ya terminó se reconcilia como histórica y no queda visible como pendiente.
 - `packages/api/src/routes/service.routes.ts` expone snapshot, toma,
   reasignación y resolución bajo JWT de personal.
 - `apps/staff-panel/src/components/ServiceWorkspace.tsx` abre en Servicio,
   ordena por prioridad/antigüedad, filtra por trabajo y sector, muestra el
   mapa compacto y abre el contexto de mesa.
 - La pantalla no usa SSE duplicado para Servicio: su frontera es el snapshot
   y el refresco aplica backoff, pausa/reduce actividad en pantalla oculta y
   conserva el último estado ante error.

Evidencia automatizada:

 - `node scripts/test-local.mjs test/s01-s03-service-workspace.test.ts test/s05-s11-service-flow.test.ts` → exit 0, 2 archivos / 8 tests.
 - `npm run check:routes` → exit 0, 92 rutas clasificadas sin deriva.
 - `npm run check:supabase-schema` → exit 0, schema canónico y Supabase sincronizados.
 - `npm run build:shared` → exit 0.
 - La suite completa repetida después de estos cambios cerró en exit 0:
   52 archivos pasados, 1 omitido; 505 tests pasados, 3 omitidos.

Evidencia de interfaz local aislada:

 - Se preparó `.tmp/ux-verification-20260908.db` desde cero y se levantaron API,
   cliente, staff y admin en 3000/5173/5174/5175. Al terminar se detuvieron
   únicamente esos servidores y los cuatro puertos quedaron libres.
 - Staff inició con una cola vacía y las 22 mesas; un llamado real generado
   desde cliente apareció en Servicio, con Mesa 1 y sector, y pudo pasar de
   “Me ocupo” a “Marcar atendido”. El mapa mostró el contador de pendiente y
   el contexto de Mesa 1 bloqueó “Liberar mesa” mientras quedaba trabajo.
 - La misma secuencia quedó capturada en
   `screenshots/s01/s01-service-1024.png`,
   `screenshots/s01/s01-service-1366.png` y
   `screenshots/s01/s01-service-task-context-1024.png`.

Dictamen: B00, S01, S02, S03 y S04 **APROBADA_LOCAL**. La aprobación significa
que la línea base y el terminal simulado son reproducibles y que cada tarjeta
representa trabajo real; no certifica todavía recepción física en cocina ni
operación por personas reales.

## 49. Cierre local S05–S11 (2026-09-08; ejecución directa Codex)

Implementación comprobada:

 - El pedido presencial se carga por una ruta atómica en
   `packages/api/src/services/order.service.ts` y
   `POST /v1/staff/tables/:tableId/orders`: valida tenant, menú, stock,
   cantidades y notas; crea una tanda nueva `IN_KITCHEN` en la ocupación
   vigente, con `source=STAFF_TERMINAL` y actor auditable.
 - `KitchenOrdersManager` usa esa misma ruta por lote; ya no agrega líneas en
   un bucle que pueda mezclar la ronda presencial con una comanda anterior.
 - La cuenta contextual usa la proyección por `tableSession`, muestra tandas,
   consumo, pagos, saldo y propina separada dentro de la mesa. El cobro no
   libera automáticamente la mesa.
 - El cobro de un mozo abre reautorización puntual; el PIN de Encargado se
   valida en la API y su token temporal no reemplaza la identidad persistida
   del mozo ni se guarda en localStorage.
 - Las tareas de cocina avanzan por estados reales: validar, preparar, listo,
   entregar. La claim anterior no sobrevive como pendiente cuando el hecho ya
   fue confirmado.
 - El terminal señaliza snapshot atrasado, desconexión, recuperación y reintento;
   las funciones secundarias quedan en “Más” y los módulos no disponibles
   explican su motivo sin prometer una integración inexistente.

Evidencia:

 - `node scripts/test-local.mjs test/s05-s11-service-flow.test.ts test/s01-s03-service-workspace.test.ts` → exit 0, 10/10 tests.
 - La prueba incluye tanda QR previa + pedido manual, origen/actor, flujo de
   cocina, cobro de saldo completo, propina separada, permiso insuficiente,
   replay idempotente único, claim de cuenta y reintento después de saldo cero.
 - El navegador comprobó llamado cliente → cola de Servicio → toma por mozo →
   resolución, junto con contexto de mesa y acción de cocina visible.
 - La auditoría estática y el build del staff cubren reautorización puntual,
   polling con backoff y módulos secundarios; el build no depende de que un
   usuario abra primero Caja o Cocina.

Reauditoría posterior al primer cierre: al probar una comanda presencial sobre
una mesa `AVAILABLE`, se detectó que el pedido se persistía pero la transición
directa `AVAILABLE → ORDER_IN_KITCHEN` era inválida para la FSM y el error se
silenciaba. Se corrigió `OrderService` para resolver la secuencia canónica
`AVAILABLE/RESERVED/TO_CLEAN → OCCUPIED_NO_ORDER → ORDER_IN_KITCHEN`, reintentar
únicamente conflictos de estado y rechazar mesas `PAID` antes de escribir. La
regresión adicional verifica que una mesa cobrada no cree pedido ni sesión
huérfana. El bloque reejecutado cerró 10/10 y la suite completa posterior
cerró 507/507.

En una base SQLite efímera nueva, el navegador repitió pedido presencial desde
mesa disponible, preparación, listo, entrega, reautorización de cobro con PIN
de Encargado, saldo cero y liberación posterior a `Por limpiar`. No se tocó la
base del usuario ni las sesiones de OpenCode.

Dictamen: S05, S06, S07, S08, S09, S10 y S11 **APROBADA_LOCAL**. La parte de
recepción física, sonido/ubicación del dispositivo de cocina y cobro con un
medio de pago real siguen siendo límites externos, no se presentan como
verificados por esta aprobación.

## 50. Cierre local A01–A05 (2026-09-08; ejecución directa Codex)

 - A01 protege el borrador de geometría de `useFloorPlanStore` frente a
   snapshots vivos y frente a un guardado fallido no conflictivo; la prueba
   dedicada cerró 5/5 tests y el error deja el draft conservado con reintento
   visible en `FloorPlanManager`.
 - A02 se inspeccionó en el dashboard: las capacidades no disponibles aparecen
   deshabilitadas con razón operativa (split bill, waitlist, pre-order y
   rewards), sin habilitarse por guardar una opción no relacionada.
 - A03 conserva editor, categorías, precios, stock y nombres largos; el panel
   muestra el enlace accesible “Abrir vista previa de la carta para el cliente”
   apuntando a la mesa de prueba. Se verificaron 4 categorías y 9 platos.
 - A04 preserva las 22 mesas y sus links permanentes. El modal QR mostró la URL
   de Barra 1 y el cliente resolvió tanto el contrato query existente como la
   ruta canónica `/r/trattoria-del-puerto/mesa/Mesa%201`.
 - A05 reemplaza “Ahorro Estimado” por “Medición de ahorro” y retira la
   garantía porcentual de WhatsApp; las métricas y fallbacks se presentan como
   medidos, disponibles o no disponibles, según corresponda.

Evidencia automatizada y visual:

 - `npx vitest run apps/admin-dashboard/src/stores/useFloorPlanStore.test.ts --pool=forks --maxWorkers=1` → exit 0, 5/5 tests.
 - `npm --workspace=@mesaya/qr-generator run test` → exit 0, 3/3 tests de URL estable para QR/NFC.
 - `npm run instance:test` → exit 0, 5/5 tests; `npm run instance:validate` →
   manifiesto `trattoria-del-puerto` válido y sin secretos.
 - `npm --workspace=@mesaya/admin-dashboard run build` → exit 0; se verificó
   en navegador el clon de una tarjeta del plano, el editor de carta, el
   enlace de vista previa, la configuración de capacidades y el modal QR.

Dictamen: A01, A02, A03, A04 y A05 **APROBADA_LOCAL**. La prueba QR local no
equivale a imprimir/leer una etiqueta física; la edición del plano local no
equivale a dos administradores concurrentes contra PostgreSQL real.

## 51. V01 — Recorridos completos automatizados (2026-09-08)

La integración local se comprobó por dos vías complementarias: la suite API
consulta persistencia y la navegación real cruza las superficies. Se verificó
que el cliente abre carta real desde link QR, que el staff ve la mesa y el
llamado en Servicio, que la claim cambia el responsable visible y que resolver
la tarea la retira de la cola sin borrar el mapa. Admin conserva la URL de
mesa, la carta de 4 categorías/9 platos y el QR modal.

La suite completa incorpora los recorridos B02–B06, C04–C08, caja, aislamiento
de instancia/tenant, FSM, métricas, staff, contrato de terminal y S01–S11. La
reejecución posterior a la corrección de la FSM terminó en 507 tests pasados y
3 omitidos.

Dictamen: V01 **APROBADA_LOCAL** para el terminal simulado. No se afirma que
un pedido haya llegado a una cocina física ni que una persona real haya
completado las tareas sin asistencia.

## 52. V02 — Concurrencia y fallos inducidos (2026-09-08)

Evidencia reejecutada: carreras de carrito/envío y cobro de B06/B04, doble toma
de tarea S03, claims huérfanas, cuenta que vuelve a cero, aislamiento de tenant,
replay idempotente y cliente resiliente. Los resultados no se obtuvieron
alterando totales ni eliminando registros para hacer pasar la prueba. El
servidor traduce conflicto de claim/cobro a respuesta accionable y la UI
conserva la tarjeta o el último snapshot para reintentar.

La suite completa cerró sin discrepancia financiera ni tarea perdida. También
se comprobó que un hecho que termina antes de la resolución de su claim no
queda fantasma en el siguiente snapshot.

Límite: esto no es una prueba de carga de 22 terminales reales ni de latencia
de una red de local; es una prueba de concurrencia y fallos reproducible en
SQLite aislada, suficiente para el gate local y no para certificar capacidad
de producción.

Dictamen: V02 **APROBADA_LOCAL** con alcance de concurrencia/fallos locales.

## 53. V03 — Revisión visual y accesible (2026-09-08)

Artefactos revisados: cliente en 390 px y zoom 200% sin overflow horizontal
(`screenshots/c08/c08-zoom-200-390.png`), cliente sin imágenes
(`screenshots/c08/c08-no-images-390.png`), carta/historial/cuenta/llamados en
`screenshots/c04`, `screenshots/c05`, `screenshots/c06` y `screenshots/c07`, y
Servicio en 1024/1366 px bajo `screenshots/s01`.

La auditoría axe del estado actual de Servicio devolvió `violations: 0`
(34 passes, 55 inapplicable y 1 comprobación incompleta de contraste sobre
gradientes que axe no puede resolver automáticamente). El cliente C08 también
había cerrado con 0 violaciones; se comprobaron foco, Escape, roles de diálogo,
botones grandes y navegación de regreso. El mapa de Servicio tiene descripción
accesible y mesas operables por teclado.

Dictamen: V03 **APROBADA_LOCAL** en Chromium/axe y resoluciones documentadas.
NVDA/VoiceOver, luz/sonido del local y pruebas con usuarios mayores quedan
fuera de esta verificación automática.

## 54. V04 — Regresión y arranque de base limpia (2026-09-08)

Resultados:

 - `npm --workspace=@mesaya/api run build` → exit 0 después de detener los
   servidores locales aislados; Prisma generó el cliente y TypeScript compiló.
 - `npm --workspace=@mesaya/staff-panel run build` → exit 0.
 - `npm --workspace=@mesaya/admin-dashboard run build` → exit 0.
 - `npm --workspace=@mesaya/client-web run build` → exit 0.
 - `npm run build:shared` → exit 0.
 - `npm run check:routes`, `npm run check:supabase-schema`, pruebas QR y
   manifiesto de instancia → todos exit 0.
 - `node scripts/test-local.mjs` → exit 0, 52 archivos pasados / 1 omitido,
   507 tests pasados / 3 omitidos (reejecución posterior a la corrección FSM).

Durante la verificación se registró un primer `EPERM` de `prisma generate`
porque el servidor SQLite de prueba seguía abierto. No se forzó el archivo ni
se hizo reset: se detuvo sólo el proceso propio, se confirmó que 3000/5173/
5174/5175 estaban libres y el mismo build del API pasó a continuación.

Dictamen: V04 **APROBADA_LOCAL**. No incluye despliegue, restauración cloud ni
prueba con PostgreSQL/Supabase.

## 55. V05 — Evaluación de tareas y límite humano (2026-09-08)

Simulación técnica ejecutada: abrir cliente por mesa, abrir carta real, generar
un llamado, localizarlo en Servicio entre 22 mesas, tomarlo, abrir contexto,
resolverlo, comprobar mapa/contadores y revisar que admin conserva carta, QR y
configuración. La simulación de cuenta/cocina/concurrencia está además cubierta
por las pruebas de API y los builds.

No hubo participante humano, lector de pantalla dedicado, dispositivo físico,
red de local ni recepción comprobable en cocina. Por eso V05 queda aprobada
únicamente como **simulación local**; la evaluación humana/operativa permanece
`PENDIENTE_EXTERNO` y no se convierte en una métrica inventada de tiempo o
cantidad de toques.

## 56. V06 — Dictamen final por alcance (2026-09-08; Codex)

Resultado técnico local: las 37 etapas tienen implementación o evidencia
documentada; B00–B06, C01–C08, S01–S11, A01–A05 y V01–V05 (simulación) quedan
cerradas como `APROBADA_LOCAL`. G1, G2, G3 y G4 quedan aprobados sólo dentro
del alcance local indicado. La suite completa, builds, matriz de rutas,
paridad de schema, QR y manifiesto no muestran un bloqueante técnico local.

La revisión final no fue sólo una repetición del primer cierre: la prueba
browser/API de pedido presencial encontró y corrigió la transición FSM inválida
de una mesa `AVAILABLE` que el primer bloque había dejado pasar. La corrección
quedó cubierta por 10/10 pruebas dirigidas, una prueba negativa para `PAID` y
la suite completa posterior de 507/507; el recorrido navegador llegó hasta
saldo cero y `Por limpiar`.

Por qué la corrección responde al problema original:

 1. La cuenta ya no depende del borrador ni de la última comanda: la verdad es
    una proyección de la ocupación/sesión, con tandas enviadas, borrador,
    pagos, propina y saldo separados; el cobro usa versión esperada e
    idempotencia.
 2. El terminal del mozo empieza por Servicio y trabajo pendiente, no por
    cinco módulos simétricos: cada tarea conserva origen, mesa, sector,
    antigüedad y dueño; el mapa es contexto compacto y la mesa concentra
    pedido manual, cocina, cuenta y liberación.
 3. Cocina y entrega avanzan por estados físicos confirmables; no se marca
    “listo” o “entregado” sólo por cambiar de pantalla, y una claim vencida no
    oculta el trabajo.
 4. El cobro sensible pide Encargado en el punto de acción, sin heredar su
    permiso al mozo; el pago no se confunde con mesa disponible.
 5. El cliente mantiene la jerarquía pedida: sin sección de platos estrella ni
    “Ver Carta” en el encabezado, carrito como acción de encabezado, acciones
    grandes y carta legible; plano/QR y capacidades no disponibles se
    conservan con mensajes veraces.

Dictamen final: **APROBADA_LOCAL TÉCNICA; NO-GO PARA PILOTO/PRODUCCIÓN HASTA
COMPLETAR LA PARTE EXTERNA**. Antes de operar con clientes reales faltan,
como mínimo, evaluación humana en el dispositivo elegido, comprobación de
recepción/sonido/ubicación de cocina, despliegue con PostgreSQL/Supabase,
migraciones aplicadas y verificadas, backup/restore y recorrido físico de QR o
NFC. Nada de esta sección autoriza deploy, push, uso de credenciales reales o
cobro real.

Reversión/recuperación: las DB `.tmp/ux-verification-*.db` y capturas son
artefactos locales. Si se debe revertir una parte, retirar únicamente el
parche de la etapa correspondiente y sus pruebas/documentación; no ejecutar
`reset`, `checkout`, `clean`, `stash` ni borrar el worktree compartido.
