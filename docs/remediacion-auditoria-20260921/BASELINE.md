# Baseline de Remediación — MesaYA

Fecha: 2026-09-21
Ejecutor: AntiGravity (Gemini 3.8 Flash)
Rama candidata: `codex/remediacion-auditoria-20260921`
Worktree aislado: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-remediacion-20260921`

## 1. Identificación y Trazabilidad Git

- **SHA Base de Trabajo (Candidato):** `6a1cdaead105750dfc6808cac1383018bb58ee15` (`origin/main`)
- **Rama Rastreada:** `origin/main`
- **Checkout Histórico Sucio:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` en `d932969` (preservado intacto con 3 archivos modificados y docs locales)
- **Producción Canónica Documentada:** `deploy/mesaya-canonical-manifest.json` en `origin/main` define `codex/servicio-remediacion` (release `7c38bd5` + evidencias posteriores `8072432`, `5691912`, `6a1cdae`).
- **Variante Solo Mozos:** `codex/solo-mozos` en `ca8e471` (aislada e independiente).

## 2. Entorno y Versiones Reales

- **Node.js:** `v24.17.0`
- **npm:** `12.0.2`
- **TypeScript:** `5.4.5` (estricto en `tsconfig.base.json`)
- **Fastify:** `^5.12.4` (actualizado en `package.json` de `origin/main`)
- **Prisma:** `5.14.0` (Dual SQLite local / PostgreSQL Supabase)
- **React:** `18.3.1` (en `apps/staff-panel` y `apps/admin-dashboard`)
- **Vite:** `5.2.11`
- **Client Web:** Vanilla JS ES Modules (<100KB, Zero-Framework)

## 3. Discrepancias Clave Respecto al Informe Preliminar (11 Agentes)

1. **Base Evaluada en el Informe:** El informe preliminar se ejecutó sobre `d932969` (del 6 de septiembre), ignorando 66 commits de `origin/main`.
2. **Scroll Unificado en Comensal:** El informe reportó problemas de scroll en la carta; en `origin/main`, `#menuScrollContent` y sticky category pills ya están integrados en `apps/client-web/index.html` y `styles.css`.
3. **CORS LAN:** El script `scripts/start_dev_ip.js` en `origin/main` ya incluye `buildLanCorsOrigins` con puertos 5173-5175.
4. **Manejador Central de Errores:** En `origin/main` ya existe `packages/api/src/lib/errorHandler.ts`. Sin embargo, muchas rutas todavía capturan localmente con `catch (err: any)` y pueden exponer `err.message` en 500, o acceptan `any`. Requiere estandarización estricta.
5. **Accesibilidad en `client-web`:** Gran parte de los botones en `apps/client-web/index.html` ya poseen `aria-label` y `min-h-[48px]` en `origin/main`, pero deben auditarse sistemáticamente `staff-panel` y `admin-dashboard`.
6. **ErrorBoundary:** Confirmado ausente en `staff-panel` y `admin-dashboard`.
7. **ESLint:** Confirmado ausente en todo el monorepo.

## 4. Alcance Autorizado y Criterios Operativos

- Implementación y verificación 100% local en `mdpmesasvivas-remediacion-20260921`.
- Prohibido push, merge destructivo a ramas canónicas, deploy cloud y migraciones remotas.
- Todo progreso se registra en `HALLAZGOS.md`, `CONTROL.md` y `CONTINUAR.md`.
