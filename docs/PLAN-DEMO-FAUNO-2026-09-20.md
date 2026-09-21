# Fauno Olavarría — investigación y plan de demo a medida

Fecha: 2026-09-20. Estado: PLAN; no se implementó ni publicó una instancia Fauno.

## 1. Objetivo y modelo comercial

Crear una demo de MesaYA que se sienta propia de Fauno: carta real, identidad visual del local y un recorrido convincente de atención. Cada negocio recibe software a medida derivado de una base común, con código versionado, Supabase, despliegues, configuración y datos independientes. No se propone una plataforma SaaS compartida.

Para Fauno se recomienda un repositorio privado propio derivado del release base, con historial y referencia al commit padre. La base se mantiene como producto reutilizable; las actualizaciones se incorporan de forma deliberada y probada por local. Un cambio en MesaYA no debe desplegar automáticamente sobre todos los negocios.

Alcance inmediato: plan e investigación. Implementación posterior: demo aislada primero, instalación operativa después. Los pendientes de backup/hardening de la instalación anterior siguen abiertos; no se heredan como certificados para Fauno.

## 2. Fuentes y hallazgos

Fuentes consultadas:

- Material entregado por el usuario: `C:/Users/rodri/.codex/attachments/072cb387-5cdd-4365-89e6-fac17eecef00/Texto pegado.txt`. Fuente principal del contenido solicitado; conservar su versión original durante la importación.
- Carta pública: https://queresto.com/faunoolavarria — consultada el 20/09/2026. La extracción web puede diferir del contenido interactivo o estar desactualizada.
- Instagram oficial aportado: https://www.instagram.com/faunobar_/ — acceso directo fallido; no se verificaron feed, logo, tipografías ni colores actuales.
- Referencia histórica: https://www.infoviajera.com/2022/11/visitamos-fauno-mitologia-cervecera-en-mar-del-plata-argentina/ — visita de 2022, útil para contexto del local; no prueba su ambientación actual ni autoriza reutilizar las fotos.
- Referencia secundaria de publicaciones: https://www.restaurants10.com/AR/Mar-del-Plata/334696650551143/Fauno-Olavarria — sirve para detectar campañas temporales; confirmar en fuente oficial antes de publicar promociones.

Identidad comercial corroborada entre el adjunto y la carta: Fauno Olavarría, Olavarría 3232, Mar del Plata; cerveza artesanal propia, comida abundante para compartir y coctelería. La comunicación del adjunto es informal, humorística y orientada a grupos. Esa voz debe guiar la carta y los destacados.

El adjunto contiene 145 líneas de precio y tres promociones. No equivale todavía a 145 productos importables: incluye adicionales, productos próximos, opciones y precios «desde». El conteo definitivo se obtiene al normalizar el catálogo.

### Diferencias detectadas

| Fuente del usuario | Extracción de la carta pública | Tratamiento |
|---|---|---|
| Pizza Sin Tacc, Hamburguesa Veggie, Beefeater Pink y Bombay presentes | No aparecen en la extracción consultada | Conservar del adjunto y marcar disponibilidad por confirmar |
| Sin categoría Postres | Aparecen Postres, helado y brownie | Registrar como candidatos; no incorporarlos silenciosamente |
| No aparecen algunas bebidas | Aparecen Mojito Fauno, Baileys Frozen, Raspberry Frozen y Frozzen de Frutos Rojos | Conciliar antes del catálogo definitivo |
| Chernobyl IPA y Barley Wine dicen «Próximamente» | También se presentan como próximos | Mostrar sin posibilidad de pedido hasta confirmar |

No reemplazar automáticamente el material recibido con el scrape. Conservar nombre, descripción y precio de origen, fuente, fecha, categoría y motivo de cada corrección. Las campañas de fechas pasadas no se convierten en promociones vigentes.

## 3. Dirección visual propuesta

Concepto propuesto: «cervecería nocturna, comida para compartir y barra protagonista». Es una propuesta de diseño, no una afirmación de que estos sean los colores oficiales.

- Base carbón cálida, texto marfil y acentos ámbar/cobre; ajustar al logo y fotos oficiales cuando se verifiquen.
- Títulos con carácter y cuerpo de alta legibilidad; precios fáciles de comparar y controles grandes para teléfono.
- Portada corta con marca y una fotografía real del local o sus productos. Evitar que una portada ocupe toda la primera pantalla y oculte la carta.
- Protagonismo de cerveza propia, platos compartibles y tragos. Destacados iniciales propuestos: Papas Fauno, Super Fauno, Milanesa Fauno y Mar Del Tabla.
- Fichas con foto cuando exista una imagen autorizada; sin foto, composición tipográfica cuidada. No presentar fotos genéricas o generadas como platos reales de Fauno.
- Personalización consistente de carta, acceso de staff y admin; las pantallas operativas priorizan contraste, velocidad y claridad.

La extracción de QueResto expone un logo placeholder. No sirve como logo de Fauno. Primera tarea visual: inventario de logo, fachada/interior y 6–10 fotos de productos, con procedencia y permiso de uso. Las imágenes de prensa sirven como referencias, no como assets a copiar automáticamente.

