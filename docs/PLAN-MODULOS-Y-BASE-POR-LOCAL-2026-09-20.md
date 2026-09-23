# Plan de módulos operativos y base por local

## Alcance y punto de partida

Pedido: analizar ahora y ejecutar por etapas en otra conversación. Este documento no autoriza por sí mismo migraciones, activaciones, cobros ni despliegues. En esta revisión sólo se consultaron código y configuración pública y se escribió documentación.

Base remota consultada: `origin/main`, SHA `6a1cdaead105750dfc6808cac1383018bb58ee15`, merge de la integración Fauno. Código leído en `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-fauno-table-integration`; su árbol no difiere de esa base. El checkout principal está atrasado y tiene cambios del usuario: no actualizarlo por fuerza ni usarlo como base de ejecución.

La revisión de código no certifica que API, Admin y Staff tengan ese SHA desplegado. E00 debe identificar la versión efectiva de cada aplicación y las migraciones de Supabase. Configuración pública consultada el 20/09/2026, hora local: `https://api-mesa-ya.vercel.app/v1/restaurants/mesaya-piloto/config`.

Modelo comercial acordado: una instalación y código personalizable por negocio, con Supabase y Vercel independientes. Diseño de carta a medida mediante código y assets del local. No invertir en un selector comercial de templates; conservar compatibilidad temporal donde haga falta para migrar lo existente.

Interpretaciones por confirmar, sin bloquear el resto: “correo presencial” = cobro presencial; “relaciones” = reseñas; “cliente inteligente” posiblemente refiere a **Fila Virtual Inteligente**, etiqueta presente en Admin. Aclaración recibida del usuario: donde la transcripción decía “70 DHF”/APK se refería a la **API key del sommelier**. No hay pedido de diagnóstico de dispositivo ni de APK.

## Diagnóstico con evidencia

| Área | Evidencia actual | Consecuencia y tratamiento propuesto |
|---|---|---|
| Configuración de módulos | `ModuleConfigManager.tsx`; `config.service.ts` construye capacidades de forma estática | Un interruptor guardado no prueba un circuito completo. Definir estado configurado, disponible y efectivo con motivos coherentes en todas las apps. |
| Fauno y pedidos | `apps/client-web/app.js`: `STATIC_CATALOG_BY_RESTAURANT`, `staticMenuOnly`; sommelier lee Prisma | La carta visible usa Fauno, pero backend e IA consultan otro catálogo. Unificar catálogo antes de activar pedidos, prepedidos o recomendaciones Fauno. |
| Comandas | `allowOrdering`, `requireWaiterValidation`, `reviewQuantityThreshold` y `order.service.ts` | Existen modo informativo y revisión manual/por excepciones. Probar su comportamiento conjunto, permisos, cocina y cambios durante una visita. |
| Carrito compartido | `syncSocialCart` se guarda en config; no se encontraron consumidores en cliente ni servicio de órdenes dentro de las búsquedas realizadas | No anunciar carrito individual funcional. Precisar contrato y elegir implementarlo o retirar el interruptor redundante. |
| Cobro presencial y PIN | `auth.middleware.ts`, `order.service.ts`, `ServiceWorkspace.tsx` | Hay restricciones de rol y efectivo por mozo. Verificar todos los caminos de cobro, tanto Caja como Atención, y autorización de encargado. |
| Mercado Pago | Capacidad `digital_payment` declara opción informativa con confirmación presencial | No equivale a checkout o integración de pagos. Renombrar UI para describir el comportamiento real; integración online queda fuera de esta primera ejecución. |
| Dividir cuenta | `config.service.ts`: `COMING_SOON`, efectivo false; `order.service.ts` bloquea operaciones split | Hoy no funciona aunque esté guardado true. Implementación pendiente, no una simple activación. |
| Upsell | API y servicio existen; capacidad dice `UPSELL_CLIENT_CONSUMED`; no se encontraron referencias consumidoras en `apps/client-web/app.js` | Mensaje de disponibilidad sobrepromete. El usuario ya retiró las sugerencias: sacar su exposición del producto seleccionado y no reintroducirlas automáticamente. |
| Variantes/adicionales | Carta Fauno contiene elecciones y adicionales; no se verificó un contrato completo de modificadores | Separar elegir una variante necesaria de mostrar ofertas opcionales. Evitar inventar selección o precio final. |
| Propinas/reseñas | Cliente calcula propina y la envía con BILL; hay registro de cobro y feedback | Trazar solicitud → cobro → cierre para impedir doble suma. Auditar reseña privada, enlace Google y condiciones de aparición. |
| Rewards | `rewards.service.ts`, `rewards.routes.ts`, `RewardsManager.tsx`, `CashManager.tsx` | Hay identidad por teléfono y local, ledger y canje asistido. No se encontró portal/autogestión del cliente en la carta. No venderlo como perfil del cliente terminado. |
| IA/sommelier | `ai.service.ts`: catálogo disponible de Prisma, proveedor configurable y respuesta heurística local | Botón visible no demuestra proveedor operativo. Probar origen de respuesta, catálogo, precios, restricciones y apagado por local. |
| Clave y activación IA | `ai.service.ts`: `GEMINI_API_KEY`/`GOOGLE_API_KEY`, flags `ENABLE_AI_FEATURES`/`AI_FEATURE_ENABLED`, modelos configurables | Tener clave no basta: verificar habilitación, proveedor, modelo, permisos y cuota del entorno API. No confundir respuesta heurística con Gemini operativo. |

