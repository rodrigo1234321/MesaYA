# MesaYA — Plan Técnico de Implementación Maestro

> **Nota de vigencia (piloto 2026-09-05):** este plan contiene decisiones y objetivos históricos. El estado operativo real es: snapshots HTTP autenticados con polling; SSE `/stream` deshabilitado; pagos digitales/split, pre-order y rewards apagados; IA sólo con habilitación explícita. Consultar `docs/RUNBOOK_PILOTO.md` antes de operar. Ningún diagrama SSE o mención de Mercado Pago posterior habilita esa función.

> Sistema de comunicación mesa→staff en tiempo real (NFC + QR) para gastronomía en Mar del Plata y la Costa Atlántica.
> Especificación técnica definitiva (build spec) para desarrollo ágil, modular y resiliente.

**Versión del documento:** 1.1 (Refinada con robustez operativa y feedback de campo)  
**Fecha:** 2026-08-28  
**Owner del producto:** Rodrigo (Independent Developer, Mar del Plata)  

---

## 1. Visión y Alcance del Producto

**Qué es:** MesaYA es un sistema SaaS ultra-rápido de comunicación en tiempo real entre el comensal sentado en una mesa y el staff del restaurante (mozos / barra / caja), activado por NFC o QR. **No es un POS, no es un menú digital interactivo, no es un sistema de comandas de cocina.** Es una capa complementaria que convive con el software existente del local (Fudo, HivePOS, MaxiSistemas, etc.).

**Tagline:** *"Tu cliente te habla sin levantar la mano. Tu mozo responde sin perder un viaje."*

**Fuera de alcance explícito:**
- No gestiona pedidos a cocina (comandas ni KDS).
- No emite facturación fiscal (ARCA/AFIP).
- No es un e-commerce gastronómico con carrito ni pasarela obligatoria de pedidos.
- La carta digital es un complemento estático de baja jerarquía visual (PDF / imagen), no una carta navegable con variantes.

**Usuarios del sistema:**
| Rol | Acción Principal | Dispositivo |
|---|---|---|
| **Comensal** | Toca NFC o escanea QR, pide cuenta con medio de pago, insumos o mozo. | Su propio celular (BYOD, <100KB payload, sin app) |
| **Mozo / Staff** | Recibe y atiende llamados filtrados por su sector asignado. | PWA en celular o tablet de salón/barra |
| **Encargado / Dueño** | Controla turnos, rota tokens de mesas, asigna sectores y ve métricas. | Dashboard Web (Desktop / Tablet) |

---

## 2. Principios de Diseño y Operación (No Negociables)

1. **NFC + QR híbrido obligatorio**: Todo soporte físico cuenta con tag NFC NTAG215 y QR de respaldo visible.
2. **Cero fricción y ultra-ligereza**: Frontend de cliente < 100KB, carga en < 1s en 3G/4G congestionado de temporada, sin login ni descarga.
3. **Ergonomía del Mozo y Anti-Fatiga**: Rate limiting de 1 llamado activo por tipo cada 3 min por mesa. Interfaz con semáforo por tiempo de espera (🔴 >3m, 🟡 <3m, 🟢 en camino) y filtro opcional por sector de trabajo.
4. **Llamados con Contexto Estricto**: Cada llamado clasifica motivo exacto (ej. Cuenta + Efectivo / Mercado Pago / Tarjeta).
5. **Carta Digital Secundaria**: Acceso visualmente secundario (ícono o enlace discreto) para no distorsionar el foco del comensal.
6. **Resiliencia Extrema y Fallback a WhatsApp**: Si el comensal no tiene enlace con el backend tras 2 intentos rápidos, la interfaz ofrece envío directo por WhatsApp con mensaje pre-armado, marcando el origen para evitar duplicados.
7. **Seguridad por Tokens Rotativos**: Cada apertura de turno o regeneración genera UUIDs v4 con TTL de 3 horas. Cierre de turno invalida todas las sesiones de inmediato (410 Gone).
8. **Hardware Apto para Costa Atlántica**: Soporte físico con tag anti-metal protegido con resina epoxi y adhesivo 3M 300LSE para resistir salitre, brisa marina y limpieza intensiva.

