# Etapa 00 — Verdad funcional y baseline

## Objetivo

Hacer que administración describa capacidades reales y establecer una línea base repetible antes de ampliar el producto.

## Trabajo

1. Introducir un registro de capacidades con estados `AVAILABLE`, `PILOT_ONLY`, `COMING_SOON`, `MISCONFIGURED` y sus dependencias.
2. Hacer que API publique sólo capacidades disponibles para el restaurante y el entorno.
3. En admin, deshabilitar DIGITAL_MP, HYBRID, split, pre-order y Rewards mientras falten sus contratos completos. Mostrar el motivo y la etapa requerida.
4. Cambiar la configuración viva del piloto a `WAITER_ONLY` y `allowSplitBill=false` únicamente durante la ventana de promoción de esta etapa, no durante desarrollo.
5. Definir o retirar `syncSocialCart`.
6. Corregir textos falsos: “SSE conectado”, NPS, ahorro y cualquier módulo “activo” sin capacidad.
7. Resolver la política de `close-session`: manager o staff autorizado; alinear ruta, matriz y pruebas.
8. Crear un smoke funcional versionado que pruebe health, sesión QR, login, turno, config, llamado y pedido sin mutar el entorno estable.
9. Documentar variables por Vercel project y comprobar que los builds no dependen de archivos locales.

## Archivos probables

- `packages/shared/src/index.ts`
- `packages/api/src/services/config.service.ts`
- `packages/api/src/routes/config.routes.ts`
- `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`
- `apps/staff-panel/src/App.tsx`
- `scripts/route-matrix.json`
- pruebas de config, permisos y smoke

## Aceptación

- No se puede guardar una capacidad que el backend devuelve como no disponible.
- El estado del módulo explica requisito y entorno.
- `paymentMode` real coincide con la experiencia del cliente.
- `npm run check:routes` pasa.
- Los cuatro proyectos se construyen con el runner supervisado.
- No se cambió el alias estable durante el desarrollo.

## Parada

Emitir reporte y detener. La etapa 01 se habilita sólo después de revisión.