## 4. Organización de una carta extensa

Conservar las categorías del adjunto y agruparlas visualmente en accesos superiores: Comida, Cervezas, Tragos y Sin alcohol. Promos tendrá un bloque independiente. Vinos y Botellas se encontrarán dentro de bebidas, sin perder sus nombres originales.

Usar índice de categorías accesible, buscador por nombre/ingredientes declarados y navegación que conserve la posición al cerrar un plato. No mostrar las decenas de categorías como una fila interminable de chips. Verificar que filtros, detalle y carrito funcionen con toda la carta.

Las cervezas pueden mostrar estilo, volumen, alcohol e IBU cuando la fuente los declare. Los platos compartibles mostrarán porciones sólo si están documentadas. «Veggie» no implica vegano. La sección Sin Tacc conservará la aclaración del proveedor; no inventar garantías sobre contaminación cruzada.

### Normalización del catálogo

Crear un catálogo versionado de Fauno con IDs estables y un informe de importación:

- Importación idempotente, primero en modo de simulación: altas, cambios, omisiones y discrepancias visibles.
- Precios en ARS con representación monetaria coherente entre `price` y `priceMinor`; no resolver importes mediante texto libre.
- Separar promociones de productos vendibles. No dar precio cero a promociones sin precio.
- «Adicionales» de comidas, tragos y gin son entradas distintas, aunque compartan nombre.
- Tratar sabores, pollo/carne, dos salsas a elección y guarniciones como elecciones explícitas cuando se habiliten pedidos.
- No convertir un precio «desde» en un total fijo sin resolver sus variantes.
- No corregir silenciosamente recetas o datos extraños; registrar observaciones para revisión del local.

Para la primera demo de carta se pueden exhibir estas opciones como información y usar «Consultar al mozo». Antes de permitir pedidos de esos productos, sus elecciones y recargos deben quedar modelados y validados por el servidor. Esto evita ampliar el proyecto a un motor de modificadores completo sólo para mostrar la estética.

## 5. Configuración funcional recomendada

| Función | Demo inicial | Ampliación operativa |
|---|---|---|
| Carta, búsqueda, categorías, destacados, disponibilidad | Habilitada | Habilitada |
| Promociones | Informativas, sin descuentos automáticos | Reglas sólo tras confirmar condiciones |
| Llamar al mozo y pedir cuenta | Habilitada en mesa de demostración aislada | Según operación del local |
| Pedidos y validación del mozo | Recorrido controlado con productos resueltos | Catálogo y opciones completos |
| Cocina y cuenta de mesa | Datos de demostración | Flujo completo validado |
| Cobro presencial | Registro de prueba sin dinero real | Según medios elegidos por Fauno |
| Pagos online y división digital | Deshabilitados | Proyecto posterior si lo requieren |
| Fila, prepedido, fidelización, IA, upselling, reseñas y automatización WhatsApp | Deshabilitados | Activación individual con caso de uso |

El enlace comercial compartible abrirá la carta sin pedir login ni activar una mesa. Habrá otro enlace para la demostración interactiva de Mesa Demo 1. Ocultar una función en la UI no basta: su configuración efectiva, API y permisos deben coincidir.

## 6. Qué existe en la base y qué falta adaptar

Inspección realizada en `mdpmesasvivas-servicio-remediacion`, commit `8072432`; la promoción a main registrada en la conversación es `7c9b3ea`. Al iniciar la implementación, verificar nuevamente el commit base y trabajar en un checkout limpio dedicado a Fauno.

| Evidencia de código | Consecuencia para el plan |
|---|---|
| `docs/implementacion/plan-producto-base-2026-09/ARQUITECTURA-DE-INSTANCIAS.md` | Ya documenta Supabase exclusivo, cuatro proyectos Vercel, secretos propios y modo SINGLE_RESTAURANT |
| `deploy/instance.example.json`, `scripts/instance-manifest.mjs` | Reutilizar módulos, release padre y LOCAL_OVERRIDE; el manifiesto no provisiona infraestructura por sí solo |
| `scripts/provision-instance-plan.mjs` | Produce PLAN_ONLY; crear un plan no significa crear recursos |
| `packages/api/prisma/schema.prisma`, MenuCategory/MenuItem | Ya hay categorías, foto, precio, stock, destacados y etiquetas; no hay grupos estructurados de variantes en esos modelos |
| `apps/client-web/app.js`, applyTemplateTheme | La portada se elige de imágenes genéricas según cuatro plantillas; requiere extensión para una portada real por local |
| `packages/shared/src/index.ts` | Existen contratos de branding y plantillas; cualquier nuevo campo debe recorrer contratos, API, admin y cliente |

Antes de implementar: comprobar soporte efectivo de descripción/agrupación de categorías, promociones y carta pública sin sesión. Son necesidades propuestas, no capacidades certificadas por esta inspección.

## 7. Aislamiento y distribución

Instancia propuesta: `fauno-olavarria-demo`, con slug `fauno-olavarria`, moneda ARS y zona `America/Argentina/Buenos_Aires`. Estos nombres son propuestas; los dominios todavía no existen.

