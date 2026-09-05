# MesaYA — Sistema de Servicio de Mesa NFC + QR para Gastronomía

> Sistema SaaS ultra-rápido de comunicación mesa→staff en tiempo real (NFC + QR) optimizado para despliegue en **Supabase (PostgreSQL)** + **Vercel (Serverless)**.
> 
> 📖 **Dossier Técnico & Estratégico Canónico:** Consulta [PROYECTO_MAESTRO.md](file:///c:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas/PROYECTO_MAESTRO.md) para el desglose exhaustivo de misión, arquitectura FSM 8 estados, stack, esquema relacional Prisma y hardware costero.

---

## 🌟 Características Principales

1. **Food-First UX (Carta Protagonista)**: Al escanear el QR o tocar el NFC, la carta digital y sugerencias del chef dominan el viewport principal (Above the fold), mientras la botonera inteligente de servicios a la mesa (`Pedir Cuenta`, `Llamar Mozo`, `Insumos`) y el visor interactivo permanecen accesibles con 1 tap.
2. **Blindaje Anti-Llamados Fantasma**:
   - **Invalidación por el Mozo**: Al retirarse la mesa, el mozo cierra la sesión en 1 tap y el link queda revocado de inmediato en la base de datos (`410 Gone`).
   - **Geofencing Just-in-Time**: Al llamar al mozo o pedir la cuenta, se valida opcionalmente la proximidad geográfica al restaurante.
   - **Tokens de Navegador Efímeros**: Manejo en memoria de sesión que expira por inactividad.
3. **Resiliencia Serverless en Vercel**: Panel de staff con sincronización reactiva mediante polling HTTP cada 3s con indicador visual de latencia y timbre Web Audio API sintético para máxima robustez en redes móviles.
4. **Base de Datos en Supabase**: Compatible con PostgreSQL (Transaction Pooler en puerto 6543 para Vercel Serverless y Direct URL en 5432 para migraciones Prisma).

---

## 🏗️ Estructura del Monorepo

- **`apps/client-web/`**: Web móvil comensal Food-First (<100KB payload, sin app obligatoria, HTML/Tailwind/Vanilla JS).
- **`apps/staff-panel/`**: Panel PWA del mozo/salón (React 18 + Vite, Polling reactivo 3s, timbre Web Audio API, semáforos y acción de liberar mesa).
- **`apps/admin-dashboard/`**: Panel del encargado (React 18 + Vite, control de turnos, alta de mesas, editor de plano Konva y métricas operativas).
- **`packages/api/`**: Backend Fastify + TypeScript + Prisma (PostgreSQL en Supabase / SQLite local).
- **`api/index.ts` & `vercel.json`**: Adaptador serverless listo para despliegue en Vercel.
- **`packages/shared/`**: Tipos, enums y DTOs compartidos.
- **`hardware/qr-generator/`**: Generador de códigos QR vectoriales SVG listos para grabado láser.
- **`docs/DEPLOY_VERCEL_SUPABASE.md`**: Guía paso a paso de despliegue en Supabase + Vercel.
- **`docs/produccion/`**: Auditorías, guías de hardening de base de datos y checklist de producción.

---

## 🚀 Inicio Rápido en Desarrollo Local

### 1. Instalar dependencias y compilar
```bash
npm install
npm run build
```

### 2. Base de datos y Seed
```bash
npm --workspace=@mesaya/api run prisma:generate

# Desarrollo local (SQLite dev.db con datos de prueba):
npm --workspace=@mesaya/api run prisma:seed

# Para inicializar un nuevo restaurante limpio en Staging/Producción (PostgreSQL):
npm run bootstrap:restaurant -- --name "Mi Local" --slug "mi-local" --pin "9999"
```

### 3. Iniciar servicios en simultáneo
- **API Backend**: `npm run dev:api` (puerto 3000)
- **Panel Mozo PWA**: `npm run dev:staff` (puerto 5174)
- **Panel Admin / Encargado**: `npm run dev:admin` (puerto 5175)
- **Web Comensal**: `npm --workspace=@mesaya/client-web run dev` (puerto 5173)

---

## 🧪 Credenciales Demo de Prueba

- **Restaurante Demo**: Trattoria del Puerto (`trattoria-del-puerto`)
- **PIN Mozo Salón**: `1234`
- **PIN Encargado Admin**: `9999`
- **URL Comensal Demo (Mesa 1)**: `http://localhost:5173/?token=demo-token`

---

## 📄 Licencia
Propiedad de Rodrigo (Mar del Plata, Argentina).

