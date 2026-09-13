# Plan maestro definitivo de cierre y piloto presencial de un día — MesaYA

Fecha del dictamen: 2026-09-13  
Versión: **2.0.0 — DEFINITIVA PARA EJECUCIÓN**  
Estado: **PLANIFICADO Y CONSOLIDADO — NO EJECUTADO — AUTORIZA INICIO DE EJECUCIÓN FASEADA**  
Baseline de código inspeccionado: commit `04633508b1033e6c6e7e1e671af32ffdfb45d4b0` (rama `antigravity/core-capabilities-stage00` / `main`)  
Repositorio: `rodrigo1234321/MesaYA`  
Alcance integral: Monorepo TypeScript, Fastify API, Prisma ORM, PostgreSQL (Supabase), Vercel Serverless, 3 Frontends Vite/React (Client, Staff, Admin), contratos monetarios, identidad de terminal/personal, higiene de errores, seguridad, observabilidad, contingencia en papel y protocolo de aborto.

---

## 1. Dictamen ejecutivo y estado de situación

MesaYA cuenta con una base arquitectónica funcional, con CI limpia (105 rutas clasificadas, paridad de schema SQLite/PostgreSQL y suites de prueba locales aprobadas). Sin embargo, una auditoría técnica en profundidad determinó que el sistema presentaba riesgos bloqueantes antes de operar con comensales reales y dinero en un establecimiento gastronómico.

> **Dictamen actual: NO-GO para operación inmediata en vivo; GO condicional para inicio de ejecución de las etapas E00 a E12 según la ruta crítica definida.**

El presente documento sustituye y perfecciona los borradores previos (`PLAN-CIERRE-HALLAZGOS-E2E-2026-09-11.md` y la versión preliminar del 2026-09-13), cerrando la totalidad de los 11 vacíos técnicos identificados por la revisión independiente:

1. **Contabilidad canónica formal**: Invariantes matemáticos expresados exclusivamente en números enteros (`minor units`), predicado estricto de qué estados de comanda computan, y tratamiento inmutable de devoluciones, propinas y ajustes.
2. **Saga de cobro y cierre incompleto (`SETTLE_CLOSURE_INCOMPLETE`)**: Protocolo transaccional atómico y reconciliación de mesas saldadas con fallo de red.
3. **Identidad de terminal compartido y mozos**: Separación estricta entre credencial de dispositivo (Terminal Token revocable) y sesión de operador (PIN de 4–6 dígitos con bloqueo por inactividad y prevención de PINs colisionables).
4. **Workflow y gobernanza de migraciones**: Exclusión mutua con locks distribuidos en PostgreSQL, verificación de SHA, timeout explícito y smoke test post-migración.
5. **Inventario cloud efectivo en Vercel**: Eliminación de supuestos ciegos sobre cantidad de proyectos; relevamiento y mapeo estricto 1:1 de los 4 componentes canónicos (`api`, `client`, `staff`, `admin`).
6. **Matriz de rollback quirúrgica desacoplada**: Desacople total entre código, variables, dominios y base de datos con garantía obligatoria de migraciones aditivas retrocompatibles ($N / N-1$).
7. **Higiene estricta de secretos**: Prohibición de registrar valores o hashes de secretos en logs y artefactos; auditoría de presencia por metadata.
8. **Protocolo humano de aborto y fallback manual ensayado**: Doble autoridad con poder de veto unilateral (Lead Técnico y Operador Local de Salón) y simulación previa de contingencia analógica en papel.
9. **Perfil de carga y ensayo operacional reproducible**: Simulación automatizada cuantificada con k6/Artillery y dry-run de 90 minutos en hardware y red real el día previo ($T-24\text{ h}$).
10. **Reordenamiento lógico de dependencias**: Secuencia sin ciclos ni inversiones temporales (observabilidad implementada antes de staging, certificación antes de promoción).
11. **Sanitización determinista de errores (`err.message`)**: Detección sistemática y error boundary que garantiza respuestas 5xx opacas con `requestId` y redacción de internals.

---

## 2. Matriz de hallazgos confirmados y criterios de cierre