Estado público observado: `paymentMode=DIGITAL_MP`, split=true pero no disponible, cobro libre por mozo=false, ordering=true, revisión manual=true, syncSocialCart=true; upsell, tips, reviews, waitlist, preorder y rewards=true. Google Place ID vacío. Estos valores no prueban ejecución completa; además la carta Fauno bloquea pedidos por su overlay estático. No se modificaron esos valores.

### Qué hace Rewards hoy

La identidad es un registro `CustomerLoyalty` por teléfono normalizado y restaurante. No exige un perfil web con contraseña. Caja dispone de teléfono y consentimiento; al cobrar, una ruta llama a `accrueForPayment`. La fórmula actual es `floor((importe / 100) * puntosPorCienPesos)`: con la configuración observada, un consumo elegible de $10.000 equivale a 100 puntos. El staff consulta saldo y registra canjes. Esto describe código, no una acreditación probada en producción.

Hay campos de consentimiento y verificación, pero su presencia no demuestra verificación de titularidad. Hay que comprobar que Atención y Caja acrediten igual, que se use consumo sin propina, que las devoluciones reviertan puntos y que un fallo posterior al cobro se recupere sin duplicados. Hoy el cobro puede quedar confirmado y devolver `rewardsWarning` si falla la acreditación.

Propuesta: Rewards asistido y opcional primero. Cliente sin registro obligatorio, información clara del saldo y canje validado por personal. La consulta autónoma requiere identidad verificable y recuperación; no exponer saldos simplemente conociendo un teléfono. Mantener la autogestión fuera de la primera versión hasta decidir si aporta valor al local.

## Decisiones propuestas de producto

1. Núcleo: mesa/visita, carta, llamado, pedidos si el local los usa, cocina, cuenta y cobro presencial.
2. Tres recorridos explícitos de pedidos: carta y mozo; comanda revisada por mozo; comanda directa a cocina con excepciones. Carrito compartido/individual es otra decisión, no otro nombre para el destino de la comanda.
3. “Sin PIN” significa sin PIN adicional de encargado para un mozo identificado y autorizado; nunca personal anónimo cobrando.
4. Cobro digital informativo debe llamarse preferencia de medio de pago. No prometer cobro online sin integración real.
5. Quitar del producto seleccionado ofertas/upsell que el usuario descartó. Mantener variantes obligatorias cuando un producto las necesita; decidir adicionales opcionales por local.
6. Propina voluntaria, valor cero disponible, reseña independiente. Usar textos simples, sin llamarlo inteligente si sólo calcula porcentajes.
7. Fila virtual optativa para locales que realmente tengan espera; prepedido apagado hasta validar catálogo y transición a mesa. No forzarlo como dependencia de la carta.
8. Sommelier opcional, acotado a la carta vigente y con salida a un mozo; asistente administrativo separado, con propuestas revisables antes de guardar precios o productos.
9. Rewards asistido primero; no agregar un sistema de cuentas de clientes como requisito de usar MesaYA.
10. Cada local hereda una versión identificada de la base, con datos, marca y servicios propios. Las actualizaciones se integran deliberadamente, no se despliegan automáticamente a todos los locales.

