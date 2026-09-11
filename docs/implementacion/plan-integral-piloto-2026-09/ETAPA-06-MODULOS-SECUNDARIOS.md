# Etapa 06 — Módulos secundarios y personal

## Objetivo

Completar cada módulo anunciado o retirarlo de configuración hasta que tenga valor operativo real.

## Bloques independientes dentro de la etapa

### Upsell

- Consumir sugerencias en carta/carrito.
- Basarlas en relaciones configurables o datos de maridaje, no en texto genérico.
- Medir impresión, aceptación y venta incremental.

### Propinas

- Renderizar los porcentajes del backend.
- Permitir cero y monto personalizado.
- Asociar propina a un pago confirmado y evitar duplicados.
- Aclarar destinatario y tratamiento en la operación del local.

### Reseñas y feedback

- Respetar `enableReviews`.
- No renderizar enlace a Google sin Place ID válido; eliminar el valor de ejemplo del HTML.
- Pedir rating real; no guardar todo comentario privado como cinco estrellas.
- Separar rating interno 1–5 de NPS 0–10.

### Fila y pre-order

- Crear interfaz pública de ingreso, consentimiento mínimo y estado de espera.
- Elegir mecanismo real de aviso; no afirmar notificación si sólo cambia un estado interno.
- Integrar pre-order con una reserva/identidad segura o mantenerlo `COMING_SOON`.

### Rewards

- Antes de habilitar: identidad del cliente, ledger inmutable, reglas, acreditación por pago, saldo y canje.
- Si ese alcance no entra en el piloto, retirar el interruptor y dejar la calculadora como simulación claramente rotulada.

### Personal

- Editar nombre/sector/rol, desactivar acceso y resetear PIN.
- Invalidar sesiones tras desactivación o cambio sensible.
- Auditar quién hizo cada cambio.

## Aceptación

Cada tarjeta de configuración enlaza a su pantalla operativa y a un diagnóstico. No queda ningún toggle cuyo único efecto sea guardarse en base.