| ID | Prioridad | Componente | Hallazgo confirmado en código | Riesgo operativo | Criterio estricto de cierre |
|---|:---:|---|---|---|---|
| **P0-01** | **P0** | API / DB | Órdenes aceptadas desde `PENDING_VALIDATION` no recalculaban totales persistidos atómicamente. Recibos sumaban ítems, mientras reportes/fiscal leían totales de cabecera de orden desactualizados. | Divergencia contable entre ticket comensal, cierre de caja y arqueo. | Única función pura de cálculo monetario en `minor units`; transacción atómica obligatoria; backfill idempotente y test de divergencia cero. |
| **P0-02** | **P0** | API / Deps | `npm audit --omit=dev` reporta 4 vulnerabilidades (1 crítica, 2 altas, 1 moderada) en `fast-jwt`, `fastify`, `find-my-way` y `@fastify/jwt`. | Denegación de servicio por routing o falsificación de tokens en Fastify 4. | Migración planificada a Fastify 5 + Node 22; adaptación de schemas shorthand a JSON Schema estándar; cero vulnerabilidades en audit de producción sin usar `audit fix --force`. |
| **P0-03** | **P0** | Scripts / Auth | Script de bootstrap asignaba PIN `9999` por defecto, aceptaba hasta 8 caracteres alfanuméricos, rotaba credenciales existentes incondicionalmente e imprimía el PIN plano en stdout. | Fuga de credencial en logs de despliegue y acceso no autorizado al panel administrativo. | PIN provisto obligatoriamente por variable/canal seguro; validación estricta de 4 a 6 dígitos; rotación solo mediante flag explícito `--rotate-pin`; prohibición absoluta de loguear el PIN. |
| **P0-04** | **P0** | Staff UI / Auth | Interfaz de Staff forzaba input de 4 dígitos mientras el backend aceptaba 4–6. El backend evaluaba hashes secuencialmente y no validaba colisión de PINs idénticos entre distintos usuarios del mismo local. | Bloqueo de operadores con PIN de 5 o 6 dígitos; ambigüedad de identidad al compartir terminal. | Unificación del contrato a 4–6 dígitos; verificación de no-colisión de PINs por restaurante; sesión de terminal desacoplada de la reautenticación del mozo. |
| **P0-05** | **P0** | API / Handler | Fuga de `err.message` en múltiples controladores y bloques catch evitando el manejador global de Fastify. | Filtración de nombres de tablas, sintaxis SQL, paths de sistema o stacks de ejecución al navegador. | Error boundary global; captura de excepciones con `requestId`; respuesta 500 opaca estandarizada; solo excepciones `AppPublicError` permitidas para 4xx. |
| **P0-06** | **P0** | Supabase / DB | Las 23 migraciones PostgreSQL carecían de políticas RLS explícitas y revocación de permisos por defecto sobre el schema `public`. | Exposición directa si la Data API (PostgREST) o los roles anónimos quedaban accesibles en la nube. | Desactivación de Data API si el acceso es 100% Prisma; script de hardening reproducible con `REVOKE` a roles `anon` y `authenticated`; prueba negativa de acceso HTTP a PostgREST. |
| **P0-07** | **P0** | Base de Datos | Inexistencia de evidencia documental o prueba automatizada de restauración de backup funcional sobre PostgreSQL. | Incapacidad de recuperación ante corrupción de base o fallo catastrófico en el piloto. | Procedimiento ejecutado y medido de dump/restore sobre instancia aislada, con test de integridad de datos y cálculo de RPO/RTO real. |
| **P0-08** | **P0** | Vercel Serverless | El test smoke de `api/index.ts` solo comprobaba la instanciación de la app mediante `.inject()`, sin probar el handler serverless exportado bajo ciclo de vida real. | Fallo silencioso en frío (cold start), headers CORS mal gestionados o timeout de serverless function en Vercel. | Test suite sobre el handler serverless emulando requests reales de Vercel, cubriendo cold starts, OPTIONS/CORS, fallos de conexión DB y timeouts. |
| **P0-09** | **P0** | Infra / Vercel | La documentación mencionaba 4 proyectos Vercel pero existían discrepancias en checks de despliegue. | Despliegue duplicado, variables desalineadas o dominios apuntando a commits dispares. | Relevamiento cloud con Vercel CLI; mapa exacto de 4 proyectos (`api`, `client`, `staff`, `admin`); desvinculación de proyectos huérfanos. |
| **P1-01** | **P1** | Admin UI | En `SalesManager.tsx`, pulsar "Ver ticket" cargaba los datos del recibo pero no activaba la pestaña correspondiente en la UI. | Confusión operativa en caja durante el cobro y control de tickets. | Navegación programática determinista a la pestaña de tickets tras la carga exitosa, verificada por test de componente. |
| **P1-02** | **P1** | Admin / QR | Admin generaba URLs de QR mediante query string y fallback al propio host de Admin; el generador físico utilizaba `/r/<slug>/mesa/<label>`; además se utilizaba una API externa para generar imágenes QR. | Comensal escaneando QR aterriza en el Admin o cae por fallo de conectividad con la API externa de QR. | Constructor canónico de rutas compartido (`packages/shared`); renderizado local de QR con librería SVG/Canvas sin llamadas externas; validación estricta de `VITE_CLIENT_WEB_URL`. |
| **P1-03** | **P1** | Métricas / Salón | Los cálculos de "inicio del día" en reportes operacionales utilizaban la zona horaria del servidor (UTC en Vercel) y no la zona IANA del restaurante. | Corte de caja desfasado respecto al horario comercial real del salón. | Módulo canónico de fecha/hora con `Intl` / `date-fns-tz` forzando la IANA timezone configurada para el restaurante (ej. `America/Argentina/Buenos_Aires`). |
| **P1-04** | **P1** | Cliente / Menú | El parser de alertas de alérgenos y restricciones alimentarias utilizaba regex directa sin normalizar caracteres Unicode ni diacríticos en español. | Comensales con requerimientos de salud (`alérgica`, `celíaco`, `sin TACC`) no alertaban debidamente a la comanda de cocina. | Normalización previa con `normalize('NFD').replace(/[\u0300-\u036f]/g, '')` y suite de pruebas con fixtures en español. |
| **P1-05** | **P1** | Seguridad / Red | El rate limiting por IP de Fastify podía agrupar a todos los clientes del salón bajo la misma IP pública del router Wi-Fi del local. | Bloqueo masivo indiscriminado (falso positivo) de comensales y mozos durante picos de servicio. | Estrategia compuesta de limitación: por Token de Sesión/Terminal para tráfico interno, y por IP + Subnet tras proxy confiable (`trustProxy` en Vercel) con umbrales calibrados para Wi-Fi compartido. |
| **P1-06** | **P1** | Observabilidad | Logs del sistema dispersos y no estructurados; ausencia de correlación entre frontend y backend. | Imposibilidad de diagnosticar anomalías en tiempo real durante el servicio en vivo. | Logger Pino estructurado en JSON con inyección obligatoria de `requestId`, `correlationId`, `restaurantId`, `terminalId` y `staffUserId`, con redacción garantizada de datos sensibles. |

---

## 3. Contratos canónicos e invariantes formales

### 3.1 Contabilidad de salón, estados de comanda y dinero

Toda magnitud monetaria en MesaYA se almacena y calcula en **números enteros positivos** (`minor units`, centavos en ARS). Queda estrictamente prohibido el uso de tipos de coma flotante (`Float`, `Number` fraccionario) en la lógica de dominio o balances de base de datos.

#### 3.1.1 Predicado formal de cómputo de comandas
No toda orden emitida por un comensal integra el balance exigible de una mesa. Se establece la siguiente función de pertenencia estricta:

$$\text{computa}(order) \iff \text{status}(order) \in \{\text{'CONFIRMED'}, \text{'IN\_PREPARATION'}, \text{'READY'}, \text{'DELIVERED'}, \text{'COMPLETED'}\}$$