Son decisiones de diseño para la ejecución siguiente, no cambios aplicados en esta auditoría. Si una necesidad del local contradice una propuesta, documentar el cambio antes de implementar esa etapa.

## Ejecución por etapas

Cada etapa debe dejar alcance, archivos, pruebas pertinentes, revisión independiente, resultado y siguiente paso. Estados: PENDIENTE, EN_CURSO, VERIFICADO_LOCAL, VERIFICADO_STAGING, PUBLICADO_VERIFICADO o BLOQUEADO con causa concreta. Ninguna etapa está implementada por este documento.

### E00 — Fijar base, despliegues y matriz de módulos

- Crear worktree limpio desde `origin/main` actualizado; registrar SHA. Leer instrucciones vigentes. Preservar checkouts sucios y servicios activos.
- Identificar proyecto Vercel, alias, SHA/config de cliente, staff, admin y API; comprobar esquema/migraciones de la instancia Supabase sin imprimir secretos. Inventariar presencia y alcance de variables IA sin leer sus valores en la salida.
- Inventariar cada control del Admin: persistencia, dependencia, endpoint, efecto en cliente/staff y prueba existente. Resolver exactamente “cliente inteligente”. El problema de API key se desarrolla en E10.
- Preparar entorno de prueba aislado con fixture Fauno. No usar cobros de producción como pruebas automáticas.
- Aceptación: ninguna capacidad marcada lista únicamente por un booleano; ficha con origen y comportamiento por módulo. URLs verificadas del entorno de pruebas.

### E01 — Una carta real para todo el sistema

- Conciliar JSON Fauno con catálogo operativo: 26 categorías y 144 entradas de partida, distinguiendo productos vendibles, adicionales y próximos/no disponibles.
- Diseñar importación con IDs estables, simulación, idempotencia y respaldo. Preservar referencias y precios históricos de pedidos; no borrar catálogo antiguo por fuerza.
- Hacer que carta, staff, cocina, prepedido y sommelier consulten la misma fuente. Retirar el override Fauno del flujo normal sólo después de verificar la sustitución.
- Corregir textos heredados de “agregar al carrito” en consulta, imágenes/descripciones de relleno y recomendaciones no verificadas.
- Aceptación: mismo producto, disponibilidad y precio en las apps; repetir importación no duplica; pedidos anteriores siguen legibles; reversión documentada.

### E02 — Panel de módulos coherente

- Corregir estados encendido/apagado/no disponible, dependencias y mensajes del Admin. Revisar lógica de `handleToggle`/`capabilityBlocked`: no confundir apagado con no implementado.
- Expresar políticas de pedidos y cobros con términos que un encargado entienda. Ocultar opciones retiradas del producto; no destruir historial ni esquemas prematuramente.
- Backend valida políticas además del frontend. Definir cuándo surte efecto una modificación durante una visita y propagar cambios por el transporte real, no un eventBus sin consumidores.
- Aceptación: guardar, recargar y abrir otro dispositivo conservan el comportamiento; no hay toggle que aparente habilitar una función bloqueada; el cliente no contradice al Admin.

### E03 — Carrito, comandas y cocina

- Completar los tres recorridos de pedidos propuestos y su transición hasta cocina/entrega. Retirar órdenes digitales del cliente cuando esté en modo carta.
- Resolver `syncSocialCart`: mantener compartido como comportamiento base. Si se conserva la opción individual, definir borrador por comensal con cuenta final de mesa, sin filtraciones ni duplicados. Si no se necesita, retirar la opción; no simular individual apagando polling.
- Mantener excepciones de cantidad/stock visibles; cubrir aprobación, rechazo y corrección por mozo. Validar variantes necesarias sin reactivar publicidad de adicionales.
- Aceptación: dos teléfonos en la misma mesa y dos mesas distintas; concurrencia, reintento, stock/precio cambiado, sesión cerrada y revisión manual. Una sola comanda por envío confirmado y cuenta consistente.

