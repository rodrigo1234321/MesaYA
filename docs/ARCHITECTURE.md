# MesaYA — Arquitectura Técnica de Sistema

> Estado operativo de piloto (2026-09-05): el código y los reportes de etapas aprobadas prevalecen sobre este documento. Los snapshots HTTP autenticados con polling son el transporte actual; `/stream` está deshabilitado con `410 SSE_STREAM_DISABLED`. Pagos digitales, split, rewards y pre-order no forman parte del piloto operativo.

## 1. Topología del Sistema
MesaYA opera como un monorepo modular desacoplado en 3 aplicaciones frontend y 1 backend API:

- **`apps/client-web`**: Web estática ultra-ligera (<100KB) para comensales en HTML5 + Tailwind CDN + Vanilla JS. Sin pasos de compilación obligatorios para máxima velocidad de carga en redes 3G/4G congestionadas de verano.
- **`apps/staff-panel`**: PWA responsiva en React 18 + Vite con polling HTTP autenticado, semáforo de tiempos de espera, filtro de mozo por sector y sintetizador de chimes en Web Audio API.
- **`apps/admin-dashboard`**: Panel administrativo para control de turnos, alta de mesas, exportación de códigos y auditoría de tiempos de respuesta y NPS.
- **`packages/api`**: API REST en Node.js + Fastify 4.x + Prisma ORM; el endpoint SSE legado está cerrado.
- **`packages/shared`**: Definiciones comunes de contratos TypeScript, enums y DTOs.
- **`hardware/qr-generator`**: Generador automatizado de plantillas vectoriales SVG con marcas de grabado para soportes acrílicos anti-salitre.

## 2. Decisiones de Ingeniería Clave
1. **Polling HTTP autenticado**: Staff y Admin obtienen snapshots autorizados mediante un coordinador sin solicitudes solapadas, con cancelación y backoff. No se sostiene un stream SSE en el piloto.
2. **Web Audio API Chime**: Se desbloquea en el evento `onClick` del login numérico, garantizando que el audio suene con fuerza incluso si el navegador bloquea autoplay.
3. **Fallback Automático a WhatsApp con Marcado de Origen**: Si la red o el backend fallan momentáneamente, la UI cambia a WhatsApp preformateado y marca `origin: "WHATSAPP_FALLBACK"` para evitar llamados duplicados.
4. **Protección Anti-Salitre**: Especificación de tags NTAG215 encapsulados en resina epoxi UV con adhesivo 3M 300LSE para resistir el clima marino de Mar del Plata.