- **Exclusiones explícitas**:
  - `PENDING_VALIDATION`: Comanda enviada por comensal que requiere revisión previa de mozo; **NO suma al consumo** hasta ser aprobada.
  - `REJECTED`: Comanda descartada por cocina o salón; **NO suma al consumo**.
  - `CANCELLED`: Comanda anulada formalmente con registro de auditoría; **NO suma al consumo**.

#### 3.1.2 Fórmulas matemáticas de balance de sesión (`TableSessionAccount`)
Para una sesión de mesa activa identificada por $S$:

1. **Consumo base de comida y bebida**:
   $$\text{consumoMinor}(S) = \sum_{o \in \text{Orders}(S) \mid \text{computa}(o) = \text{true}} \text{totalAmountMinor}(o)$$
   Donde para cada comanda:
   $$\text{totalAmountMinor}(o) = \sum_{i \in \text{Items}(o)} (\text{quantity}_i \times \text{unitPriceMinor}_i + \text{modifiersMinor}_i)$$

2. **Ajustes netos auditados** (descuentos, cortesías, recargos):
   $$\text{adjustmentsMinor}(S) = \sum_{a \in \text{Adjustments}(S)} a.\text{amountMinor} \times \begin{cases} +1 & \text{si tipo} = \text{'SURCHARGE'} \\ -1 & \text{si tipo} \in \{\text{'DISCOUNT'}, \text{'COURTESY'}\} \end{cases}$$

3. **Propinas** (registradas pero contablemente discriminadas):
   $$\text{tipMinor}(S) = \sum_{p \in \text{Settlements}(S) \mid p.\text{status} = \text{'CONFIRMED'}} p.\text{tipAmountMinor}$$

4. **Total general adeudado**:
   $$\text{totalDueMinor}(S) = \text{consumoMinor}(S) + \text{adjustmentsMinor}(S) + \text{tipMinor}(S)$$

5. **Pagos efectivamente asentados**:
   $$\text{paidMinor}(S) = \sum_{p \in \text{Settlements}(S) \mid p.\text{status} = \text{'CONFIRMED'} \land p.\text{type} = \text{'PAYMENT'}} p.\text{amountMinor} - \sum_{r \in \text{Settlements}(S) \mid r.\text{status} = \text{'CONFIRMED'} \land r.\text{type} = \text{'REFUND'}} r.\text{amountMinor}$$

6. **Saldo pendiente exigible**:
   $$\text{saldoMinor}(S) = \text{totalDueMinor}(S) - \text{paidMinor}(S)$$

#### 3.1.3 Invariantes de cierre y estados de excepción
- **Invariante de Cobro**: $\text{saldoMinor}(S) \ge 0$. No se permiten saldos negativos sin una operación explícita de `REFUND` vinculada a un cobro previo.
- **Invariante de Cierre de Mesa**: Una mesa solo puede transicionar a estado `CLOSED` si y solo si:
  $$\text{saldoMinor}(S) = 0 \quad \land \quad \text{count}(o \in \text{Orders}(S) \mid \text{status}(o) = \text{'PENDING\_VALIDATION'}) = 0$$
- **Reembolsos y Devoluciones**: Inmutables. Queda terminantemente prohibido borrar o mutar registros de `Settlement`. Una devolución crea un nuevo registro con `type = 'REFUND'`, referencia obligatoria a `originalSettlementId`, motivo en texto plano y firma del `staffUserId` que autoriza.
- **Discriminación de Propinas**: En recibos impresos y reportes de caja, las propinas nunca se mezclan con el ingreso por venta gastronómica neta.

### 3.2 Saga transaccional y protocolo de cierre incompleto (`SETTLE_CLOSURE_INCOMPLETE`)

En una arquitectura serverless con red móvil, un corte de conexión entre la confirmación del pago en base de datos y la recepción del ACK en la UI puede desfasar el estado de salón.