### E04 — Cobro presencial, efectivo y PIN

- Unificar Atención y Caja en reglas y resultado: saldo, consumo, propina, método, operador y comprobación de cierre.
- Matriz mínima: mozo con permiso cobra efectivo sin PIN de encargado; sin permiso necesita autorización; tarjeta/QR no heredan permiso de efectivo; encargado conserva sus facultades.
- Probar PIN inválido, autorización caducada, restaurante ajeno, doble clic, dos operadores y cambio de usuario en tablet compartida. Nunca almacenar PIN de encargado en el cliente.
- Aceptación: backend rechaza acción no autorizada; repetir envío no cobra dos veces; mesa no se libera con deuda; auditoría identifica operador y autorización.

### E05 — División de cuenta con cobros parciales

- Primera entrega: partes iguales o importe definido por pagador, con saldo pendiente y registro de cada pago presencial. Definir redondeo en unidades monetarias mínimas, propina por pagador y pagos mixtos.
- Segunda entrega: por ítems/cantidades sólo cuando la primera esté verificada; contemplar unidades compartidas, anulaciones y pagos ya registrados. No atar identidad de pagador a una cuenta web obligatoria.
- Resolver operaciones hoy bloqueadas, contratos y UI conjuntamente. No habilitar simplemente `allowSplitBill`.
- Aceptación: tres pagadores, redondeo, pago repetido, pago simultáneo, rechazo por exceso y saldo cero exacto; cierre único. Devoluciones/correcciones quedan auditadas.

### E06 — Propinas y reseñas

- Trazar propina solicitada, confirmada y cobrada; evitar sumarla en BILL y volver a sumarla en Caja. Definir base del porcentaje y mantenerla separada del consumo y Rewards.
- Separar valoración interna de enlace externo; revisar aparición al cierre, duplicación y persistencia. Sin Place ID válido no prometer reseña Google.
- No condicionar el acceso al enlace público a una valoración positiva; las reseñas no son requisito para pagar o dejar cero propina.
- Aceptación: cero, porcentaje y monto fijo; cambio antes de cobro, split, recarga, módulo apagado, reseña duplicada, Google no configurado. Totales conciliados con lo mostrado al cliente.

### E07 — Fila virtual y prepedido

- Revisar ingreso, posición/estado, cancelación, aviso, asignación a mesa y vencimiento. Explicar “Fila Virtual Inteligente” según su función real.
- Prepedido sólo con catálogo operativo validado; al sentar al grupo revalidar precio/stock/variantes y transferir una sola vez. Definir qué ocurre al apagar pedidos o prepedido con tickets abiertos.
- Aceptación: dos dispositivos ven su ticket correcto; asignación repetida no duplica; ticket cancelado no genera comanda; módulo apagado no expone acciones falsas.

### E08 — Sommelier y asistente IA

- Inventariar interfaces reales: sommelier de cliente y generación/asistencia administrativa; comprobar proveedor/modelos vigentes en documentación oficial durante implementación, configuración y límites por instancia.
- Recomendar sólo IDs y precios de la carta operativa; abstenerse sobre alergias no verificadas. Mostrar de forma coherente si se responde con reglas locales o proveedor, sin prometer capacidades ausentes.
- Probar latencia, proveedor caído, timeout, cuota y límite de gasto. La operación principal debe seguir usable si falla IA. Propuestas administrativas requieren revisión antes de mutar catálogo.
- Aceptación: ejemplos de cerveza, plato compartible, presupuesto, producto agotado, alergia, consulta fuera de tema y proveedor sin clave. Ninguna recomendación de la carta anterior. Registrar valor aportado para decidir si se entrega activado en Fauno.

### E09 — Rewards simple y trazable

