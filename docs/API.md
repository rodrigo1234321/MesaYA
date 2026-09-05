# MesaYA API Reference (v1)

Base URL: `http://localhost:3000/v1`

## 1. Sesiones de Mesa (Comensal)

### `GET /sessions/:token`
Valida el token de mesa y devuelve información del restaurante, la mesa y si existe un llamado activo.
- **200 OK**:
  ```json
  {
    "valid": true,
    "table": {
      "id": "uuid",
      "label": "Mesa 1",
      "sector": "SALON_PRINCIPAL",
      "isOutdoor": false
    },
    "restaurant": {
      "id": "uuid",
      "name": "Trattoria del Puerto",
      "slug": "trattoria-del-puerto",
      "whatsappPhone": "+5492235001122",
      "pdfMenuUrl": "https://..."
    },
    "activeCall": null,
    "expiresAt": "2026-08-28T22:00:00.000Z"
  }
  ```
- **200 OK con `valid: false`**: La sesión de la mesa expiró, fue cerrada o el turno terminó. Las mutaciones con ese token se rechazan con `410 Gone`.
- **404 Not Found**: Token inexistente.

---

## 2. Llamados (Calls)

### `POST /calls`
Crea una solicitud de atención para la mesa.
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "sessionToken": "uuid-v4",
    "type": "BILL" | "WAITER" | "SUPPLIES" | "CUSTOM",
    "paymentMethod": "CASH" | "MERCADO_PAGO" | "CARD" | "NOT_APPLICABLE",
    "note": "string opcional",
    "origin": "WEB_DIRECT" | "WHATSAPP_FALLBACK"
  }
  ```
- **201 Created**:
  ```json
  {
    "id": "uuid",
    "restaurantId": "uuid",
    "tableId": "uuid",
    "tableLabel": "Mesa 1",
    "sector": "SALON_PRINCIPAL",
    "type": "BILL",
    "paymentMethod": "MERCADO_PAGO",
    "status": "PENDING",
    "createdAt": "2026-08-28T19:30:00.000Z"
  }
  ```
- **429 Too Many Requests**: Ya existe un llamado en curso para esta mesa (Rate Limit Anti-Spam).

### `PATCH /calls/:id`
Actualiza el estado del llamado (usado por el mozo).
- **Body**: `{ "status": "IN_PROGRESS" | "RESOLVED" }`

### `POST /calls/:id/cancel`
Cancela el llamado desde la web del comensal ("Ya fui atendido").
- **Body**: `{ "sessionToken": "uuid-v4" }`

### `GET /calls?restaurantId=:id`
Obtiene la lista de llamados pendientes y en progreso.

---

## 3. Stream legado (deshabilitado en piloto)

### `GET /stream?restaurantId=:id`
- Devuelve **`410 Gone`** con código `SSE_STREAM_DISABLED`; no entrega eventos ni mantiene conexiones.
- Staff y Admin usan snapshots HTTP autenticados con polling. No hay SSE distribuido ni WebSocket en el piloto.

---

## 4. Turnos & Seguridad

### `POST /shifts/open`
Abre un turno para el restaurante y genera nuevos tokens UUID v4 con TTL de 3 horas para todas las mesas activas.

### `POST /shifts/:id/close`
Cierra el turno e invalida de inmediato todas las sesiones activas asociadas.
