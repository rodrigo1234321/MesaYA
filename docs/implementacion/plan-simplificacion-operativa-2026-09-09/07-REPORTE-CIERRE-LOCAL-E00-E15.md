# Reporte de cierre local — E00 a E15

**Corte:** 2026-09-10 (-03:00)  
**Repositorio:** `mdpmesasvivas`  
**Rama:** `antigravity/core-capabilities-stage00`  
**Resultado:** `PASS_LOCAL_NEEDS_REVIEW`

## 1. Resultado ejecutivo

El plan de simplificación quedó ejecutado y verificado en local. La conclusión
operativa se sostiene en código, pruebas de API/SQLite y un recorrido completo por
LAN de cliente y mozo:

- un pedido normal entra directo a cocina sin validación del mozo;
- la validación queda reservada para excepciones configuradas y visibles;
- el mozo trabaja desde `Servicio`, con cola, mapa, cocina, cuenta, cobro y limpieza
  en el mismo contexto;
- el cobro es por cuenta acumulada de la ocupación, no por la última comanda;
- `Mesa lista` es la confirmación física final: cambia a `AVAILABLE` y deja preparada
  una sesión nueva, vacía y con token nuevo;
- el QR físico permanece estable y su consulta sigue siendo read-only.

El estado no se declara GO de piloto/producción porque todavía falta una revisión
independiente y evidencia de despliegue/restauración/cloud, además de la prueba humana
con dispositivos físicos.

## 2. Qué se corrigió

### Cuenta y ocupación

Se mantuvo una proyección canónica por `TableSession`: consumo confirmado menos pagos
asignados. Las tandas, borradores, validaciones, propina y pagos se distinguen; el
cliente y Servicio leen la misma fuente. El cierre registra el pago, revoca el token
anterior y lleva la mesa a `TO_CLEAN` sin borrar pendientes.

Se corrigieron dos carreras que podían producir resultados engañosos en una terminal
SQLite local:

1. rotaciones explícitas concurrentes de una misma mesa se coalescen en una sola
   ocupación;
2. transiciones FSM concurrentes de una misma mesa se serializan por mesa, de modo
   que el segundo intento recibe el estado/conflicto correcto y no un timeout de base.

### Servicio del mozo

La navegación primaria quedó reducida a `Servicio` y `Más`. La cola combina llamados,
validaciones, pedidos en cocina, retiros, cuentas y limpieza. El mapa muestra Cocina y
el estado de cada mesa. `Cobrar y cerrar` y `Mesa lista` viven dentro del contexto de
la mesa; el mozo no necesita abrir Caja/Admin para el recorrido normal.

La reautorización del encargado, cuando corresponde al rol de mozo, es puntual e inline:
se solicita PIN para esa operación y no se convierte la sesión del mozo en una sesión
permanente de manager.

### Cliente y colaboración

Agregar un plato cierra sólo el detalle y deja al cliente en la carta, conservando el
contexto. El carrito se abre voluntariamente. El nombre del participante se guarda en
su propio campo, separado de la nota de cocina, con saneamiento y límite de longitud.
Las sugerencias se calculan desde el último agregado, muestran como máximo dos,
excluyen lo ya agregado y respetan el descarte persistente de la sesión.

## 3. Conteo observado de acciones

Para el recorrido de una ronda con dos productos —Gin x2 y Sorrentinos— se observó:

| Intención | Acciones primarias del mozo | Resultado |
|---|---:|---|
| Pedido normal del cliente hasta cocina | 0 | El cliente envía; no aparece validación rutinaria. |
| Llamado o excepción | 1 | Reclamo/aceptación queda en la cola con contexto. |
| Pedido listo | 1 | `Marcar listo`/acción de estado en Servicio. |
| Llevar a la mesa | 1 | `Entregado`, con reclamo atómico. |
| Cobrar y cerrar | 1 | `Cobrar y cerrar`; PIN puntual aparte si el rol lo exige. |
| Confirmar limpieza | 1 | `Mesa lista`; prepara la ocupación siguiente. |

