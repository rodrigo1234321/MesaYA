# Reporte de etapa 00 — Baseline y contrato de producto

Estado: **NEEDS_REVIEW**  
Fecha: 2026-09-07  
Ficha: [Plan por etapas](../PLAN-POR-ETAPAS.md)  
Control: [CONTROL.md](../CONTROL.md)

## Alcance ejecutado

- Se tomó como fuente de trabajo el plan de producto base distribuible.
- Se fijó el modelo de un solo código fuente con instancias aisladas por restaurante.
- Se fijó el contrato de pantalla compartida con identidad de terminal y actor por acción.
- Se añadió la matriz de trazabilidad de todas las capacidades C/P/A/T.
- Se documentaron invariantes de tenant, actor, éxito confirmado, módulos y métricas.
- No se modificó código de aplicación, schema, variables, Supabase ni Vercel.

## Evidencia ejecutada

| Comando | Resultado |
|---|---|
| `npm run check:routes` | PASS — 77 rutas clasificadas, sin deriva |
| `npm run test:isolated` | NO EJECUTADO — el runner exige el adaptador Windows Job del repositorio |
| `npm run build` | NO EJECUTADO — el runner exige el adaptador Windows Job del repositorio |
| Inspección de branch/status | branch `antigravity/core-capabilities-stage00`; existen documentos no trackeados previos, preservados |
| Validación de enlaces del nuevo plan | PASS — enlaces locales resuelven |

El bloqueo del runner no se convirtió en PASS ni se sorteó ejecutando una ruta alternativa sin el supervisor indicado por el repositorio.

## Baseline verificable

- API: matriz de autorización consistente en el chequeo estático actual.
- Arquitectura: cuatro artefactos frontend/backend declarados y despliegue PostgreSQL/Supabase documentado.
- Provisioning: existe `scripts/bootstrap-restaurant.ts`, pero todavía no es una fábrica completa de instancia Vercel/Supabase.
- Staff: el cliente actual persiste una sesión de staff en `localStorage`; falta el modelo terminal compartido + actor por acción definido en esta etapa.
- Capacidades: la clasificación completa está en [MATRIZ-TRAZABILIDAD.md](../MATRIZ-TRAZABILIDAD.md).

## Pendientes bloqueantes para aprobar P00

1. Ejecutar build completo y suite aislada mediante el adaptador Windows Job del proyecto.
2. Revisar la matriz funcional con el responsable de producto.
3. Confirmar que el modelo de cuatro proyectos Vercel por instancia es el que se quiere operar comercialmente.
4. Mantener la etapa 01 cerrada hasta que esta revisión exista.

## Recomendación

Mantener P00 en `NEEDS_REVIEW`. No habilitar P01 ni ejecutar migraciones o despliegues remotos todavía.

