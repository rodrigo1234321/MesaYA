# Enlaces operativos de Fauno

Estado verificado el 2026-09-24 UTC contra la instancia Supabase `zptpjdjvunyiytiopfgd` y el tenant `fauno-olavarria`.

## Para el local

- [Carta / acceso de mesa](https://fauno-olavarria-menu-demo.vercel.app/)
- [Mesa 1](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%201)
- [Mesa 2](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%202)
- [Mesa 3](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%203)
- [Mesa 4](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%204)
- [Mesa 5](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%205)
- [Mesa 6](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%206)
- [Mesa 7](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%207)
- [Mesa 8](https://fauno-olavarria-menu-demo.vercel.app/r/fauno-olavarria/mesa/Mesa%208)
- [Panel de staff](https://fauno-olavarria-staff.vercel.app/)
- [Panel de administración](https://fauno-olavarria-admin.vercel.app/)

La mesa se habilita desde el flujo del personal; una URL que devuelve la carta informativa con “sin sesión activa” es una mesa existente y correcta, no una mesa rota.

## Estado de consolidación

- Fauno tiene 8 mesas persistidas: 1–4 en salón y 5–8 en terraza, capacidad 4.
- API única Fauno: `https://fauno-olavarria-api.vercel.app` (uso técnico; no es un enlace para el público).
- La función API se ejecuta en `gru1` (São Paulo), junto a la base `sa-east-1`.
- Los proyectos Vercel históricos `api`, `client-web`, `staff-panel` y `admin-dashboard` quedaron pausados y son reversibles; no se eliminaron sus despliegues ni la base histórica.
- `fauno-olavarria-demo` no tenía deployment de producción activo al consolidar y no se usa como enlace operativo.

## Evidencia y límites

- Los once enlaces públicos de arriba devolvieron HTTP 200 en la comprobación de cierre.
- Login real de staff y admin devolvió HTTP 200; el panel mostró las 8 mesas.
- Dos contextos de navegador verificaron la recuperación ante 503/401/403 y la reautenticación. Una prueba controlada adicional usó Mesa 8: dos clientes compartieron carrito, el mozo validó la comanda, Caja mostró la cuenta y el split presencial 50/50 cerró en cero con replay idempotente; la mesa quedó disponible nuevamente. No se alteró la sesión existente de Mesa 1.
- La prueba física con dos teléfonos, QR/NFC, red del local y operación presencial queda pendiente de realizar en el local.
