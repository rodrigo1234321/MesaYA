# Control de remediación

Base: 7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83. E00–E21 tienen trabajo local
documentado; los gates humanos/cloud permanecen separados.

Las fichas se habilitan en orden al solicitar su ejecución; no hay
aprobaciones prefabricadas. Dependencias locales deben pasar; gates
humanos/cloud quedan pendientes cuando faltan medios.

| Ficha | Resultado | Dependencia | Estado |
|---|---|---|---|
| [E00](etapas/E00.md) | Baseline y reproducción del informe | Ninguna | VERIFIED_LOCAL |
| [E01](etapas/E01.md) | Contrato de tareas y permisos de salón | E00 | VERIFIED_LOCAL |
| [E02](etapas/E02.md) | Prototipo de Atención y prueba temprana | E01 | VERIFIED_LOCAL |
| [E03](etapas/E03.md) | Migraciones reproducibles de PIN | E00; E01 | VERIFIED_LOCAL |
| [E04](etapas/E04.md) | Rotación de huella de PIN y legado | E03 | VERIFIED_LOCAL |
| [E05](etapas/E05.md) | Login fluido y límite de abuso correcto | E03/E04 | VERIFIED_LOCAL |
| [E06](etapas/E06.md) | Backend de puesto, operador y autorización temporal | E01/E03/E05 | VERIFIED_LOCAL |
| [E07](etapas/E07.md) | Cambio de operador sin perder la pantalla | E06 | VERIFIED_LOCAL |
| [E08](etapas/E08.md) | Sincronización única y avisos permanentes | E06/E07 | VERIFIED_LOCAL |
| [E09](etapas/E09.md) | Portada Atención y lista estable | E02/E08 | VERIFIED_LOCAL |
| [E10](etapas/E10.md) | Detalle de mesa y acciones correctas | E09 | VERIFIED_LOCAL |
| [E11](etapas/E11.md) | Tablet vertical, mouse y accesibilidad | E09/E10 | VERIFIED_LOCAL |
| [E12](etapas/E12.md) | Permiso específico de cobro en efectivo | E06/E10 | VERIFIED_LOCAL |
| [E13](etapas/E13.md) | Flujo de cuenta y cobro contextual | E10/E11/E12 | VERIFIED_LOCAL |
| [E14](etapas/E14.md) | Cocina usable en el segundo puesto | E06/E08/E10 | VERIFIED_LOCAL |
| [E15](etapas/E15.md) | Recibos atómicos y recuperables | E03/E13 | VERIFIED_LOCAL |
| [E16](etapas/E16.md) | Reportes por cobro, venta y jornada | E15 | VERIFIED_LOCAL |
| [E17](etapas/E17.md) | Carrito cliente resistente a doble acción | E00; E10 | VERIFIED_LOCAL |
| [E18](etapas/E18.md) | Admin accesible y coordinación preservando Ventas | E12/E16 | VERIFIED_LOCAL |
| [E19](etapas/E19.md) | Carta: filtros e información alimentaria fiable | E17/E18 | VERIFIED_LOCAL |
| [E20](etapas/E20.md) | Comanda, impresión y operación con un equipo | E14/E15 | VERIFIED_LOCAL |
| [E21](etapas/E21.md) | Regresión de seguridad y recorrido completo | E03–E20 | VERIFIED_LOCAL |
| [E22](etapas/E22.md) | Carga funcional y saturación del puesto | E21 | VERIFIED_LOCAL |
| [E23](etapas/E23.md) | Ensayo con mozos y equipos reales | E21/E22; personas/equipos disponibles | NOT_STARTED |
| [E24](etapas/E24.md) | Paquete de puesta en producción y pendientes externos | E21–E23; puede preparar documentación con gates pendientes | VERIFIED_LOCAL |

`VERIFIED_LOCAL` en E22 cubre el perfil fail-closed, sus verificaciones de
código y dos corridas k6 contra una SQLite local nueva y aislada, incluida una
corrida con flujo mutante y conciliación. No equivale a certificar capacidad de
producción: la repetición en staging/cloud aislado queda `PENDING_CLOUD` y la
observación con mozos/equipos queda `PENDING_HUMAN`. E23 sigue sin habilitarse
sin personas/equipos; E24 se habilitó sólo en su modalidad permitida de
preparación documental y mantiene esos gates separados.

`VERIFIED_LOCAL` en E24 cubre el paquete revisable, el inventario local y la
consulta Vercel de sólo lectura. No certifica el SHA desplegado, el backup/
restore, la base PostgreSQL, el dominio, los valores de configuración ni el
GO operativo; esos puntos permanecen `PENDING_CLOUD` o `PENDING_HUMAN`.

## Plantilla de reporte

- Ficha y alcance autorizado.
- SHA de entrada/salida y estado del árbol.
- Problema reproducido / hipótesis descartada / decisión de producto.
- Archivos modificados y motivo.
- Fixture/entorno, comandos, exit codes y resultado esperado/observado.
- Evidencia del flujo real, métricas UX cuando corresponda.
- Revisión: autorrevisión o revisor identificado; nunca independencia inventada.
- Gate: IMPLEMENTED_NEEDS_REVIEW / VERIFIED_LOCAL / FAILED / BLOCKED / PENDING_HUMAN / PENDING_CLOUD.
- Hallazgos residuales y próxima acción exacta.

## Control de alcance

H01–H15 y D01–D12 mantienen un ID de origen aunque su explicación se corrija. Cada hallazgo termina como corregido y verificado, descartado con prueba, alcance condicionado explícito o pendiente bloqueante. No borrar pendientes para declarar 100%.