- Completar el circuito asistido: alta con consentimiento explícito, teléfono, saldo, reglas, acreditación por consumo efectivamente pagado, canje y reversión. Explicar al cliente cómo consulta sus puntos al personal.
- Verificar ambas rutas de cobro; evitar acreditación por propinas, canjes, importes anulados o repetidos. Con split, atribuir sólo el consumo elegible de cada pagador; no dar toda la mesa a varias personas.
- Diseñar recuperación idempotente de `rewardsWarning`; permisos de ajustes/manuales y trazabilidad. Verificar que la API no sustituya consentimiento real por un default.
- Perfil autónomo: propuesta separada con identificación verificable, recuperación y mínima información personal; no es condición para cerrar Rewards asistido.
- Aceptación: mismo teléfono con formatos distintos, otro local, falta de consentimiento, saldo insuficiente, canje simultáneo, devolución, fallo tras cobro y reintento. Histórico explica exactamente cada cambio de saldo.

### E10 — API key, proveedor y diagnóstico del sommelier

- Ejecutar el diagnóstico temprano, desde E00, y completar antes del cierre de E08. La IA generativa externa requiere credencial válida; la respuesta por reglas locales debe funcionar sin ella. Explicar esta diferencia en Admin.
- Verificar variables del proyecto **API** y entorno correcto: `ENABLE_AI_FEATURES` o `AI_FEATURE_ENABLED`, `GEMINI_API_KEY` o `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_TIMEOUT_MS`. La key nunca debe ir en variables `VITE_*`, código cliente, logs o repositorio.
- El código actual usa defaults `gemini-1.5-flash`/`gemini-1.5-pro` pese a un comentario que promete configuración explícita. Consultar disponibilidad oficial del proveedor durante implementación y configurar modelos soportados; no atribuir automáticamente el fallo a la clave ni adivinar modelos nuevos.
- Distinguir clave ausente/inválida, permiso/API/proyecto incorrecto, modelo no disponible, límite de cuota y timeout mediante categorías de diagnóstico sin mostrar credenciales ni cuerpos de error sensibles. Hoy varios fallos terminan en `AI_PROVIDER_FAILED` y fallback local, lo que dificulta saber qué falló.
- Si hace falta una clave nueva, dar instrucciones exactas para configurarla en el almacén de secretos del API y desplegar el entorno correspondiente. No pedir que el usuario pegue la key en conversación. Verificar que las credenciales de OpenCode son independientes de las del producto.
- Aceptación: prueba controlada con clave válida devuelve `poweredBy=gemini` y productos correctos; sin clave, flag apagado, modelo inválido y proveedor caído producen comportamiento definido y diagnóstico útil. Guardar evidencia sin secretos; no declarar la causa confirmada antes de estas pruebas.

### E11 — Base reutilizable e instalación por local

- Separar núcleo operativo de marca/contenido/políticas por instalación, con cambios de código cuando el diseño del local lo requiera. Reutilizar manifiestos y provisión existentes; evitar una plataforma SaaS nueva.
- Inventario para clonar: versión base, repositorio/branch, assets, catálogo inicial, módulos, Supabase, cuatro apps/dominios, CORS y destino QR/NFC. Secretos exclusivamente del negocio correspondiente.
- Migrar el selector de templates hacia personalización por instancia sin romper los valores ya persistidos. No hacer una eliminación masiva de templates antes de identificar consumidores.
- Aceptación: instancia de prueba derivada sin marca, datos, credenciales ni URLs Fauno por accidente; actualización del núcleo con diff revisable; rollback por instancia.

### E12 — Cierre integrado y entrega

- Ensayo completo: acceso mesa → carta → comanda → cocina → entrega → cuenta → cobro/split → propina → puntos → cierre → nueva visita.
- Repetir variantes esenciales con módulos apagados, dos dispositivos, roles diferentes y recuperación de red. Revisar Admin, Staff y cliente en tamaños de uso real.
- Publicación por cambios acotados: respaldo/migración compatible si corresponde, checks, revisión, PR, merge, despliegue de los proyectos correctos y verificación del SHA/alias efectivo.
- Aceptación: links concretos y pasos de prueba de cliente, staff y admin; cada pendiente con impacto y evidencia. Tests locales verdes no reemplazan prueba de Supabase, despliegue ni NFC físico.

## Dependencias y prioridad