En el caso normal completo son cuatro acciones operativas posteriores a cocina
(`listo`, `entregado`, `cobrar/cerrar`, `mesa lista`), más el PIN de autorización cuando
la política del local lo exige. El PIN se mide aparte porque es una barrera de seguridad,
no una navegación o una validación rutinaria del pedido.

Para el cliente, cada producto requiere abrir su detalle y pulsar `Agregar`; puede
seguir leyendo y agregar el siguiente sin ser enviado al carrito. El envío de la ronda
es una única confirmación explícita y el carrito se abre sólo si el cliente lo decide.

## 4. Evidencia automatizada

### Suite completa

```text
npm run test:local
Test Files  64 passed | 1 skipped (65)
Tests       571 passed | 3 skipped (574)
```

Los tres tests omitidos son skips explícitos del repositorio, no fallos ocultos.

### Focales de los cambios principales

- E00-E03 / Gate A: `17/17`.
- QR, cobro, limpieza y sesión siguiente: `39/39` en las focales ejecutadas.
- E13 colaboración + E14 sugerencias: `10/10`.
- Acceso, llamados, feedback, revocación de token anterior y nuevo QR: `37/37`.
- Build ordenado del monorepo: `6/6` workspaces.
- Matriz de rutas: `95` rutas clasificadas, sin deriva.
- Schema Supabase: sincronizado con el schema canónico.
- Manifiesto de instancia: válido, sin secretos incluidos.
- `git diff --check`: sin errores; sólo avisos normales de conversión LF/CRLF del
  checkout compartido.

### Recorrido LAN cliente → API → datos → mozo

Se ejecutó sobre la base local `.tmp/live-ip-local-20260909-v2.db`:

1. el cliente abrió el QR estable de `Gate E 1789011722684`;
2. agregó Gin con cantidad `2`, participante `Ana` y nota `Sin hielo`;
3. agregó Sorrentinos con participante `Luis` sin abandonar la carta;
4. abrió el carrito voluntariamente y envió una tanda;
5. la API respondió y la base persistió una orden `IN_KITCHEN` de `24100`, con las dos
   líneas y sus campos separados;
6. Servicio mostró una sola cola con la tarea de cocina y el mapa con Cocina señalizada;
7. `Marcar listo`, `Entregado`, `Cobrar y cerrar` y `Mesa lista` se ejecutaron desde el
   mismo contexto;
8. tras la limpieza, el mismo QR mostró acciones de cliente activas, no la cuenta
   anterior;
9. una lectura directa no sensible confirmó: mesa `AVAILABLE`, tres sesiones históricas
   (dos cerradas) y una sesión activa nueva sin pedidos ni cobros.

También se verificó `GET /v1/health` por LAN (`200`) y no hubo overflow horizontal en
cliente ni mozo.

## 5. Decisiones de producto que quedan fijadas

- `requireWaiterValidation=false` es la política local normal; si una instalación activa
  excepciones, el modo de revisión sigue disponible y exige un motivo real.
- Una cantidad normal como Gin x2 no es una excepción por sí sola.
- Una nota de alergia/restricción que ya está contemplada por la carta es contexto visible,
  no una confirmación humana innecesaria.
- El cliente no abandona la carta al agregar.
- Las sugerencias son contextuales y no deben bloquear el envío.
- El siguiente QR nunca hereda la cuenta anterior.

## 6. Límites y próximo GO/NO-GO

Este cierre es de código, SQLite efímera, base local y navegador LAN. Antes de un piloto
real aún deben cerrarse:

- revisión independiente de los cambios y de este reporte;
- migración/paridad y prueba sobre PostgreSQL/Supabase real;
- despliegue, restore probado y observabilidad del entorno objetivo;
- recorrido manual desde teléfonos reales con cámara/QR/NFC y dos dispositivos
  colaborativos;
- observación de un mozo real para confirmar tiempos, legibilidad y carga cognitiva.

Por eso los gates G-A, G-B, G-C, G-D y G-E figuran como
`PASS_LOCAL_NEEDS_REVIEW`, no como GO de producción.