---

## 3. Arquitectura del Sistema

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENTE COMENSAL (BYOD)                         │
│  HTML5 + Tailwind CDN + Vanilla JS (<100KB)                            │
│  - NFC Tap / QR Scan → https://dominio/mesa/:id?token=:uuid            │
│  - Acciones: Cuenta (MP/Efvo/Tarjeta), Mozo, Insumos, "Ya fui atendido"│
│  - Fallback automático a WhatsApp si la API no responde                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (fetch REST)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      BACKEND API (@mesaya/api)                       │
│  Node.js + Fastify 4.x + TypeScript + Prisma                           │
│  - Endpoints REST: Sesiones, Llamados, Mesas, Turnos, Feedback         │
│  - Stream SSE: Broadcaster unidireccional de eventos por restaurante   │
│  - Web Push Service: Integración Web Push / FCM                        │
│  - Control anti-abuso & Rate limiter en memoria / Redis                │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
        ┌───────────────────────┐        ┌───────────────────────┐
        │  SQLite (MVP)         │        │  Pub/Sub Event Bus    │
        │  PostgreSQL (Prod)    │        │  (In-Memory / Redis)  │
        └───────────────────────┘        └───────────┬───────────┘
                                                     │ SSE Stream
                                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    PANEL STAFF PWA (@mesaya/staff-panel)             │
│  React 18 + Vite + Service Worker PWA                                  │
│  - Lista viva de llamados con semáforo por tiempo transcurrido         │
│  - Filtro por Sector (Salón Principal, Terraza, Vereda, Planta Alta)   │
│  - Alerta sonora dual: Web Audio API Chime (desbloqueo al login) +     │
│    Web Push en segundo plano                                           │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│               ADMIN DASHBOARD (@mesaya/admin-dashboard)              │
│  React 18 + Vite: Apertura/Cierre de turno, configuración de mesas y   │
│  sectores, visualización de métricas y tiempos de respuesta.           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Estructura del Monorepo