- Repositorio/checkout Fauno con release padre exacta y cambios específicos auditablemente separados.
- Supabase exclusivo de Fauno demo; nada de copiar clientes, cuentas, órdenes o credenciales de la referencia.
- Cuatro proyectos Vercel propios: API, carta, staff y admin, desplegados desde el mismo commit.
- Secretos, CORS, dominios, almacenamiento y restaurante raíz propios.
- Datos demo identificables y restaurables. No conectar WhatsApp real, cobros o impresoras durante la presentación.
- Si Fauno contrata, promover una instalación con datos iniciales limpios y módulos acordados; no convertir registros de prueba en ventas reales.
- Registrar release instalada, schema, procedencia del catálogo, URLs reales y procedimiento de actualización/rollback.

La carpeta principal actual contiene borradores sin commit. No es la fuente para clonar la demo; usar la revisión publicada y comprobada.

## 8. Ejecución por etapas y criterios de cierre

### F01 — Congelar fuentes y catálogo

Normalizar el adjunto, comparar con carta pública, crear lista de diferencias y catálogo preliminar. Cierre: cada entrada del adjunto tiene destino o motivo de exclusión; cero productos perdidos silenciosamente; precios y productos próximos señalados.

### F02 — Identidad y prototipo

Recuperar/verificar assets de Fauno y preparar portada, listado, detalle y promos en móvil y escritorio. Cierre: vista de 390 px legible, marca propia, fotos con procedencia, navegación de todas las categorías; entregar preview visual para revisión. Mientras falten assets, usar composición tipográfica explícitamente provisional.

### F03 — Instancia e importación local

Crear checkout Fauno desde release fijada; completar manifiesto y configuración efectiva; implementar importador idempotente y datos demo. Cierre: segunda importación sin duplicados, base de referencia intacta y un único restaurante raíz.

### F04 — Carta integrada

Conectar catálogo y branding reales, portada por instancia, agrupación/búsqueda, disponibilidad, promos informativas y modo de lectura pública. Cierre: precios correctos, estado vacío/error manejado, navegación móvil sin saltos ni controles tapados y ausencia de branding genérico.

### F05 — Demostración operativa acotada

Preparar mesa de prueba, llamado, pedido validado, cocina, cuenta y cierre. Si un producto necesita opciones aún no implementadas, permitir consulta pero impedir un pedido ambiguo. Cierre: mismo pedido y total en cliente, staff, cocina y cuenta; sesión cerrada no recibe nuevas operaciones.

### F06 — Revisión y publicación de demo

Revisión independiente de diff, importación, aislamiento y UX. Ejecutar checks de rutas/schema, pruebas enfocadas y build; regresión completa si se tocan contratos, pagos, sesiones o esquema. En Windows, suites aisladas mediante supervisor Job Object conforme al workflow existente.

Provisionar recursos propios y migraciones PostgreSQL revisadas; publicar los cuatro proyectos; verificar enlaces, login, menú, API y el flujo demo. Cierre: URLs reales comprobadas desde navegador, ningún proyecto apuntando a la base anterior, inventario y rollback documentados.

Workflow: explorar → diseñar → implementar una ficha → probar → revisión independiente → corregir → verificar. Mantener ejecutor OpenCode según disponibilidad y supervisión/revisión de Codex; registrar bloqueos del proveedor, sin fallback silencioso. JEV, si se utiliza para decisiones de alcance, recibe evidencia concreta y no sustituye tests ni revisión.

## 9. Guion y entrega al usuario

Entrega final obligatoria: enlace público de la carta, enlace de Mesa Demo 1, staff y admin, QR de demostración generado con la URL publicada, y guía breve. No inventar URLs antes del deploy.

Guion de presentación de cinco minutos:

1. Abrir carta Fauno en teléfono, recorrer cervezas y un plato para compartir.
2. Buscar un producto y ver sus detalles/precio.
3. Abrir Mesa Demo 1 y llamar al mozo; comprobar el aviso en staff.
4. Registrar un pedido controlado y verlo en cocina/cuenta.
5. Registrar cobro de prueba, cerrar mesa y mostrar cómo cambiar disponibilidad desde admin.

La prueba física se pedirá con enlaces concretos y resultados esperados. El usuario no debe descubrir qué probar ni ejecutar comandos de infraestructura para evaluar la carta.

## 10. Datos por confirmar sin bloquear el plan

- Logo y fotos oficiales actuales: obtener de fuente accesible o material facilitado por el usuario/local.
- Vigencia de precios, promociones y diferencias de catálogo: mantener adjunto como baseline de demo y registrar lo dudoso.
- Funciones de interés del dueño: partir de la configuración acotada anterior y ampliarla después de la presentación.
- Cuenta/proyecto donde alojar Fauno y dominio final: resolver al provisionar; no reutilizar implícitamente infraestructura de otro local.

No hace falta que el usuario pruebe nada para completar esta fase de investigación y planificación. No se modificaron aplicaciones, bases ni despliegues en esta fase.
