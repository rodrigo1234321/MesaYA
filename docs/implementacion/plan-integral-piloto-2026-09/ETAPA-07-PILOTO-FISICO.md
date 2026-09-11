# Etapa 07 — Piloto físico con QR y NFC

## Objetivo

Validar el sistema en condiciones reales de salón sin dinero productivo.

## Preparación

- Un local piloto identificado y responsable de turno.
- Mesas definitivas con etiquetas consistentes; corregir `mesa 4` a la convención elegida.
- QR vectorial generado localmente para cada URL canónica.
- NTAG215 o tag on-metal cuando corresponda, programado con la misma URL.
- Un iPhone y un Android con datos móviles; Wi-Fi del local como segunda red.
- Cuenta manager, una cuenta mozo y una cuenta cocina/rol acordado.
- Mercado Pago vendedor/compradores de prueba si el tren C fue aprobado.
- Hoja de incidentes con hora, mesa, actor, acción y resultado, sin copiar tokens.

## Guion mínimo por mesa

1. Manager abre turno y verifica sesiones.
2. Teléfono A escanea QR; teléfono B toca NFC.
3. Ambos llegan al mismo local y mesa, sin exponer token en el soporte físico.
4. Consultan carta/Sommelier y agregan ítems.
5. Envían comanda; mozo valida; cocina prepara; mozo sirve.
6. Generan y resuelven llamados de mozo, insumos y cuenta.
7. Ejecutan cobro presencial y, si está aprobado, pago/split sandbox.
8. Manager libera y limpia; los tokens anteriores dejan de accionar.
9. Un nuevo grupo vuelve a usar el mismo QR/NFC y obtiene una sesión nueva.
10. Las métricas reflejan el ciclo con muestras correctas.

## Matriz física

| Prueba | iPhone | Android | Wi-Fi | Datos | QR | NFC |
|---|---:|---:|---:|---:|---:|---:|
| Mesa 1 ciclo completo | □ | □ | □ | □ | □ | □ |
| Sesión cerrada y reingreso | □ | □ | □ | □ | □ | □ |
| Reconexión tras pérdida de red | □ | □ | □ | □ | □ | □ |
| Doble toque/escaneo | □ | □ | □ | □ | □ | □ |

## PAUSA D

Registrar PASS/FAIL por paso, severidad e incidencia reproducible. Un fallo de pago, tenant, doble cobro o reutilización de sesión es NO-GO. Los fallos menores de texto/diseño se clasifican sin ocultarlos.

