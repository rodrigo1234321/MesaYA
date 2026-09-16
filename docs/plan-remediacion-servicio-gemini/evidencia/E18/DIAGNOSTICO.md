# E18 — Diagnóstico de Admin, coordinación y Ventas

Fecha de la corrida: 2026-09-15.

## Contexto reproducido

- Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`.
- Rama: `codex/servicio-remediacion`.
- SHA de entrada y salida: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83` (sin commit).
- El árbol ya estaba sucio por E00–E17; no se usó `reset`, `clean`, `checkout`, `switch`, `merge`, `rebase`, ni se detuvieron servicios.
- Histórico consultado: `antigravity/admin-ux-baseline` en `ea65a88`. No se hizo merge de esa rama; se portaron sólo decisiones justificadas.

## Hallazgos y decisiones

1. **Navegación del dueño:** confirmado que las siete entradas del Admin no tenían semántica de tab/panel ni navegación por flechas. `App.tsx` ahora conserva todas las vistas, agrega `role=tablist`, tabs/panels asociados, `aria-selected`, `aria-controls`, `tabIndex`, foco visible y Arrow/Home/End.
2. **Tenant del panel RTMS:** confirmado que `RTMSAnalyticsView` recibía un valor tratado como `restaurantSlug` pero desde la shell podía recibir el id. Se conserva el tenant de las vistas protegidas y se pasa el slug canónico al componente RTMS; no se inventaron rutas de deployment.
3. **Estados accesibles:** confirmado que métricas, RTMS y configuración mostraban errores/estados sin semántica suficiente. Se agregaron regiones `status`/`alert`, nombres de controles, diálogos identificables, switches y tablas con encabezados semánticos. El mapa de calor mantiene su vista visual como complemento y agrega una tabla textual independiente; no depende de color/hover.
4. **QR:** confirmado el riesgo histórico documentado en `docs/produccion/REVISION-CLOUD-2026-09-05/01-HALLAZGOS.md`: sin `VITE_CLIENT_WEB_URL`, `TablesManager` construía el enlace con el host del Admin. Se corrigió de forma mínima en `TablesManager.tsx`, aunque el archivo no figuraba en la lista inicial de E18, porque el requisito de E18 exige que el QR no apunte silenciosamente al dominio equivocado. Sin la variable, el Admin muestra diagnóstico y deshabilita QR/copiar/abrir; con ella usa `buildCanonicalClientTableUrl` y `/r/<slug>/mesa/<label>`.
5. **Ventas y cobros:** se confirmó que las ediciones E16 de `SalesManager`/API permanecen: resumen, operaciones, tickets/PDF, comprobantes, ajustes, período/turno/medio/responsable/comprobante y exportaciones. E18 sólo agregó semántica y estados de carga/error; no sustituyó la lógica de conciliación.
6. **Permisos:** no se modificó RBAC/backend. Los 401/403 siguen presentándose con mensaje público accionable sin stack ni detalle interno. La UI no convierte selección de nombre en autenticación.

## Hipótesis descartadas

- El diff `ea65a88` no justificaba importar una interfaz histórica completa: su cambio Admin relevante era el tenant id para módulos protegidos. Se portó selectivamente y se conservaron las pestañas actuales, especialmente Ventas.
- No era necesario agregar un router, Redux, WebSocket ni una nueva app.
- No se puede certificar con esta evidencia el tiempo de interacción, zoom 200%, lector de pantalla, teclado físico, dos dispositivos ni el dominio desplegado; quedan separados como gates humanos/cloud.

## Alcance final

- Archivos Admin E18: `App.tsx`, `MetricsView.tsx`, `ModuleConfigManager.tsx`, `RTMSAnalyticsView.tsx`, `StaffManager.tsx`, `SalesManager.tsx`.
- Corrección QR justificada adicional: `TablesManager.tsx`.
- Test focal: `packages/api/test/e18-admin-accessibility.test.ts`.
- Documentación: `reportes/E18.md`, esta evidencia, `VERIFICACION-CODEX-20260915.md`, `CONTINUAR.md` y estado E18 en `CONTROL.md`.
- Cambios E00–E17 fuera de ese conjunto fueron preservados.