E00 → E01 → E02 → E03 → E04 → E05. E06 parte de E04 y termina su compatibilidad después de E05. E07 y E08 dependen de E01/E02. E09 depende de cobros/propinas y debe probar atribución después de split. E10 se diagnostica desde E00 en paralelo sin editar archivos de otro ejecutor y debe cerrarse antes de E08. E11 se prepara desde E00 y se cierra después de estabilizar módulos. E12 integra las etapas entregadas.

Primera tanda recomendada: E00–E04. Segunda: E05–E07. Tercera: E08–E11 y E12. No intentar completar todas las capacidades con una única modificación grande.

## Workflow y verificación

- Codex: inspección, arquitectura, fichas, revisión y síntesis. OpenCode: ejecución acotada cuando su proveedor esté operativo. Antigravity: revisión/ejecución por ficha con puente real o handoff de archivo. Un solo escritor por worktree.
- Disponibilidad observada: OpenCode está en el entorno; su intento de revisión anterior falló por falta de API key del proveedor. No se comprobó autenticación nueva en esta auditoría. `antigravity`/`agy` no se resolvieron como comandos; esto no demuestra que la aplicación no esté instalada. Registrar intento y resultado al comenzar la ejecución; no atribuir trabajo a un agente sin salida verificable.
- Jev puede aportar un juicio acotado sobre evidencia, pero no reemplaza tests/revisión ni autoriza merges. No repetir preguntas para conseguir un valor aprobatorio. Ante incertidumbre, resolver con evidencia nueva y revisión.
- El repositorio usa Vitest y `node --test`, no Jest. Mantener estos runners para este plan; “Jest” se interpreta como pedido de pruebas, sin introducir una migración innecesaria.
- Reutilizar pruebas de caja, permisos de mozo, concurrencia de carrito, validación de órdenes, Rewards y aislamiento. Agregar casos de comportamiento faltantes, no tests que sólo busquen cadenas del código.
- Comandos de referencia, a confirmar por etapa: `npm run check:routes`, `npm run check:supabase-schema`, `npm run fauno:catalog:test`, `npm run instance:test`, `npm run test:local`, `npm run build`, y pruebas PostgreSQL para cambios contables/de datos. En Windows, `test:isolated` sólo bajo el supervisor Job Object real y con cierre de procesos verificado; consultar las instrucciones aplicables antes de ejecutarlo.
- No correr pruebas destructivas contra producción. Registrar resultados nuevos por SHA; no heredar un PASS de otro checkout. E2E funcional en instancia de prueba incluye llamados y cobros sintéticos y limpieza de sus propios datos.
- Entrega por etapa: problema y cambio, archivos/commit, pruebas, revisión, límites restantes, link comprobado y 2–4 pasos concretos si necesita prueba humana. Un archivo de handoff no equivale a revisión completada.

## Prompt para la conversación de ejecución

> Leé completo `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas/docs/PLAN-MODULOS-Y-BASE-POR-LOCAL-2026-09-20.md`. Ejecutá por etapas empezando por E00 y la primera tanda E00–E04, conservando el objetivo integral. Fijá base y despliegues actuales; el checkout principal está sucio y atrasado. Usá worktree limpio y el workflow OpenCode → Antigravity → revisión Codex, verificando disponibilidad real y registrando cualquier fallback. Mantené Vitest/node:test. Para cada módulo verificá Admin → API → datos → cliente/staff, incluidos apagado y concurrencia. La personalización será por local sobre el código base, sin nuevo sistema SaaS ni selector comercial de templates. No declares completo lo que sólo tiene un interruptor. Diagnosticar E10 (API key del sommelier) desde el principio sin exponer secretos. Entregá cada tanda con evidencia, links y pasos claros. Antes de cambios externos comprobá la autorización vigente de esta nueva conversación; el plan por sí solo no autoriza modificar producción.

## Información que sólo puede aportar el usuario

- Si el diagnóstico confirma que falta una credencial operativa, configurarla mediante el almacén de secretos indicado en E10. No hace falta enviar una APK: el usuario aclaró que se refería a una API key.
- Confirmar si “cliente inteligente” era Fila Virtual Inteligente o una pantalla distinta. No se exige para empezar E00–E04.
- No se requieren credenciales pegadas en el chat ni un perfil de cliente nuevo para iniciar este trabajo.