#### 3.2.1 Transacción atómica en PostgreSQL
El endpoint `/api/v1/sessions/:id/settle` ejecutará una única transacción serializada en Prisma:
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Verificar lock pesimista o versionado optimista de la sesión
  const session = await tx.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
  
  // 2. Verificar idempotencia mediante clave única enviada por el cliente
  const existing = await tx.settlement.findUnique({ where: { idempotencyKey } });
  if (existing) return buildSettlementResponse(existing);

  // 3. Recomputar balance canónico estricto
  const account = await calculateCanonicalSessionAccount(tx, sessionId);
  if (paymentAmountMinor > account.saldoMinor) {
    throw new AppPublicError('OVERPAYMENT_NOT_ALLOWED', 'El importe supera el saldo adeudado');
  }

  // 4. Asentar el Settlement y generar el Receipt inmutable
  const settlement = await tx.settlement.create({ /* ... */ });
  const receipt = await tx.receipt.create({ /* ... */ });

  // 5. Si el saldo restante es cero, transicionar la sesión y mesa
  if (account.saldoMinor - paymentAmountMinor === 0) {
    await tx.tableSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', closedAt: new Date() }
    });
    await tx.table.update({
      where: { id: session.tableId },
      data: { status: 'TO_CLEAN' }
    });
  }
}, { isolationLevel: 'Serializable', timeout: 10000 });
```

#### 3.2.2 Protocolo de recuperación ante fallos de red
- **Idempotencia estricta**: Si el cliente reenvía la petición con la misma `idempotencyKey`, la API responde con el `Receipt` generado previamente (`200 OK`) sin volver a registrar un movimiento de caja.
- **Detección de mesa en limbo (`SETTLE_CLOSURE_INCOMPLETE`)**:
  - Si una sesión tiene $\text{saldoMinor} = 0$ pero su estado permanece en `ACTIVE` debido a una caída del worker antes de actualizar el salón, el polling de Staff detectará esta condición y mostrará un banner operativo: `[Cobro confirmado — Cierre de mesa pendiente]`.
  - La UI de Staff dispondrá de un botón seguro `[Confirmar liberación de mesa]` que invoca un endpoint idempotente de conciliación sin registrar nuevos pagos.

### 3.3 Identidad de terminal compartido y autenticación granular de Staff

En el salón gastronómico conviven dos realidades de seguridad que deben mantenerse disjuntas:

```
+-----------------------------------------------------------------------+
| Puesto Fijo / Tablet de Salón                                         |
| -> Device Session (TerminalToken persistente en hardware, revocable)  |
|                                                                       |
|    +-------------------------------------------------------------+    |
|    | Operador Activo (Mozo / Encargado)                          |    |
|    | -> Staff Session (PIN de 4-6 dígitos, timeout de 90s)        |    |
|    | -> Reautenticación por PIN para operaciones críticas         |    |
|    +-------------------------------------------------------------+    |
+-----------------------------------------------------------------------+
```

1. **Identidad de Dispositivo (`TerminalToken`)**:
   - Cada dispositivo físico (tablet de mozos, PC de caja) se vincula a una entidad `Terminal` autorizada por el Manager.
   - El token de terminal viaja en los headers (`X-Terminal-Token`), identificando el punto de acceso físico y vinculándolo al `restaurantId`.
   - Si una tablet se extravía o se desvincula, el Manager revoca su `TerminalToken` desde el panel de Admin con efecto inmediato.
2. **Identidad de Operador (`StaffSession`)**:
   - Para interactuar, el mozo debe introducir su PIN personal de 4 a 6 dígitos numéricos.
   - **Timeout de inactividad estricto**: Tras 90 segundos sin actividad en pantalla, la sesión de operador caduca localmente y la interfaz vuelve a la pantalla de bloqueo de PIN, evitando que un mozo opere bajo la identidad de otro.
   - **PIN Challenge (Reautenticación obligatoria)**: Para operaciones de riesgo (cobro de mesa, anulación de comanda enviada a cocina, aplicación de descuentos o cierre forzado), la UI exige reintroducir el PIN del operador en el momento.
3. **Mecanismo de prevención de PINs duplicados por local**:
   - En la creación o modificación de usuarios (`POST /staff`, `PATCH /staff/:id/pin`), dentro de una transacción con lock a nivel de restaurante (`SELECT pg_advisory_xact_lock(hashtext('staff_pin_' || restaurantId))`), el servicio carga los hashes bcrypt de todos los usuarios activos del mismo restaurante.
   - Se ejecuta `bcrypt.compare(newPin, existingHash)` contra cada uno. Si se detecta colisión, la operación se rechaza con error tipado:
     `409 Conflict: { "code": "PIN_ALREADY_IN_USE", "message": "El PIN elegido ya está asignado a otro colaborador de este local" }`.
4. **Trazabilidad inmutable de actores**:
   - Todo registro de auditoría (`Order`, `Validation`, `Settlement`, `SessionClose`) extrae el `staffUserId` y `terminalId` **exclusivamente de los tokens verificados en middleware**, rechazando cualquier parámetro enviado en el cuerpo o query de la petición HTTP.

### 3.4 Sanitización universal de errores y manejo de excepciones

Queda terminantemente prohibido que cualquier excepción devuelva trazas de base de datos o mensajes internos al cliente.

1. **Respuestas 5xx opacas**:
   - Todo error no controlado captura la traza completa en los logs del servidor con `logger.error({ err, requestId, url })`.
   - La respuesta HTTP hacia el cliente debe ser invariablemente:
     ```json
     {
       "code": "INTERNAL_SERVER_ERROR",
       "message": "Ocurrió un error inesperado al procesar la solicitud",
       "requestId": "req_01HZX89ABC..."
     }
     ```
2. **Respuestas 4xx tipadas**:
   - Solo clases derivadas de `AppPublicError` con código de negocio aprobado (`INSUFFICIENT_PERMISSIONS`, `PIN_INVALID`, `SESSION_NOT_FOUND`, etc.) pueden exponer su mensaje al cliente.
3. **Procedimiento de verificación**:
   - Se ejecutará un análisis determinista con ripgrep para auditar todas las ocurrencias de `reply.send(` y `catch (err)` garantizando que ninguna exponga `err.message` crudo.

---

## 4. Matriz de rollback desacoplada y políticas de versión ($N / N-1$)

El rollback de un sistema en producción no puede concebirse como un "volver atrás" monolítico. Se desacopla en cuatro dimensiones operativas independientes:

```
                                  +---------------------------------------+
                                  |            DESPLIEGUE N               |
                                  +---------------------------------------+
                                     /          |             \         \
                                    /           |              \         \
+------------------------------------+  +---------------+  +--------+  +--------------------+
| A. Código (Vercel Serverless / UI) |  | B. Variables  |  | C. DNS |  | D. Base de Datos   |
| -> Instant Rollback a SHA N-1      |  | -> Env Restore|  | -> Dom |  | -> Migración N     |
|    (< 30 segundos)                 |  |    inmediato  |  |    pnt |  |    retrocompatible |
+------------------------------------+  +---------------+  +--------+  +--------------------+
                                                                                 |
                                                    La base N soporta            |
                                                    código N y código N-1 <------+
                                                    (Principio Expand & Contract)
```

| Capa | Mecanismo de Rollback | RTO estimado | Procedimiento formal |
|---|---|:---:|---|
| **A. Código (Frontends y API)** | Vercel Instant Rollback | $< 30\text{ s}$ | Reasignar el alias de producción al `deploymentId` del commit previo certificado ($N-1$) mediante Vercel CLI o panel. No requiere rebuild. |
| **B. Variables de Entorno** | Snapshots de variables por release | $< 2\text{ min}$ | Si un fallo radica en variables corruptas, restaurar el archivo de configuración `ENV-INVENTORY.md` del release anterior mediante script automatizado de sincronización. |
| **C. Dominios y Routing** | Conmutación de DNS / Vercel Aliases | $< 1\text{ min}$ | En caso de degradación de una zona, reasignar el dominio productivo a una instancia de contingencia precalentada. |
| **D. Base de Datos (PostgreSQL)** | **Compatibilidad aditiva $N / N-1$** | Inmediato | **Regla inquebrantable**: Toda migración SQL en producción debe ser de tipo *Expand & Contract*. Nunca se elimina ni renombra una columna en la misma release. Si el código se revierte a $N-1$, la base de datos migrada en $N$ continúa siendo 100% compatible sin necesidad de ejecutar rollback de schema DDL. |
| **D2. Corrupción de Datos catastrófica** | Supabase Point-in-Time Recovery (PITR) | $< 15\text{ min}$ | Solo aplicable ante corrupción lógica irreparable de datos. Requiere declarar el local en *Modo Contingencia Papel*, restaurar al timestamp previo al incidente sobre una base réplica, y conmutar el connection pooler. |

---

## 5. Gobernanza de despliegues y topología en Vercel y Supabase

### 5.1 Topología Vercel sin supuestos
Se relevará con precisión el estado de la cuenta de Vercel para alinear el monorepo a exactamente **4 proyectos canónicos**:
1. `mesaya-api`: Fastify Serverless Function (`api/index.ts`).
2. `mesaya-client`: SPA Vite comensal (optimizada para móviles con PWA light).
3. `mesaya-staff`: SPA Vite mozos/cocina (orientada a tablets y pantallas táctiles).
4. `mesaya-admin`: SPA Vite gerencia/caja (panel de administración y métricas).

*Regla de exclusión*: Si se detecta un 5º proyecto legado en Vercel, se procederá a desvincular sus dominios, desactivar su trigger de GitHub y marcarlo como `DEPRECATED_ISOLATED`.

### 5.2 Conexiones y Hardening en Supabase
- **Rutas de conexión**:
  - `DATABASE_URL`: Conexión directa a través del **Transaction Pooler** (puerto 6543 / Supavisor) para la API Fastify en Vercel, limitando el pool a 10-15 conexiones para evitar agotamiento bajo ráfagas.
  - `DIRECT_URL`: Conexión de sesión directa (puerto 5432) utilizada **única y exclusivamente** para la ejecución del workflow de migraciones (`prisma migrate deploy`).
- **Data API y RLS**:
  - Dado que la arquitectura de MesaYA canaliza todo el tráfico mediante la API Fastify con Prisma ORM, la **Data API (PostgREST) de Supabase debe ser desactivada** o bloqueada completamente mediante script SQL de hardening revocando permisos a los roles `anon` y `authenticated` sobre el schema `public`:
    ```sql
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ```
  - Se incluirá una prueba negativa automatizada que intente acceder a la URL de Supabase con la API Key anónima, verificando que responda `403 Forbidden` o `404 Not Found`.

### 5.3 Workflow de migración de base de datos en producción
La ejecución de migraciones en la base de datos de producción seguirá el siguiente pipeline estricto:
1. **Verificación de SHA**: El pipeline confirma que el commit a migrar coincide bit a bit con el SHA auditado y aprobado en Staging.
2. **Snapshot previo garantizado**: Verificación de existencia de backup reciente en Supabase antes de emitir cualquier comando DDL.
3. **Exclusión mutua distribuida**: Envolver `prisma migrate deploy` en un script con advisory lock:
   ```sql
   SELECT pg_advisory_lock(hashtext('mesaya_production_migration_lock'));
   ```
4. **Timeouts acotados**: Establecer `SET statement_timeout = '60s';` y `SET lock_timeout = '10s';` para abortar la migración si una tabla de salón está bloqueada, protegiendo la disponibilidad.
5. **Smoke test post-migración**: Ejecución inmediata de consultas read-only de validación de schema y conteo de tablas críticas.

---

## 6. Higiene de secretos y variables de entorno

- **Prohibición absoluta de exposición de secretos**: Queda terminantemente prohibido imprimir o almacenar contraseñas, connection strings, JWT secrets o API keys en la consola de CI/CD, logs de aplicación o documentos de auditoría.
- **Prohibición de almacenamiento de hashes de secretos**: No se registrarán hashes SHA-256 ni MD5 de los secretos en ningún documento, dado que secretos de baja entropía son susceptibles de ataques de pre-imagen o rainbow tables.
- **Inventario canónico de variables (`ENV-INVENTORY.md`)**:
  Documentará únicamente la presencia y alcance de cada variable requerida:
  - `KEY_NAME`: Nombre de la variable (ej. `DATABASE_URL`, `JWT_SECRET`, `VITE_CLIENT_WEB_URL`).
  - `TARGET`: Ámbito de ejecución (`API Serverless`, `Frontend Build-time`).
  - `ENVIRONMENT`: Entorno asignado (`Production`, `Preview`, `Local`).
  - `STATUS`: Estado de configuración verificado (`CONFIGURED` / `MISSING`).
  - `CLASSIFICATION`: Clasificación de seguridad (`SECRET_REDACTED` o `PUBLIC_BUILD_ARG`).

---

## 7. Plan de pruebas, perfil de carga y ensayo físico

### 7.1 Perfil de carga reproducible para el piloto (k6 / Artillery)

El dimensionamiento para el piloto de 4 mesas en un turno de alta concurrencia gastronómica se modelará con un script ejecutable en `tests/load/pilot-profile.js`:

```
+-------------------------------------------------------------------------------+
| CARGA CONCURRENTE MODELADA:                                                   |
| - 16 Comensales activos (4 mesas x 4 clientes): Polling cada 4s               |
| - 2 Mozos en salón: Polling continuo cada 2.5s                                |
| - 1 Puesto de cocina: Polling de comandas cada 2s                             |
| - 1 Terminal de caja / Admin: Polling de estados cada 5s                      |
|                                                                               |
| TASA RESULTANTE EN RÉGIMEN:                                                   |
| ~ 6.5 a 8 peticiones HTTP por segundo sostenidas                              |
| Ráfagas de concurrencia: 4 pedidos simultáneos y 2 cierres de cuenta          |
+-------------------------------------------------------------------------------+
```

**Métricas y SLAs obligatorios de aprobación**:
- Latencia en lecturas (polling): $p_{50} < 200\text{ ms}$, $p_{95} < 600\text{ ms}$, $p_{99} < 1200\text{ ms}$.
- Latencia en mutaciones críticas (crear pedido, cobrar): $p_{95} < 800\text{ ms}$.
- Tasa de errores HTTP 5xx: **0.00%**.
- Conexiones concurrentes activas en PostgreSQL (PgBouncer): $\le 8$ conexiones.
- Cero fugas de memoria en la función serverless bajo ejecución sostenida de 20 minutos.

### 7.2 Ensayo operacional completo (Dry Run $T-24\text{ h}$) y verificación pre-servicio ($T-60\text{ m}$)

1. **Jornada previa ($T-24\text{ h}$)**:
   - Prueba operativa de 90 minutos en el restaurante fuera del horario comercial.
   - Conexión de todo el hardware asignado al Wi-Fi del salón: tablet de mozos, tablet/PC de caja, y 4 teléfonos móviles reales (2 Android, 2 iPhone) en las mesas.
   - Ejecución del ciclo de vida completo sobre las 4 mesas:
     1. Escaneo de QR físico impreso.
     2. Carga de comanda comensal con notas y alérgenos (`celíaca`, `sin TACC`).
     3. Validación por mozo en tablet de salón.
     4. Preparación y despacho en cocina.
     5. Solicitud de cuenta, registro de propina y cobro simulado en efectivo y tarjeta.
     6. Emisión e impresión de ticket en impresora térmica física.
     7. Cierre de mesa, transición a `TO_CLEAN`, limpieza y reocupación de mesa.
2. **Chequeo pre-servicio ($T-60\text{ m}$)**:
   - Verificación de estado de salud del API (`GET /api/health`).
   - Confirmación de SHA desplegado en producción contra el release manifest.
   - Prueba de escaneo de los códigos QR definitivos pegados en las mesas 1 a 4.
   - Verificación del stock de papel en la impresora térmica y batería en las tablets.

---

## 8. Protocolo humano de aborto y fallback manual (Contingencia en papel)

### 8.1 Doble autoridad y veto unilateral de aborto

El sistema no impone una decisión automática sobre la operación humana del local. Se establecen dos roles con autoridad de mando:

1. **Lead Técnico (Rodrigo)**: Máxima autoridad sobre la integridad técnica, seguridad, base de datos y coherencia del sistema.
2. **Operador Local / Encargado de Salón**: Máxima autoridad sobre la atención a los clientes, ritmo del servicio y reputación del local.

> **Principio de Veto Unilateral**: **Cualquiera de los dos roles tiene la facultad y potestad de declarar el ABORTO INMEDIATO del piloto técnico sin necesidad de consenso.** Si el Lead Técnico detecta anomalías en base de datos, o si el Encargado del salón percibe demoras o incomodidad en los clientes, se declara el cese del sistema digital y la transición a papel.

### 8.2 Condiciones taxativas de aborto técnico obligatorio
Se declarará **ABORT INMEDIATO** si se produce cualquiera de los siguientes eventos:
- Cualquier discrepancia numérica entre el consumo sumado, el cobro registrado o el ticket impreso ($|\Delta| > 0$).
- Pérdida de un pedido o duplicación de comandas en cocina.
- Fuga de datos o cruce de sesiones entre diferentes mesas.
- Incapacidad de identificar qué mozo realizó una acción sensible en el salón.
- Error HTTP 5xx al intentar cobrar una mesa o asentar un recibo.
- Más de tres errores 500 no recuperados en una ventana de 15 minutos.
- Imposibilidad de restablecer la conectividad de las tablets tras 5 minutos de fallo continuo.

### 8.3 Kit de contingencia y procedimiento de Fallback Manual
El restaurante dispondrá previamente en el mostrador de caja y puestos de mozo del siguiente kit físico preparado:
- Talonarios de comandas de papel autocopiativas pre-numeradas.
- Lapiceras para todos los mozos.
- Calculadora de mesa tradicional en caja.
- Carteles amigables para colocar en los atriles QR de las mesas: *"Mesa habilitada para atención personalizada por nuestro equipo de salón"*.

**Secuencia de activación de contingencia ($< 60\text{ segundos}$)**:
1. El Encargado o Lead Técnico anuncia en voz alta al equipo: *"Pasamos a comanda manual en papel"*.
2. El Lead Técnico conmute desde el Admin el switch global `MODO_CONTINGENCIA_ACTIVADO`, lo cual hace que los clientes que escaneen el QR vean una pantalla informativa: *"En este momento te atenderemos personalmente en tu mesa"*.
3. Los mozos toman las comandas en papel para los nuevos comensales.
4. Para las mesas que ya estaban comiendo y tenían consumos registrados en el sistema, la tablet de caja o el Admin permite descargar o consultar el balance actual para cobrarles con normalidad sin perder la cuenta previa.
5. El sistema digital permanece en modo **Read-Only** para auditoría forense posterior; no se ejecutan correcciones de código improvisadas durante el servicio.

---

## 9. Ruta crítica y etapas de ejecución reordenadas (E00 a E14)

El nuevo ordenamiento subsana las dependencias temporales previas: la observabilidad se implementa antes de validar Staging, y la certificación de nube precede estrictamente al ensayo físico y la decisión GO.

```
[E00: Congelación y Baseline]
       │
[E01: Contratos Canónicos e Invariantes]
       │
[E02: Fastify 5 / Node 22 / Cero CVEs]
       │
[E03: Integridad Monetaria y Transacciones] ──┬── [E04: Identidad Staff, PIN y Errores]
                                             │
[E05: Frontends, QR Canónico, Acentos y Timezone]
       │
[E06: Observabilidad Estructurada JSON y Logging Seguro]
       │
[E07: Regresión Local, Handler Serverless y E2E Playwright]
       │
[E08: Supabase: Migraciones, Hardening y Restore de Backup]
       │
[E09: Vercel: Relevamiento Real y 4 Artefactos Canónicos]
       │
[E10: Staging Cloud Integrado y Test de Carga k6]
       │
[E11: Ensayo Físico en Local (T-24h y T-60m) + Fallback Papel]
       │
[E12: Revisión Independiente y Dictamen Formal GO/NO-GO]
       │
[E13: Jornada Piloto en Salón en Vivo (4 Mesas)]
       │
[E14: Conciliación Post-Servicio y Plan de Escalamiento]
```

### Detalle operativo por etapa

#### E00 — Congelación, inventario de baseline y ramas
- Preservar el árbol de trabajo actual; asegurar que los archivos sin seguimiento (`.tmp/`, screenshots) no contaminen git.
- Crear rama limpia de release: `release/pilot-1day-v1.0.0`.
- Documentar en `CONTROL-PILOTO.md` el estado inicial de cada uno de los 11 hallazgos.
- *Gate E00*: Árbol git limpio, SHA de partida fijado, y cero secretos o artefactos locales en seguimiento.

#### E01 — Especificación de contratos canónicos de dominio
- Formalizar en código (`packages/shared/src/contracts/`) los tipos inmutables de:
  - Cómputo de comanda (`computa(order)`).
  - Balance de sesión (`TableSessionAccount`) con operaciones de `minor units`.
  - Contrato de error público (`AppPublicError`, `PublicErrorPayload`).
  - Identidad compuesta (`TerminalContext`, `StaffOperatorContext`).
- *Gate E01*: Módulo de tipos y funciones puras de cálculo monetario con 100% de cobertura de pruebas unitarias cubriendo todos los casos de borde (descuentos mayores al consumo, redondeos, propinas cero, anulaciones).

#### E02 — Compatibilidad y seguridad de dependencias (Fastify 5 / Node 22)
- Actualizar dependencias de API a Fastify 5.x y plugins compatibles (`@fastify/jwt`, `@fastify/cors`, etc.).
- Migrar validaciones de rutas: convertir shorthands deprecados de Fastify 4 a JSON Schema estándar.
- Ejecutar `npm audit --omit=dev` y verificar **0 vulnerabilidades**.
- *Gate E02*: `npm ci` y build limpios en Node 22; suite de integración de Fastify 5 aprobada; cero alertas de seguridad de dependencias.

#### E03 — Núcleo de integridad monetaria y transacciones en API
- Refactorizar endpoints de comandas, validación de mozos y cobro (`/orders`, `/validate`, `/settle`) para utilizar `calculateCanonicalSessionAccount`.
- Asegurar que la aceptación de una orden `PENDING_VALIDATION` recalcula y persiste atómicamente sus totales dentro de la transacción Prisma.
- Implementar script idempotente de migración de datos/backfill para sanear registros históricos en la base de datos.
- *Gate E03*: Pruebas de integración sobre PostgreSQL demostrando:
  - $\sum \text{items} = \text{order.totalAmountMinor} = \text{receipt.totalAmountMinor} = \text{report.salesMinor}$.
  - Concurrencia de múltiples comensales pidiendo a la vez sin discrepancias contables.

#### E04 — Identidad de terminal, PINs de mozo y sanitización de errores
- Implementar validación de unicidad de PINs por restaurante mediante `bcrypt.compare` con lock transaccional.
- Modificar endpoint de autenticación de Staff para soportar y validar longitud de 4 a 6 dígitos numéricos.
- Configurar middleware de inyección de contexto de terminal y mozo en cada mutación sensible.
- Reemplazar todas las capturas de error que exponen `err.message` por el Error Handler centralizado de Fastify con respuesta 500 opaca y emisión de `requestId`.
- *Gate E04*: Ninguna llamada errónea o payload malicioso logra exponer nombres de tablas o trazas internas; rechazo comprobado de PIN duplicado.

#### E05 — Frontends, QR canónico, normalización de texto y zonas horarias
- Corregir `SalesManager.tsx` en Admin para navegar a la pestaña de tickets automáticamente tras "Ver ticket".
- Unificar la generación de URLs de QR en `packages/shared` utilizando la ruta canónica `/r/<slug>/mesa/<label>` con validación estricta de `VITE_CLIENT_WEB_URL`.
- Implementar renderizado de QR mediante librería local SVG/Canvas (eliminando dependencias de APIs externas de QR).
- Normalizar texto de platos y notas con Unicode NFD para detección infalible de alérgenos (`alérgica`, `celíaco`, etc.).
- Corregir cálculo de cortes de caja para respetar la zona horaria del local (`America/Argentina/Buenos_Aires`).
- *Gate E05*: Pruebas de frontend en Playwright verificando navegación de tickets, renderizado de QR local y alerta correcta de celiaquía.

#### E06 — Observabilidad estructurada y sanitización de logs
- Configurar logger Pino para emitir JSON estructurado con `requestId`, `correlationId`, `restaurantId`, `terminalId`, `staffUserId`, `durationMs` y `action`.
- Implementar redactor automático de datos sensibles (ocultar campos `pin`, `password`, `token`, `authorization`, `creditCard`).
- Probar la correlación de un flujo completo: comensal pide $\to$ mozo valida $\to$ caja cobra, compartiendo el mismo `correlationId` a través de los logs.
- *Gate E06*: Generación de logs estructurados validada; verificación de que ningún log contiene secretos o números de PIN planos.

#### E07 — Suite de regresión automatizada y contrato Serverless
- Implementar pruebas de integración que invoquen directamente el handler serverless de `api/index.ts` emulando las peticiones de Vercel.
- Cubrir cold start, warm reuse, CORS con dominios autorizados, y respuestas ante caída simulada de base de datos.
- Ejecutar suite E2E completa en local (Client, Staff, Admin) con headless browsers.
- *Gate E07*: 100% de tests unitarios, de integración y E2E pasando limpiamente en dos ejecuciones consecutivas independientes.

#### E08 — Base de datos Supabase: migraciones, hardening y restore
- Aplicar `prisma migrate deploy` en el proyecto PostgreSQL asignado a la release.
- Ejecutar script SQL de revocación de permisos a roles `anon` y `authenticated` y desactivar Data API.
- Simular procedimiento de desastre: realizar backup de la base, restaurarlo en una base de datos aislada, y validar la integridad contable de los datos restaurados.
- Medir los tiempos reales de recuperación ($RTO < 15\text{ min}$, $RPO = 0$).
- *Gate E08*: 23+ migraciones aplicadas sin drift; acceso no autorizado a Supabase bloqueado con 403; restore verificado y documentado en `BACKUP-RESTORE-PROOF.md`.

#### E09 — Infraestructura Vercel: relevamiento real y 4 artefactos canónicos
- Ejecutar relevamiento de la cuenta Vercel y asociar los 4 proyectos canónicos (`mesaya-api`, `mesaya-client`, `mesaya-staff`, `mesaya-admin`).
- Configurar variables de entorno productivas en cada proyecto (sin exponer valores en logs).
- Generar despliegue de Staging a partir del commit exacto de release y obtener los 4 `deploymentId`.
- *Gate E09*: 4 despliegues en estado `READY` generados desde el mismo SHA, con dominios preview configurados y sin proyectos huérfanos.

#### E10 — Verificación en Staging integrado y prueba de carga k6
- Ejecutar la suite E2E de navegador apuntando a los entornos reales desplegados en Vercel y conectados a Supabase.
- Ejecutar el script de carga k6 (`tests/load/pilot-profile.js`) simulando el tráfico de 4 mesas sostenido durante 15 minutos.
- Monitorear latencias, uso de conexiones en PgBouncer y logs en tiempo real.
- *Gate E10*: Cero errores 5xx bajo carga; latencias dentro de los SLAs fijados ($p_{95} < 800\text{ ms}$); conciliación contable perfecta al finalizar la carga.

#### E11 — Ensayo físico en el local ($T-24\text{ h}$ y $T-60\text{ m}$) y simulacro de papel
- Realizar el ensayo general de 90 minutos en el restaurante el día previo con todo el hardware real y la red Wi-Fi del salón.
- Ensayar la impresión de tickets con la impresora térmica física.
- **Simulacro de Contingencia**: Provocar una desconexión intencional de red y practicar la transición del equipo al uso de talonarios de papel en menos de 60 segundos.
- *Gate E11*: Checklist físico firmado en `PHYSICAL-ACCEPTANCE.md`; equipo de mozos y encargado capacitados y cómodos con el flujo digital y el flujo de contingencia en papel.

#### E12 — Revisión independiente y dictamen formal GO / NO-GO
- Auditoría final de cierre:
  - Diff total de código respecto al baseline.
  - Verificación de ausencia de secretos en el repositorio y artefactos.
  - Revisión de pruebas de backup, carga y ensayo físico.
- Verificación de firmas de autorización de ambos roles responsables.
- *Gate E12*: Declaración formal `GO_PILOT` emitida exclusivamente por Rodrigo y el Encargado del Salón. Release promovida a Producción asignando los dominios canónicos.

#### E13 — Jornada de piloto en salón en vivo
- Operación de 4 mesas durante un turno gastronómico real bajo monitoreo técnico pasivo.
- Registro continuo de métricas operativas y observación del comportamiento de mozos y comensales.
- Aplicación de criterios de aborto si se manifiesta alguna condición de parada.
- *Gate E13*: Jornada completada con éxito; cero incidentes bloqueantes; cierre formal de turno y arqueo de caja sin diferencias.

#### E14 — Conciliación post-servicio y plan de escalamiento
- Conciliación matemática definitiva: suma de tickets emitidos contra recaudación física en caja y reportes de base de datos.
- Inspección de logs de la jornada confirmando ausencia total de errores 5xx no controlados o filtración de datos sensibles.
- Emisión del reporte final de lecciones aprendidas y dictamen de habilitación para próximas fases comerciales.
- *Gate E14*: Reporte `POST-PILOT-AUDIT.md` aprobado y archivado; backlog de mejoras no críticas priorizado para la siguiente iteración.

---

## 10. Artefactos documentales y evidencias obligatorias

Para dar por cerrada cada etapa se requerirá la presencia física y versionada de los siguientes archivos en `docs/produccion/evidencias/`:

1. `CONTROL-PILOTO.md`: Tablero de control de los 11 hallazgos, con estado (`OPEN`, `IN_PROGRESS`, `VERIFIED_LOCAL`, `VERIFIED_STAGING`, `CLOSED`), responsable y enlace al test que lo valida.
2. `RELEASE-MANIFEST.json`: Registro inmutable con SHA de git, versiones de dependencias, IDs de despliegue en Vercel, timestamp de migración Supabase y checksum de artefactos. Sin secretos.
3. `ENV-INVENTORY.md`: Tabla de nombres, scopes y presencia de variables de entorno requeridas por componente.
4. `DATA-AUDIT.json`: Evidencia del backfill y verificación contable: discrepancias encontradas (debe ser 0) y sumatorias cuadradas de líneas vs órdenes vs recibos.
5. `TEST-MATRIX.md`: Matriz de trazabilidad con cada historia de usuario, componentes involucrados, estado de ejecución y captura/log asociado.
6. `BACKUP-RESTORE-PROOF.md`: Registro de la prueba de desastre: tamaño de backup, tiempo de dump, tiempo de restauración sobre base réplica y verificación de lectura de datos.
7. `PHYSICAL-ACCEPTANCE.md`: Acta del ensayo en el local: modelos de dispositivos probados, estado de señal Wi-Fi en cada mesa, velocidad de impresión y firma del Encargado.
8. `INCIDENT-LOG.md`: Bitácora vacía lista para registrar cualquier evento anómalo con su `correlationId` y acción correctiva aplicada.
9. `GO-NO-GO.md`: Acta formal de liberación con las firmas de los responsables antes de habilitar el servicio al público.

---

## 11. Compromiso de ejecución

Este plan representa la especificación técnica definitiva para llevar MesaYA a su prueba de fuego en un restaurante real con absoluta seguridad operacional, contable y técnica.

- **Próximo paso**: Una vez aprobado formalmente este documento, se dará inicio a la ejecución disciplinada de las etapas **E00 y E01**, manteniendo el principio inquebrantable de no modificar configuraciones de nube ni realizar promociones en caliente sin la evidencia requerida por cada gate.
