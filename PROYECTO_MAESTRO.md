# MesaYA / RTMS (Real-Time Table Management System) — Dossier Maestro de Proyecto

> **Documento Canónico de Especificación Estratégica, Funcional, Técnica y de Arquitectura**  
> **Sistema SaaS de Comunicación Mesa→Staff en Tiempo Real (NFC + QR) y Gestión Inteligente de Salón**  
> **Ámbito de Operación Principal:** Mar del Plata y Costa Atlántica, Argentina  
> **Versión del Documento:** 2.0 (RTMS Complete Architecture & Modular Commerce)  
> **Owner del Proyecto:** Rodrigo (Independent Software Architect & Developer)  

> **Estado de piloto — 2026-09-05.** Este dossier conserva visión y propuestas históricas; no es una lista de capacidades liberadas. Para operar el piloto prevalecen `docs/implementacion/CONTROL.md`, el código y `docs/RUNBOOK_PILOTO.md`: pagos digitales/split, rewards y pre-order están apagados; `/stream` SSE está cerrado y los paneles usan polling HTTP autenticado. Ninguna referencia posterior a Mercado Pago, SSE, IA o recompensas autoriza su uso sin una etapa y aprobación específicas.

---

## 📑 Tabla de Contenidos

1. [Resumen Ejecutivo & Declaración de Identidad](#1-resumen-ejecutivo--declaración-de-identidad)
2. [Misión, Visión & Propuesta de Valor](#2-misión-visión--propuesta-de-valor)
3. [El Problema: Anatomía de la Fricción en Salón Gastronómico](#3-el-problema-anatomía-de-la-fricción-en-salón-gastronómico)
4. [La Solución: Ecosistema Funcional MesaYA](#4-la-solución-ecosistema-funcional-mesaya)
5. [Estructura de Módulos Operativos](#5-estructura-de-módulos-operativos)
   - 5.1. Front comensal Food-First (<100KB, BYOD)
   - 5.2. Panel de Mozo & Salón (PWA + Web Audio Chime)
   - 5.3. Admin Dashboard & Monitor de Turnos
   - 5.4. Carrito Colaborativo (Social Cart) & Comandas
   - 5.5. Split Bill Inteligente & Checkout Mercado Pago
   - 5.6. Smart Tipping & Funnel Ético de Google Reviews
   - 5.7. Fila Virtual (Smart Waitlist) & Pre-Order
   - 5.8. Fidelización (MesaYA Rewards)
   - 5.9. Sommelier & Asistente Culinario con IA (Gemini)
6. [Motor RTMS: Máquina de Estados Finita (FSM de 8 Estados)](#6-motor-rtms-máquina-de-estados-finita-fsm-de-8-estados)
   - 6.1. Los 8 Estados Operativos
   - 6.2. Matriz Inmutable de Transiciones
   - 6.3. Arbitraje de Señales por Prioridad
   - 6.4. Ergonomía 1-Tap para Salón
7. [Arquitectura del Sistema & Topología Monorepo](#7-arquitectura-del-sistema--topología-monorepo)
   - 7.1. Diagrama de Topología General
   - 7.2. Flujo de Datos en Tiempo Real (SSE + Fallbacks)
   - 7.3. Estructura de Paquetes y Aplicaciones
8. [Stack Tecnológico Detallado](#8-stack-tecnológico-detallado)
9. [Modelo de Datos & Persistencia (Prisma Schema Completo)](#9-modelo-de-datos--persistencia-prisma-schema-completo)
10. [Seguridad Operativa & Protocolo Anti-Llamados Fantasma](#10-seguridad-operativa--protocolo-anti-llamados-fantasma)
    - 10.1. Geofencing Just-in-Time (GPS Haversine)
    - 10.2. Invalidación Definitiva por Mozo (`410 Gone`)
    - 10.3. Tokens Rotativos Efímeros de Turno (UUID v4)
    - 10.4. Cifrado de Credenciales Financieras (AES-256-GCM)
11. [Especificaciones de Hardware para Clima Marino](#11-especificaciones-de-hardware-para-clima-marino)
    - 11.1. Tags NFC NTAG215 & Barrera de Ferrita Anti-Metal
    - 11.2. Encapsulamiento Epoxi UV & Fijación 3M 300LSE
    - 11.3. Grabado Láser Vectorial QR
12. [Infraestructura & Despliegue en Producción (Supabase + Vercel)](#12-infraestructura--despliegue-en-producción-supabase--vercel)
13. [Modelo de Negocio, Pricing & Estrategia Go-to-Market](#13-modelo-de-negocio-pricing--estrategia-go-to-market)
14. [Glosario de Términos](#14-glosario-de-términos)

---

## 1. Resumen Ejecutivo & Declaración de Identidad

**MesaYA** (en su evolución integral **RTMS — Real-Time Table Management System** o *"Mesas Vivas"*) es una plataforma de software como servicio (SaaS) diseñada para transformar la experiencia física en mesas de restaurantes, cervecerías, cafeterías de especialidad y paradores de playa.

A través de soportes físicos pasivos híbridos (**NFC NTAG215 + código QR vectorial grabado en acrílico/madera**), el comensal obtiene acceso instantáneo en su propio smartphone a una interfaz web ultra-rápida (<100KB) que le permite:
- Solicitar la cuenta con el medio de pago ya definido (Efectivo, Mercado Pago, Tarjeta) para que el mozo acuda en un solo viaje.
- Llamar al mozo o pedir insumos específicos (hielo, vajilla, condimentos, servilletas).
- Explorar la carta gastronómica viva en alta definición.
- Realizar pedidos colaborativos en tiempo real con sus acompañantes de mesa.
- Dividir la cuenta de forma automática (en partes iguales o por platos consumidos).
- Dejar propina calculada y calificar el servicio.

Para el restaurante, MesaYA **no reemplaza su software de punto de venta (POS) existente** (como Fudo, MaxiSistemas, BistroSoft o Toast), sino que actúa como una **capa de interacción viva mesa→staff en tiempo real**. A través de un motor de máquina de estados finita (FSM) de 8 estados, una PWA para mozos con alertas sonoras por Web Audio API y un dashboard interactivo de salón con mapa 2D (Floor Plan), el establecimiento optimiza la rotación de mesas (*turn-time*), elimina viajes vacíos del personal y obtiene métricas precisas de tiempos de servicio.

---

## 2. Misión, Visión & Propuesta de Valor

### 🎯 Misión
Erradicar las fricciones analógicas del salón gastronómico —comensales levantando la mano en salones saturados, mozos haciendo dobles viajes innecesarios y demoras en el cobro de la cuenta— mediante tecnología web pasiva sin fricción, acelerando los tiempos de atención y maximizando la facturación por mesa en entornos de alta demanda.

### 🔭 Visión
Convertirse en la infraestructura digital líder de gestión de salón y servicio a la mesa en la Costa Atlántica y polos gastronómicos de Argentina y la región, reconocida por su resiliencia técnica en condiciones extremas de conectividad, ergonomía visual de primera línea y convivencia armónica con los sistemas de gestión ya instalados.

### 💎 Propuesta de Valor

| Para el Comensal | Para el Mozo / Staff | Para el Encargado / Dueño |
|---|---|---|
| **Cero Espera Invisible**: Solicita atención, cuenta o insumos con 1 tap sin buscar la mirada del mozo. | **Fin del Doble Viaje**: Sabe de antemano si la mesa quiere efectivo, Mercado Pago o tarjeta, yendo directo con el posnet o la adición. | **Mayor Rotación de Mesas**: Reduce el *turn-time* en 8 a 15 minutos por mesa, permitiendo sentar más comensales en turnos pico. |
| **Cero Descargas**: Sin apps invasivas de App Store / Google Play; funciona en cualquier navegador moderno. | **Ergonomía & Semáforo**: Pantalla con semáforo de tiempos (🔴 >3m, 🟡 <3m, 🟢 en camino) y filtro por sector propio. | **Cero Hardware Propietario**: No requiere comprar tablets dedicadas por mesa ni tótems importados caros. |
| **Split Bill Transparente**: Cada comensal puede pagar su parte sin cálculos manuales ni calculadora. | **Menos Fatiga Física**: Menor kilometraje recorrido por turno al eliminar viajes informativos vacíos. | **Protección Anti-Llamados Fantasma**: Geofencing e invalidación inmediata al levantarse el cliente. |
| **Maridajes con IA**: Sommelier digital interactivo que recomienda platos y bebidas según sus gustos. | **Mayores Propinas**: Clientes atendidos con rapidez y checkout claro dejan estadísticamente entre 20% y 35% más propina. | **Analítica en Tiempo Real**: Métricas de tiempos de espera, ocupación por zona y captación de reseñas en Google Maps. |

---

## 3. El Problema: Anatomía de la Fricción en Salón Gastronómico

El modelo de atención tradicional en salones gastronómicos padece de ineficiencias estructurales acentuadas en destinos turísticos de temporada (como Mar del Plata, Cariló o Pinamar):

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             EL CICLO TRADICIONAL DEL DOBLE VIAJE                                 │
│                                                                                                  │
│  [Comensal levanta la mano] ──(espera 5-10m)──► [Mozo camina a la mesa: "¿Qué precisaba?"]     │
│                                                           │                                      │
│                                                           ▼                                      │
│  [Mozo regresa con el posnet o adición] ◄──(3-5m)── [Comensal: "La cuenta, pago con tarjeta"]   │
│                                                                                                  │
│  TOTAL TIEMPO MUERTO: 10 a 18 minutos por mesa solo para gestionar el cobro final               │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **El "Doble Viaje" del Mozo**: Para cobrar una mesa, el mozo realiza al menos 2 viajes completos: viaje 1 para averiguar el medio de pago ("¿efectivo o tarjeta?"), viaje 2 para llevar la cuenta con el posnet o el vuelto. Si el local tiene vereda, terraza o dos plantas, esto multiplica el desgaste físico y colapsa la atención.
2. **La "Ceguera de Salón"**: En horas pico con salones ruidosos y terrazas, el comensal se siente ignorado. El comensal que espera la adición ocupa una mesa que ya podría estar disponible para el siguiente grupo de comensales en fila.
3. **El Vandalismo de los QR Estáticos Tradicionales**: Los locales que pegan un QR con una URL fija sufren "llamados fantasma" o "burlas": clientes sacan foto al QR y llaman mozos desde su casa o el auto días después.
4. **La Congestión de Conectividad en Verano**: Las redes celulares 4G/5G en balnearios y zonas costeras colapsan en enero y febrero. Las aplicaciones de menús pesadas (>5MB) quedan en blanco y los comensales no logran abrirlas.
5. **La Salinidad y Destrucción del Hardware en la Costa**: Los soportes impresos en papel o con tinta común se desgastan en semanas por la brisa marina, el alcohol al 70% y los rayos UV.

---

## 4. La Solución: Ecosistema Funcional MesaYA

MesaYA resuelve estos problemas mediante un enfoque **holístico, ultra-ligero y centrado en la velocidad operativa**:

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │                            SOPORTE FÍSICO HÍBRIDO                                │
 │          Acrílico cristal / madera grabado láser + NFC NTAG215                   │
 └─────────────────────────┬──────────────────────────────────┬─────────────────────┘
                           │ Tap NFC (<0.5s)                  │ Escaneo QR (<1s)
                           ▼                                  ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │                           WEB COMENSAL (BYOD)                                    │
 │  - <100 KB payload total (HTML5 + Tailwind + Vanilla JS)                         │
 │  - Zero descargas, carga instantánea incluso en 3G costero saturado              │
 │  - Botonera Contextual: Cuenta (MP/Efectivo/Tarjeta), Mozo, Insumos              │
 │  - Carta viva, Carrito Colaborativo, Split Bill, Reseñas Google, Sommelier IA    │
 └─────────────────────────┬────────────────────────────────────────────────────────┘
                           │ REST API / HTTPS
                           ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │                         BACKEND FASTIFY + PRISMA                                 │
 │  - Fastify 4.x + TypeScript + SSE Broadcaster                                    │
 │  - Motor FSM de 8 Estados + Geofencing GPS + Rate Limiting Anti-Spam             │
 │  - Base de Datos Supabase (PostgreSQL) / SQLite local                            │
 └───────────────────┬───────────────────────────────────────┬──────────────────────┘
                     │ Server-Sent Events (SSE)              │ Server-Sent Events
                     ▼                                       ▼
 ┌───────────────────────────────────────┐ ┌────────────────────────────────────────┐
 │       PANEL DE MOZO (PWA)             │ │      ADMIN DASHBOARD (REACT 18)        │
 │ - React 18 + Vite PWA instalable      │ │ - Floor Plan 2D Interactivo (Canvas)   │
 │ - Alerta sonora Web Audio API Chime   │ │ - Editor de Salón, Mesas y Sectores    │
 │ - Semáforo por tiempo de espera       │ │ - Apertura/Cierre de Turnos (Tokens)   │
 │ - Acción 1-Tap de cambio de estado    │ │ - Kitchen Orders, Waitlist & Métricas  │
 └───────────────────────────────────────┘ └────────────────────────────────────────┘
```

---

## 5. Estructura de Módulos Operativos

### 5.1. Front Comensal Food-First (`apps/client-web`)
- **Arquitectura Zero-Build / Ultra-Ligera**: Construido en HTML5 semántico, Tailwind CSS y JavaScript modular vainilla puro sin frameworks pesados, garantizando un peso total inferior a 100 KB.
- **Acceso Inmediato sin Login**: El comensal ingresa vía `https://mesaya.app/mesa/:id?token=:uuid`. No se solicitan usuarios, contraseñas ni correos para pedir atención.
- **Botonera Contextual con 1 Tap**:
  - **Pedir Cuenta**: Despliega selector de medio de pago inmediato (**Efectivo**, **Mercado Pago**, **Tarjeta de Crédito/Débito**).
  - **Llamar Mozo**: Solicitud de presencia general en la mesa.
  - **Insumos Rápidos**: Botones para Hielo, Vajilla, Condimentos, Servilletas o Panera.
  - **"Ya fui atendido"**: Botón que permite al comensal auto-cancelar la alerta si el mozo pasó antes de que mirara el panel.
- **Feedback Háptico & Visual**: Vibración nativa en dispositivos compatibles (`navigator.vibrate`), cambio de estados de botón y temporizador regresivo de enfriamiento (cooldown de 3 minutos para prevenir spam).
- **Fallback Automático a WhatsApp**: Si el comensal experimenta micro-cortes de internet y la API falla en 2 intentos consecutivos, la interfaz ofrece un botón directo de WhatsApp con mensaje pre-armado (indicando local, mesa y motivo exacto) etiquetado con `origin: WHATSAPP_FALLBACK`.

### 5.2. Panel de Mozo & Salón (`apps/staff-panel`)
- **PWA React 18 + Vite**: Aplicación web progresiva instalable en cualquier smartphone Android o iOS utilizado por el personal de salón o en tablets compartidas.
- **Alertas Sonoras Sin Bloqueo de Autoplay**: Emplea el **Web Audio API Chime Synthesizer**. Al autenticarse el mozo mediante su PIN numérico, el contexto de audio se desbloquea de inmediato y los avisos sonoros de nuevos llamados suenan con nitidez y fuerza.
- **Semáforo Visual de Urgencia**:
  - 🟢 **En Camino / < 1 minuto**: Llamado atendido por un compañero o recién recibido.
  - 🟡 **Atención Requerida (1 a 3 minutos)**: Mesa en espera normal.
  - 🔴 **Crítico (> 3 minutos)**: Alerta pulsante para evitar mesas insatisfechas.
- **Filtro Ergonómico por Sector**: Permite al mozo ver únicamente sus mesas asignadas (ej. "Terraza", "Vereda", "Salón Principal") o la vista global de salón.
- **Acción de Retiro de Mesa**: Botón exclusivo para mozos: *"Mesa se retiró (Cerrar sesión e invalidar QR)"*, que revoca el token en el servidor de forma inmediata.

### 5.3. Admin Dashboard & Monitor de Turnos (`apps/admin-dashboard`)
- **Gestión de Salón y Mesas**: Alta, baja, edición de etiquetas, capacidad, sector y asignación de zonas.
- **Apertura y Cierre de Turnos (Shift Management)**:
  - Al presionar *"Abrir Turno"*, el sistema genera nuevos tokens UUID v4 para todas las mesas del restaurante con expiración automática (TTL) de 3 horas.
  - Al presionar *"Cerrar Turno"*, todas las sesiones abiertas quedan invalidadas en base de datos (`closedAt = NOW()`), evitando accesos fuera de horario.
- **Exportación de Credenciales & Códigos QR**: Descarga de códigos vectoriales listos para imprenta o grabado.
- **Métricas de Rendimiento & Analítica RTMS**: Tiempos promedios de respuesta de mozos, volumen de llamados por hora pico, distribución de métodos de pago y rotación de salón.

### 5.4. Carrito Colaborativo (Social Cart) & Comandas
- **Sincronización en Tiempo Real entre Comensales**: Todos los comensales sentados en la misma mesa visualizan los platos que agregan los demás en el carrito compartido.
- **Modo de Validación por Mozo**: El encargado puede activar `requireWaiterValidation = true` para que los pedidos enviados desde el celular requieran confirmación del mozo en su panel antes de pasar al estado de cocina.

### 5.5. Split Bill Inteligente & Checkout Mercado Pago
- **Modalidades de División de Cuenta**:
  - **Partes Iguales**: Divide el total entre $N$ personas. Cada una puede pagar su porción mediante link de pago o pasarela.
  - **Por Ítem Consumido**: Cada comensal selecciona qué platos o bebidas consumió. Cuenta con **bloqueo optimista** (`claimVersion`) para impedir que dos personas paguen el mismo ítem al mismo tiempo.
- **Integración Transparente con Mercado Pago**: Permite cobrar a través de credenciales OAuth de cada restaurante, aplicando comisiones de plataforma (*application fees*) configurables.

### 5.6. Smart Tipping & Funnel Ético de Google Reviews
- **Propinas Sugeridas**: Opciones de cálculo rápido con un solo tap (10%, 15%, 20% o monto personalizado).
- **Funnel Ético de Reputación**:
  - Si el comensal califica el servicio con **5 estrellas**, el sistema lo invita a replicar su reseña en **Google Maps** (`googlePlaceId`).
  - Si la calificación es de **1 a 3 estrellas**, la aplicación abre un formulario de feedback interno directo para el encargado, canalizando las quejas de forma constructiva antes de que dañen el perfil público del local.

### 5.7. Fila Virtual (Smart Waitlist) & Pre-Order
- Registro ágil de clientes en espera mediante nombre, número de personas y WhatsApp.
- Visualización de tiempo estimado de espera en minutos.
- **Pre-Order de Menú**: Los clientes que esperan en la vereda pueden ir pre-seleccionando su comida desde el celular. Al liberarse su mesa, el pedido ya está pre-cargado.

### 5.8. Fidelización (MesaYA Rewards)
- Acumulación automática de puntos por consumo verificado contra el número de teléfono del cliente.
- Catálogo de recompensas canjeables (postres de cortesía, tragos 2x1, descuentos en próximas visitas).

### 5.9. Sommelier & Asistente Culinario con IA (Gemini)
- Motor integrado con la API de **Google Gemini** (con fallback gastronómico heurístico) para:
  - Generación automática de cartas gourmet a partir de un simple prompt temático del local.
  - Recomendación de maridajes de vinos y platos para los comensales sentados en la mesa.
  - Asesoramiento de alérgenos y opciones para celíacos o veganos en lenguaje natural.

---

## 6. Motor RTMS: Máquina de Estados Finita (FSM de 8 Estados)

El corazón de la gestión de salón de MesaYA es un **motor determinístico de 8 estados** que refleja el ciclo de vida real de una mesa gastronómica sin necesidad de sensores costosos:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 [S0] AVAILABLE (Verde)                 │
                  └───────────────┬────────────────────────┬───────────────┘
                                  │                        │
                     Reserva      │                        │ Ocupación directa
                     anticipada   ▼                        ▼ (NFC/QR o Mozo Tap)
                  ┌───────────────────┐    Llegada     ┌───────────────────┐
                  │   [S1] RESERVED   ├───────────────►│ [S2] OCCUPIED     │
                  │      (Azul)       │    comensal    │   _NO_ORDER       │
                  └───────────────────┘                │   (Amarillo)      │
                                                       └─────────┬─────────┘
                                                                 │
                                                       Comanda   │
                                                       enviada   ▼
                                                       ┌───────────────────┐
                                                       │ [S3] ORDER        │
                                                       │   _IN_KITCHEN     │
                                                       │    (Naranja)      │
                                                       └─────────┬─────────┘
                                                                 │
                                                       Platos    │
                                                       servidos  ▼
                                                       ┌───────────────────┐
                                      Segunda ronda    │   [S4] EATING     │
                                   ┌───────────────────┤      (Rojo)       │
                                   │                   └─────────┬─────────┘
                                   │                             │
                                   │                  Pide       │
                                   │                  cuenta     ▼
                                   │                   ┌───────────────────┐
                                   │                   │ [S5] BILL         │
                                   │                   │   _REQUESTED      │
                                   │                   │   (Púrpura)       │
                                   │                   └─────────┬─────────┘
                                   │                             │
                                   ▼                             │ Cobro
                                [Cocina]                         │ registrado
                                                                 ▼
                                                       ┌───────────────────┐
                                                       │    [S6] PAID      │
                                                       │     (Gris)        │
                                                       └─────────┬─────────┘
                                                                 │
                                                       Comensal  │
                                                       se retira ▼
                                                       ┌───────────────────┐
                                                       │  [S7] TO_CLEAN    │
                                                       │  (Ámbar/Marrón)   │
                                                       └─────────┬─────────┘
                                                                 │
                                                       Mesa limpia (1 Tap)
                                                                 │
                                                                 ▼
                                                       [S0] AVAILABLE ↺
```

### 6.1. Los 8 Estados Operativos

| Estado | Nombre Técnico | Color Hex | Significado Operativo |
|---|---|---|---|
| **S0** | `AVAILABLE` | `#22c55e` (Verde) | Mesa limpia, desinfectada y lista para recibir nuevos comensales. |
| **S1** | `RESERVED` | `#3b82f6` (Azul) | Mesa bloqueada temporalmente para una reserva confirmada. |
| **S2** | `OCCUPIED_NO_ORDER` | `#eab308` (Amarillo) | Comensales sentados mirando la carta; aún no han ordenado comida. |
| **S3** | `ORDER_IN_KITCHEN` | `#f97316` (Naranja) | Comanda enviada a la cocina / barra; mesa esperando sus platos. |
| **S4** | `EATING` | `#ef4444` (Rojo) | Platos servidos; comensales comiendo o disfrutando su sobremesa. |
| **S5** | `BILL_REQUESTED` | `#a855f7` (Púrpura) | Cuenta solicitada con medio de pago especificado; mozo en camino. |
| **S6** | `PAID` | `#6b7280` (Gris) | Cuenta cobrada; comensales finalizando la sobremesa antes de salir. |
| **S7** | `TO_CLEAN` | `#92400e` (Marrón) | Mesa desocupada pendiente de fajinado, desinfección y armado. |

### 6.2. Matriz Inmutable de Transiciones (`TRANSITION_MATRIX`)

Para garantizar la integridad y coherencia de las métricas de salón, el sistema valida que las transiciones sigan un curso lógico, prohibiendo saltos incoherentes salvo excepciones autorizadas:

```typescript
export const TRANSITION_MATRIX: Record<TableFSMState, readonly TableFSMState[]> = Object.freeze({
  [TableFSMState.AVAILABLE]: Object.freeze([
    TableFSMState.RESERVED,
    TableFSMState.OCCUPIED_NO_ORDER
  ]),
  [TableFSMState.RESERVED]: Object.freeze([
    TableFSMState.OCCUPIED_NO_ORDER,
    TableFSMState.AVAILABLE
  ]),
  [TableFSMState.OCCUPIED_NO_ORDER]: Object.freeze([
    TableFSMState.ORDER_IN_KITCHEN,
    TableFSMState.EATING,
    TableFSMState.BILL_REQUESTED,
    TableFSMState.TO_CLEAN,
    TableFSMState.AVAILABLE
  ]),
  [TableFSMState.ORDER_IN_KITCHEN]: Object.freeze([
    TableFSMState.EATING,
    TableFSMState.BILL_REQUESTED,
    TableFSMState.TO_CLEAN,
    TableFSMState.AVAILABLE
  ]),
  [TableFSMState.EATING]: Object.freeze([
    TableFSMState.ORDER_IN_KITCHEN, // Segundas rondas o postres
    TableFSMState.BILL_REQUESTED,
    TableFSMState.PAID,
    TableFSMState.TO_CLEAN
  ]),
  [TableFSMState.BILL_REQUESTED]: Object.freeze([
    TableFSMState.PAID,
    TableFSMState.TO_CLEAN,
    TableFSMState.EATING // Retoma consumo
  ]),
  [TableFSMState.PAID]: Object.freeze([
    TableFSMState.TO_CLEAN,
    TableFSMState.AVAILABLE
  ]),
  [TableFSMState.TO_CLEAN]: Object.freeze([
    TableFSMState.AVAILABLE,
    TableFSMState.OCCUPIED_NO_ORDER // Sentada inmediata en hora pico
  ])
});
```

### 6.3. Arbitraje de Señales por Prioridad

En un restaurante, múltiples fuentes pueden emitir señales sobre una misma mesa. Para evitar condiciones de carrera (*race conditions*) y discrepancias, MesaYA implementa una escala estricta de arbitraje:

```
Prioridad 10: SYSTEM_TIMEOUT     (Timeouts automáticos por inactividad)
Prioridad 20: CUSTOMER_QR        (Escaneo pasivo de QR por comensal)
Prioridad 25: CUSTOMER_NFC       (Tap pasivo de NFC por comensal)
Prioridad 30: CUSTOMER_APP       (Acciones explícitas en web comensal)
Prioridad 40: CASHIER_CHECKOUT   (Cierre de ticket en caja)
Prioridad 50: STAFF_TERMINAL_TAP (Toque directo de mozo en tablet)
Prioridad 100: MANAGER_OVERRIDE  (Sobreescritura forzada por el encargado)
```

Una señal de menor prioridad no puede sobreescribir una transición reciente gatillada por una señal de mayor jerarquía.

### 6.4. Ergonomía 1-Tap para Salón

El personal de salón no tiene tiempo para navegar formularios complejos. La función `getNextState(current)` calcula automáticamente el estado lógico siguiente:
- Si la mesa está `AVAILABLE`, 1 tap la pasa a `OCCUPIED_NO_ORDER`.
- Si está `OCCUPIED_NO_ORDER`, 1 tap la pasa a `ORDER_IN_KITCHEN`.
- Si está `ORDER_IN_KITCHEN`, 1 tap la pasa a `EATING`.
- Si está `EATING`, 1 tap la pasa a `TO_CLEAN` o `BILL_REQUESTED`.
- Si está `TO_CLEAN`, 1 tap la regresa a `AVAILABLE` (mesa lista).

El tiempo de interacción del staff es inferior a **1 segundo**.

---

## 7. Arquitectura del Sistema & Topología Monorepo

### 7.1. Diagrama de Topología General

```
                                  INTERNET / WAN
                                        │
                      ┌─────────────────┴─────────────────┐
                      │                                   │
              Dispositivos Comensal              Dispositivos Staff
             (4G/5G / Wi-Fi Clientes)           (Wi-Fi Salón / 4G Mozo)
                      │                                   │
                      ▼                                   ▼
          ┌──────────────────────┐            ┌──────────────────────┐
          │   apps/client-web    │            │   apps/staff-panel   │
          │ (Vercel Edge / CDN)  │            │ (Vercel Edge / CDN)  │
          └───────────┬──────────┘            └───────────┬──────────┘
                      │                                   │
                      │ HTTPS (REST)                      │ HTTPS (REST + SSE)
                      ▼                                   ▼
          ┌──────────────────────────────────────────────────────────┐
          │             API GATEWAY / VERCEL SERVERLESS              │
          │                   api/index.ts (Fastify)                 │
          └─────────────────────────────┬────────────────────────────┘
                                        │
                                        ▼
          ┌──────────────────────────────────────────────────────────┐
          │                 BACKEND SERVICE LAYER                    │
          │                 (packages/api/src)                       │
          │  - FSM Service           - Session Service               │
          │  - Call Service          - Order & Split Bill Service    │
          │  - FloorPlan Service     - Waitlist & Rewards Service    │
          │  - SSE Broadcaster       - Gemini AI Service             │
          └─────────────────────────────┬────────────────────────────┘
                                        │
                                        ▼
          ┌──────────────────────────────────────────────────────────┐
          │                 DATABASE PERSISTENCE                     │
          │              Supabase PostgreSQL (Prod)                  │
          │             SQLite / Prisma Client (Dev)                 │
          └──────────────────────────────────────────────────────────┘
```

### 7.2. Flujo de Datos en Tiempo Real (SSE + Fallbacks)

Para distribuir eventos en tiempo real hacia las aplicaciones de staff y administración, MesaYA utiliza **Server-Sent Events (SSE)** nativos sobre HTTP:

1. **Eficiencia & Simplicidad**: A diferencia de WebSockets (que requieren sockets bidireccionales permanentes de alto consumo en memoria y fallan ante proxies restrictivos), SSE opera sobre HTTP regular unidireccional (servidor → cliente), con auto-reconexión nativa gestionada por el navegador.
2. **Heartbeat & Reconexión**: El canal `/v1/stream?restaurantId=:id` emite un latido (*heartbeat*) cada 15 segundos para mantener abierta la conexión a través de balanceadores.
3. **Resiliencia Dual en Serverless**: Debido a que plataformas serverless (como Vercel) pueden reciclar conexiones de streaming, el panel de staff cuenta con un **polling de respaldo sincronizado cada 3 segundos** que verifica el estado general de llamados si el stream sufre una micro-interrupción.

### 7.3. Estructura de Paquetes y Aplicaciones

El monorepo está estructurado con **npm workspaces**:

```
mdpmesasvivas/
├── api/                           # Adaptador Serverless para Vercel Functions
│   └── index.ts                   # Entrypoint serverless de Fastify
├── apps/
│   ├── client-web/                # Web móvil comensal Food-First (<100KB, Vanilla JS)
│   ├── staff-panel/               # Panel PWA de mozo/salón (React 18 + Vite)
│   └── admin-dashboard/           # Dashboard del dueño/encargado (React 18 + Vite)
├── packages/
│   ├── api/                       # Core Backend Fastify + Prisma + Servicios
│   │   ├── prisma/                # Schema Prisma & Seeds
│   │   └── src/                   # Rutas, Servicios, Middlewares y Libs
│   └── shared/                    # Tipos TypeScript, Enums, DTOs y FSM Matrix
├── hardware/
│   ├── qr-generator/              # Generador automatizado de QR vectoriales SVG
│   └── nfc-programming/           # Especificación de tags NTAG215 y scripts
├── docs/                          # Documentación de despliegue y arquitectura
├── package.json                   # Raíz del workspace
└── vercel.json                    # Enrutamiento global de monorepo en Vercel
```

---

## 8. Stack Tecnológico Detallado

| Capa | Tecnología Seleccionada | Justificación Técnica |
|---|---|---|
| **Lenguaje Base** | **TypeScript 5.x** | Tipado estricto extremo en todo el monorepo, previniendo errores en tiempo de compilación entre backend, frontends y modelos compartidos. |
| **Runtime Backend** | **Node.js 18 / 20 LTS** | Entorno estable, con soporte nativo para ES Modules, Fetch API y alto rendimiento asíncrono. |
| **Framework HTTP Backend** | **Fastify 4.x** | Framework hasta 2x más rápido que Express, baja sobrecarga de memoria, validación rápida de esquemas y arquitectura modular de plugins. |
| **ORM & Capa de Acceso a Datos** | **Prisma ORM 5.x** | Modelado declarativo, migraciones versionadas y tipado seguro autogenerado (`PrismaClient`). |
| **Base de Datos (Producción)** | **Supabase (PostgreSQL 15+)** | Soporte para transacciones ACID, pooler de conexiones (PgBouncer en puerto 6543) optimizado para funciones serverless y alta disponibilidad. |
| **Base de Datos (Desarrollo)** | **SQLite (`dev.db`)** | Cero configuración inicial para desarrollo local y ejecución instantánea de pruebas unitarias. |
| **Frontend Comensal** | **HTML5 + Tailwind CDN + Vanilla JS** | Tamaño de descarga inferior a 100 KB, sin hidratación pesada de React; renderizado instantáneo en smartphones modestos con redes 3G costeras. |
| **Frontend Staff & Admin** | **React 18 + Vite** | Compilaciones instantáneas, arquitectura de componentes modular, soporte PWA y fluidez reactiva. |
| **Gestor de Estado Front** | **Zustand** | Gestión de estado minimalista y reactiva sin boilerplate de Redux. |
| **Sonido de Notificaciones** | **Web Audio API** | Sintetizador de tonos armónicos (*chime*) en código puro, inmune a fallas de descarga de archivos `.mp3` o políticas de bloqueo de autoplay. |
| **Motor de IA** | **Google Gemini SDK / REST API** | Generación de cartas gastronómicas temáticas estructuradas en JSON y sommelier virtual inteligente. |
| **Tooling de Monorepo** | **npm workspaces + Concurrently** | Orquestación unificada de dependencias y scripts de desarrollo simultáneos en una sola terminal. |
| **Despliegue & Hosting** | **Vercel** | Infraestructura serverless global con despliegue automático desde GitHub y baja latencia edge. |

---

## 9. Modelo de Datos & Persistencia (Prisma Schema Completo)

El modelo de datos relacional soporta tanto la operación de llamados básica como el sistema RTMS avanzado de 8 estados, comandas, split bill y módulos de fidelización:

```prisma
// ==========================================
// 1. RESTAURANTE Y CONFIGURACIÓN MODULAR
// ==========================================
model Restaurant {
  id            String         @id @default(uuid())
  name          String
  slug          String         @unique
  planTier      String         @default("LEAN") // LEAN | SALON_TABLET | FULL_SMARTBAND
  timezone      String         @default("America/Argentina/Buenos_Aires")
  whatsappPhone String?
  pdfMenuUrl    String?
  logoUrl       String?
  coverImageUrl String?
  themeColor    String         @default("#f59e0b")
  templateId    String         @default("GOURMET_OBSIDIAN")
  customFont    String         @default("plus-jakarta")
  latitude      Float?         // Coordenadas para geofencing
  longitude     Float?
  radiusMeters  Int            @default(200) // Radio máximo de llamado
  createdAt     DateTime       @default(now())

  tables            Table[]
  staffUsers        StaffUser[]
  shifts            Shift[]
  subscription      Subscription?
  categories        MenuCategory[]
  moduleConfig      RestaurantModuleConfig?
  paymentCreds      RestaurantPaymentCredentials?
  waitlist          WaitlistEntry[]
  loyaltyUsers      CustomerLoyalty[]
  rewardItems       RewardItem[]
  floorZones        FloorZone[]
  floorLayouts      FloorPlanLayout[]
  occupancySessions OccupancySession[]
}

model RestaurantModuleConfig {
  id                      String      @id @default(cuid())
  restaurantId            String      @unique
  restaurant              Restaurant  @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  
  paymentMode             String      @default("WAITER_ONLY") // WAITER_ONLY | DIGITAL_MP | HYBRID
  allowSplitBill          Boolean     @default(false)
  allowOrdering           Boolean     @default(true)
  syncSocialCart          Boolean     @default(true)
  requireWaiterValidation Boolean     @default(true)
  enableUpsell            Boolean     @default(true)
  enableSmartTips         Boolean     @default(true)
  suggestedTipPercentages String      @default("[10, 15, 20]")
  enableReviews           Boolean     @default(true)
  googlePlaceId           String?
  enableWaitlist          Boolean     @default(false)
  enableWaitlistPreOrder  Boolean     @default(false)
  enableRewards           Boolean     @default(false)
  pointsPerHundredPesos   Int         @default(1)
  updatedAt               DateTime    @updatedAt
}

model RestaurantPaymentCredentials {
  id                        String      @id @default(cuid())
  restaurantId              String      @unique
  restaurant                Restaurant  @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  mpCollectorId             String
  mpPublicKey               String?
  mpAccessTokenEncrypted    String      // AES-256-GCM
  mpRefreshTokenEncrypted   String      // AES-256-GCM
  mpTokenExpiresAt          DateTime
  createdAt                 DateTime    @default(now())
  updatedAt                 DateTime    @updatedAt
}

// ==========================================
// 2. MESAS & SESIONES DE SALÓN
// ==========================================
model Table {
  id                String            @id @default(uuid())
  restaurantId      String
  restaurant        Restaurant        @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  label             String            // e.g. "Mesa 12", "Terraza 3"
  sector            String            @default("SALON_PRINCIPAL")
  isOutdoor         Boolean           @default(false)
  mergedWithTableId String?

  // RTMS 2D Layout Coordinates
  posX              Float             @default(0)
  posY              Float             @default(0)
  width             Float             @default(80)
  height            Float             @default(80)
  rotation          Float             @default(0)
  shape             String            @default("RECT") // RECT | ROUND | SQUARE | BOOTH
  capacity          Int               @default(4)
  floorZoneId       String?
  floorZone         FloorZone?        @relation(fields: [floorZoneId], references: [id], onDelete: SetNull)

  // RTMS Estado FSM
  currentState      String            @default("AVAILABLE")
  stateChangedAt    DateTime          @default(now())

  sessions          TableSession[]
  stateEvents       TableStateEvent[]
  occupancySessions OccupancySession[]

  @@unique([restaurantId, label])
}

model TableSession {
  id            String        @id @default(uuid())
  tableId       String
  table         Table         @relation(fields: [tableId], references: [id], onDelete: Cascade)
  token         String        @unique // UUID v4 rotativo
  shiftId       String?
  shift         Shift?        @relation(fields: [shiftId], references: [id], onDelete: SetNull)
  expiresAt     DateTime      // TTL 3 horas
  closedAt      DateTime?
  createdAt     DateTime      @default(now())

  calls         CallRequest[]
  feedback      Feedback?
  orders        Order[]
}

model Shift {
  id            String         @id @default(uuid())
  restaurantId  String
  restaurant    Restaurant     @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  openedAt      DateTime       @default(now())
  closedAt      DateTime?

  sessions      TableSession[]
}

// ==========================================
// 3. LLAMADOS, COMANDAS & TRANSACCIONES
// ==========================================
model CallRequest {
  id              String        @id @default(uuid())
  tableSessionId  String
  tableSession    TableSession  @relation(fields: [tableSessionId], references: [id], onDelete: Cascade)
  type            String        // BILL | WAITER | SUPPLIES | CUSTOM
  paymentMethod   String        @default("NOT_APPLICABLE")
  note            String?
  origin          String        @default("WEB_DIRECT")
  status          String        @default("PENDING") // PENDING | IN_PROGRESS | RESOLVED | CANCELLED
  createdAt       DateTime      @default(now())
  acknowledgedAt  DateTime?
  resolvedAt      DateTime?
}

model Order {
  id             String                @id @default(cuid())
  tableSessionId String
  tableSession   TableSession          @relation(fields: [tableSessionId], references: [id], onDelete: Cascade)
  status         String                @default("DRAFT") // DRAFT | CONFIRMED | IN_KITCHEN | SERVED | CANCELLED
  totalAmount    Float                 @default(0.0)
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  items          OrderItem[]
  payments       PaymentTransaction[]
  splitSessions  SplitBillSession[]
}

model OrderItem {
  id             String     @id @default(cuid())
  orderId        String
  order          Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  menuItemId     String
  menuItem       MenuItem   @relation(fields: [menuItemId], references: [id])
  quantity       Int        @default(1)
  unitPrice      Float
  notes          String?
  addedByGuest   String
  claimedByGuest String?    // Split bill locking
  claimVersion   Int        @default(0)
  isPaid         Boolean    @default(false)
  createdAt      DateTime   @default(now())
}

model SplitBillSession {
  id              String     @id @default(cuid())
  orderId         String
  order           Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  mode            String     // BY_ITEM | EQUAL_PARTS
  totalParts      Int        @default(1)
  paidParts       Int        @default(0)
  partAmount      Float?
  totalAmount     Float
  remainingAmount Float
  status          String     @default("OPEN")
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}

model PaymentTransaction {
  id             String    @id @default(cuid())
  orderId        String
  order          Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  tableSessionId String
  guestSessionId String
  splitSessionId String?
  method         String    // WAITER_CASH | WAITER_CARD | DIGITAL_MP_FULL | DIGITAL_MP_SPLIT
  amount         Float
  tipAmount      Float     @default(0.0)
  applicationFee Float?
  mpPaymentId    String?
  status         String    @default("PENDING")
  idempotencyKey String    @unique
  createdAt      DateTime  @default(now())
  resolvedAt     DateTime?
}

// ==========================================
// 4. RTMS ANALYTICS & EVENTOS DE SALÓN
// ==========================================
model TableStateEvent {
  id          String    @id @default(cuid())
  tableId     String
  table       Table     @relation(fields: [tableId], references: [id], onDelete: Cascade)
  fromState   String
  toState     String
  trigger     String
  source      String
  staffUserId String?
  metadata    String?
  createdAt   DateTime  @default(now())

  @@index([tableId, createdAt])
}

model OccupancySession {
  id                   String      @id @default(cuid())
  tableId              String
  table                Table       @relation(fields: [tableId], references: [id], onDelete: Cascade)
  restaurantId         String
  restaurant           Restaurant  @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  shiftId              String?
  partySize            Int?
  seatedAt             DateTime    @default(now())
  orderedAt            DateTime?
  servedAt             DateTime?
  billAt               DateTime?
  paidAt               DateTime?
  vacatedAt            DateTime?
  cleanedAt            DateTime?
  totalRevenue         Float?

  durationMinutes      Int?
  timeToOrderMinutes   Int?
  timeToServeMinutes   Int?
  dwellAfterPayMinutes Int?
  turnTimeMinutes      Int?

  @@index([restaurantId, seatedAt])
}
```

---

## 10. Seguridad Operativa & Protocolo Anti-Llamados Fantasma

Uno de los mayores fracasos de los sistemas de QR convencionales es la vulnerabilidad a manipulaciones o llamados falsos. MesaYA implementa una arquitectura de seguridad en capas:

### 10.1. Geofencing Just-in-Time (GPS Haversine)
- Al pulsar *"Llamar al mozo"* o *"Pedir la cuenta"*, el navegador solicita brevemente las coordenadas del dispositivo (`navigator.geolocation`).
- El backend ejecuta la fórmula del semiverseno (**Haversine**) comparando las coordenadas del cliente contra la ubicación registrada del restaurante (`latitude`, `longitude`):
  $$d = 2r \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)$$
- Si la distancia calculada excede el radio configurado (ej. 200 metros), la solicitud es rechazada con un código `403 Forbidden` informando: *"Debes encontrarte físicamente en el local para solicitar atención"*.

### 10.2. Invalidación Definitiva por Mozo (`410 Gone`)
- En el momento en que una mesa abona y se levanta, el mozo toca en su panel: `"Mesa se retiró (Cerrar sesión e invalidar QR)"`.
- En el servidor, la sesión se marca con `closedAt = NOW()`.
- Cualquier intento posterior de escanear o acceder a ese enlace devuelve de forma inmediata un estado HTTP `410 Gone`, destruyendo la capacidad de interactuar con la mesa hasta que se inicie un nuevo turno o ciclo.

### 10.3. Tokens Rotativos Efímeros de Turno (UUID v4)
- Las URLs impresas en las mesas no son estáticas universales, sino parametrizadas con tokens UUID v4 criptográficos generados por turno.
- Tienen un tiempo de vida máximo (TTL) de 3 horas por inactividad.
- Al cerrar el turno de mediodía o de noche, todas las sesiones activas del local mueren en cascada.

### 10.4. Cifrado de Credenciales Financieras (AES-256-GCM)
- Los tokens de acceso y actualización de Mercado Pago de cada restaurante nunca se guardan en texto plano.
- Se almacenan cifrados mediante el algoritmo simétrico autenticado **AES-256-GCM**, guardando vector de inicialización (IV), tag de autenticación y texto cifrado de manera aislada (`iv:tag:ciphertext`).

---

## 11. Especificaciones de Hardware para Clima Marino

Para resistir el ambiente corrosivo de Mar del Plata y la Costa Atlántica (alta salinidad marina, viento con arena, exposición solar directa y limpieza intensiva con alcohol y lavandina), MesaYA define estándares específicos de manufactura física:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CORTE TRANSVERSAL DEL SOPORTE FÍSICO                 │
│                                                                        │
│   [ Capa 1 ] Acrílico Cristal 4mm con Grabado Láser Reverso            │
│              (La tinta no se borra porque el láser quema el material)  │
│   ──────────────────────────────────────────────────────────────────   │
│   [ Capa 2 ] Encapsulado de Resina Epoxi Bicomponente UV-Resistant     │
│              (Protege el chip del agua, alcohol y la salitre marina)   │
│   ──────────────────────────────────────────────────────────────────   │
│   [ Capa 3 ] Chip NFC NTAG215 (Memoria 504 bytes, universal iOS/Andr.) │
│   ──────────────────────────────────────────────────────────────────   │
│   [ Capa 4 ] Lámina de Ferrita Anti-Metal Aislante (0.2 - 0.5 mm)      │
│              (Obligatoria: mesadas de acero inoxidable o hierro)       │
│   ──────────────────────────────────────────────────────────────────   │
│   [ Capa 5 ] Adhesivo Estructural 3M 300LSE de Alta Resistencia Quím.  │
│              (Soporta lavandina, grasa y lavado diario de mozos)       │
└────────────────────────────────────────────────────────────────────────┘
```

### 11.1. Tags NFC NTAG215 & Barrera de Ferrita Anti-Metal
- **Chip Estándar**: NTAG215 (protocolo ISO 14443-A), compatible de fábrica con iPhone (desde iPhone XS en adelante) y Android sin requerir apps lectoras.
- **Aislamiento de Ferrita**: Las mesas de acero inoxidable (comunes en cocinas y barras) o con estructura de hierro absorben el campo electromagnético del NFC e impiden la lectura. Se exige el uso de tags que incorporen lámina de ferrita (*on-metal tags*).

### 11.2. Encapsulamiento Epoxi UV & Fijación 3M 300LSE
- **Resina Epoxi UV**: Evita el amarilleo por exposición al sol en terrazas al aire libre y sella herméticamente los micro-circuitos contra la humedad del mar.
- **Adhesivo 3M 300LSE**: Adhesivo acrílico de alta resistencia que se adhiere tenazmente sobre madera laqueada, fórmica, vidrio o metal, resistiendo el roce continuo de platos y la limpieza con desinfectantes agresivos.

### 11.3. Grabado Láser Vectorial QR
- El paquete `hardware/qr-generator` genera archivos SVG de alta resolución con códigos QR de corrección de errores nivel H (30% de redundancia), preparados para máquinas de grabado láser CO2 o fibra sobre acrílico bicapa (oro/negro, plata/negro, blanco/negro). Al grabarse físicamente, el código jamás se decolora ni se despega.

---

## 12. Infraestructura & Despliegue en Producción (Supabase + Vercel)

El sistema está concebido con una arquitectura **Zero-Fixed-Server Cost** para la etapa inicial:

1. **Base de Datos en Supabase (PostgreSQL)**:
   - Configuración mediante dos URLs:
     - **Transaction Pooler (Puerto 6543 con PgBouncer)**: `DATABASE_URL` utilizada por las funciones serverless en Vercel para evitar el agotamiento de conexiones.
     - **Direct Connection (Puerto 5432)**: `DIRECT_URL` utilizada exclusivamente por Prisma para correr migraciones de base de datos (`prisma migrate`).
2. **Backend Serverless en Vercel**:
   - Fastify se ejecuta mediante el adaptador serverless en `api/index.ts`, enrutado globalmente mediante `vercel.json` para servir endpoints REST bajo `/v1/*` y `/health`.
3. **Frontends Distribuidos**:
   - `client-web`, `staff-panel` y `admin-dashboard` se compilan como aplicaciones estáticas optimizadas distribuidas en la red de borde (Edge CDN) de Vercel con tiempos de respuesta inferiores a 50ms.

---

## 13. Modelo de Negocio, Pricing & Estrategia Go-to-Market

### 💵 Estructura de Planes SaaS

| Nivel de Plan | Nombre Comercial | Funcionalidades Incluidas | Tarifa Estándar (ARS / mes) | Tarifa Temporada Alta (ARS / mes) |
|---|---|---|---|---|
| **Tier 1** | **MesaYA Lean** | - Llamados a mozo & cuenta con medio de pago.<br>- Carta digital estática.<br>- Web comensal ultra-rápida.<br>- Panel de mozo con audio chime. | $25.000 / mes | $45.000 / mes |
| **Tier 2** | **MesaYA Salon Tablet (RTMS)** | - Todo lo de Lean.<br>- Motor FSM de 8 Estados en tiempo real.<br>- Floor Plan 2D interactivo con zonas.<br>- Comandas & Carrito Colaborativo.<br>- Métricas de rotación de mesas (*turn-time*). | $49.000 / mes | $85.000 / mes |
| **Tier 3** | **MesaYA Full Smart Enterprise** | - Todo lo de Salon Tablet.<br>- Split Bill con Mercado Pago.<br>- Fila virtual con pre-order.<br>- Programa de recompensas.<br>- Soporte de hardware físico grabado láser incluido. | $89.000 / mes | $145.000 / mes |

### 🚀 Estrategia Go-to-Market (Costa Atlántica)
1. **Piloto Ancla**: Implementación en 2 restaurantes insignia de Mar del Plata (e.g. zona Güemes / Olavarría y Puerto) para generar casos de éxito medibles en reducción de *turn-time*.
2. **Temporada de Verano**: Ofrecimiento de instalación "Llave en Mano" (hardware grabado + configuración de salón en 24 horas) para capturar la demanda pico de diciembre a marzo.
3. **Convivencia Amigable con POS**: Presentar la solución a los dueños no como un competidor de su sistema actual, sino como el complemento de comunicación que su sistema actual no tiene.

---

## 14. Glosario de Términos

- **BYOD (Bring Your Own Device)**: Paradigma donde el cliente interactúa utilizando su propio teléfono inteligente personal.
- **FSM (Finite State Machine)**: Modelo computacional de estados finitos que regula el ciclo de vida de una mesa para evitar estados incoherentes.
- **NFC (Near Field Communication)**: Tecnología inalámbrica de corto alcance que permite abrir la web de la mesa al acercar el teléfono a menos de 4 centímetros.
- **RTMS (Real-Time Table Management System)**: Sistema de gestión y analítica de ocupación de salón en tiempo real.
- **SSE (Server-Sent Events)**: Estándar web que permite a un servidor enviar actualizaciones reactivas unidireccionales al cliente a través de una conexión HTTP abierta.
- **Turn-Time**: Tiempo total transcurrido desde que un grupo de comensales se sienta en una mesa hasta que la abandona y queda limpia para el siguiente turno.