```
mdpmesasvivas/ (o mesaya/)
├── apps/
│   ├── client-web/                 # Web del comensal (HTML5/Tailwind/Vanilla JS)
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js
│   │   └── assets/
│   ├── staff-panel/                # Panel del mozo/staff (React 18 + Vite PWA)
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── CallCard.tsx
│   │   │   │   ├── CallList.tsx
│   │   │   │   ├── SectorFilter.tsx
│   │   │   │   └── ConnectionStatus.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useSSE.ts
│   │   │   │   ├── useSoundAlert.ts  # Web Audio API Synth/Chime
│   │   │   │   └── useWebPush.ts
│   │   │   └── lib/api.ts
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   └── service-worker.js
│   │   └── vite.config.ts
│   └── admin-dashboard/            # Panel administrativo de local (React 18 + Vite)
│       ├── src/
│       │   ├── pages/
│       │   │   ├── TablesManager.tsx
│       │   │   ├── ShiftsManager.tsx
│       │   │   ├── MetricsView.tsx
│       │   │   └── StaffManager.tsx
│       │   └── lib/api.ts
│       └── vite.config.ts
├── packages/
│   ├── api/                        # Backend Fastify + Prisma + SSE
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── plugins/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── middleware/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   └── shared/                     # Tipos, Enums y DTOs comunes
│       ├── src/
│       │   ├── index.ts
│       │   ├── types.ts
│       │   └── constants.ts
│       └── package.json
├── hardware/
│   ├── qr-generator/               # Generador de QR codes y plantillas de grabado
│   │   ├── generate.ts
│   │   └── package.json
│   └── nfc-programming/            # Documentación y scripts de parametrización NFC
│       └── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── HARDWARE_GUIDE.md
├── package.json
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 5. Modelo de Datos Completo (Prisma Schema)

```prisma
datasource db {
  provider = "sqlite" // cambiar a "postgresql" en producción
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum PlanTier {
  LEAN
  SALON_TABLET
  FULL_SMARTBAND
}

enum Sector {
  SALON_PRINCIPAL
  TERRAZA
  PLANTA_ALTA
  VEREDA
  BARRA
}

enum CallType {
  BILL          // pedir la cuenta
  WAITER        // consulta general al mozo
  SUPPLIES      // condimentos / vajilla / servilletas / hielo
  CUSTOM        // nota especial
}

enum CallStatus {
  PENDING
  IN_PROGRESS
  RESOLVED
  CANCELLED     // cancelado por el cliente ("Ya fui atendido") o mozo
}

enum PaymentMethod {
  CASH
  MERCADO_PAGO
  CARD
  NOT_APPLICABLE
}

enum CallOrigin {
  WEB_DIRECT
  WHATSAPP_FALLBACK
}

model Restaurant {
  id            String       @id @default(uuid())
  name          String
  slug          String       @unique
  planTier      PlanTier     @default(LEAN)
  timezone      String       @default("America/Argentina/Buenos_Aires")
  whatsappPhone String?      // Para fallback de emergencia
  pdfMenuUrl    String?      // Carta digital estática secundaria
  createdAt     DateTime     @default(now())

  tables        Table[]
  staffUsers    StaffUser[]
  shifts        Shift[]
  subscription  Subscription?
}

model Table {
  id            String       @id @default(uuid())
  restaurantId  String
  restaurant    Restaurant   @relation(fields: [restaurantId], references: [id])
  label         String       // "Mesa 12", "Terraza 3"
  sector        Sector       @default(SALON_PRINCIPAL)
  isOutdoor     Boolean      @default(false)

  sessions      TableSession[]

  @@unique([restaurantId, label])
}

model TableSession {
  id            String       @id @default(uuid())
  tableId       String
  table         Table        @relation(fields: [tableId], references: [id])
  token         String       @unique  // UUID v4 rotativo
  shiftId       String?
  shift         Shift?       @relation(fields: [shiftId], references: [id])
  expiresAt     DateTime     // createdAt + 3 horas por defecto
  closedAt      DateTime?
  createdAt     DateTime     @default(now())

  calls         CallRequest[]
  feedback      Feedback?
}

model Shift {
  id            String       @id @default(uuid())
  restaurantId  String
  restaurant    Restaurant   @relation(fields: [restaurantId], references: [id])
  openedAt      DateTime     @default(now())
  closedAt      DateTime?

  sessions      TableSession[]
}

model CallRequest {
  id              String        @id @default(uuid())
  tableSessionId  String
  tableSession    TableSession  @relation(fields: [tableSessionId], references: [id])
  type            CallType
  paymentMethod   PaymentMethod @default(NOT_APPLICABLE)
  note            String?
  origin          CallOrigin    @default(WEB_DIRECT)
  status          CallStatus    @default(PENDING)
  createdAt       DateTime      @default(now())
  acknowledgedAt  DateTime?     // Cuando el mozo marca "En camino"
  resolvedAt      DateTime?
}

model StaffUser {
  id               String      @id @default(uuid())
  restaurantId     String
  restaurant       Restaurant  @relation(fields: [restaurantId], references: [id])
  name             String
  pinHash          String
  role             String      @default("WAITER") // WAITER | MANAGER
  assignedSector   Sector?     // Sector preferido por defecto
  pushSubscription String?     // Serialized JSON de suscripción Web Push
  createdAt        DateTime    @default(now())
}

model Feedback {
  id              String        @id @default(uuid())
  tableSessionId  String        @unique
  tableSession    TableSession  @relation(fields: [tableSessionId], references: [id])
  rating          Int           // 1 a 5 estrellas
  comment         String?
  createdAt       DateTime      @default(now())
}

model Subscription {
  id               String      @id @default(uuid())
  restaurantId     String      @unique
  restaurant       Restaurant  @relation(fields: [restaurantId], references: [id])
  planTier         PlanTier
  monthlyPriceArs  Int
  isHighSeason     Boolean     @default(true)
  status           String      @default("ACTIVE")
  currentPeriodEnd DateTime
}
```

---

## 6. Contratos de API Principales

Base URL: `http://localhost:3000/v1` (o `https://api.mesaya.app/v1`)

- `GET /sessions/:token`: Devuelve estado de sesión, mesa, sector, nombre del local y carta estática. Retorna `410 Gone` si expiró o cerró turno.
- `POST /calls`: Crea un llamado. Requiere `{ sessionToken, type, paymentMethod, note, origin }`. Rate-limit: 1 llamado pendiente/en curso por mesa. Devuelve `429` si ya hay uno activo.
- `PATCH /calls/:id`: Mozo cambia estado a `IN_PROGRESS` o `RESOLVED`.
- `POST /calls/:id/cancel`: Comensal cancela su llamado ("Ya fui atendido").
- `GET /stream?restaurantId=:id`: Canal SSE que difunde eventos `call.created`, `call.updated`, `shift.closed`.
- `POST /shifts/open`: Abre nuevo turno y regenera tokens UUID de todas las mesas del local.
- `POST /shifts/:id/close`: Cierra turno e invalida todas las sesiones activas asociadas.
- `GET /metrics?restaurantId=:id`: Estadísticas de tiempo de respuesta, picos y NPS.

---

## 7. Roadmap de Ejecución por Fases (Reordenado)

### Fase 1: Monorepo Setup, Core Backend & Tooling de Hardware QR
- Inicializar monorepo pnpm workspaces + Turborepo.
- Crear `@mesaya/shared` con tipos y enums TypeScript.
- Crear `@mesaya/api` con Fastify, Prisma (SQLite), SSE broadcaster, rutas de sesiones, llamadas y turnos.
- Crear `hardware/qr-generator`: script automatizado para generar códigos QR vectoriales con logo y numeración de mesa, listos para impresión física o grabado láser.

### Fase 2: Frontend Comensal (`apps/client-web`) — Ultra-ligero & Resiliente
- Crear página HTML5/Tailwind Vanilla JS < 100KB.
- Implementar flujo de llamado con contexto (Cuenta con medio de pago, Mozo, Insumos).
- Enlace sutil para visualización de carta digital PDF.
- Feedback háptico (`vibrate`), botón "Ya fui atendido" y timer anti-spam visual.
- Fallback automático a WhatsApp si el backend no responde en 2 reintentos (`origin: WHATSAPP_FALLBACK`).

### Fase 3: Panel de Mozo PWA (`apps/staff-panel`) — Tiempo Real & Sonido
- Construir PWA en React 18 + Vite.
- Conexión SSE viva con reconexión transparente y heartbeat.
- Semáforo visual de urgencia y filtro dinámico por sector (Salón, Terraza, Vereda, etc.).
- AudioContext Chime mediante Web Audio API desbloqueado con interacción de login.
- Botones de acción rápida: "En camino" (🟡 → 🟢) y "Resuelto" (✅).

### Fase 4: Dashboard del Dueño/Encargado (`apps/admin-dashboard`)
- Gestión de mesas, sectores y exportación de credenciales.
- Operación de Turnos: Botón "Abrir Turno" (rotación de tokens) y "Cerrar Turno" (invalida sesiones).
- Panel de métricas operativas (tiempo medio de respuesta, picos horarios, NPS).

### Fase 5: Pruebas de Integración E2E y Validación
- Validación de flujo completo comensal → mozo → resolución.
- Prueba de desconexión y reconexión SSE.
- Simulación de apertura/cierre de turnos y expiración de tokens.
