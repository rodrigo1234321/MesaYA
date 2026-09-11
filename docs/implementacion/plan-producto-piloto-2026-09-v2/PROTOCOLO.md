# Protocolo de ejecución y revisión

## Regla principal

Una etapa por vez. El número de etapa no autoriza su ejecución: sólo `READY` en [CONTROL.md](CONTROL.md) lo hace.

## Inicio

1. Leer este protocolo, CONTROL, decisiones y únicamente la sección de la etapa activa.
2. Verificar rama/worktree y registrar cambios preexistentes.
3. Cambiar sólo la etapa activa a `IN_PROGRESS`.
4. Explicar alcance, archivos probables, riesgos y pruebas antes de editar.

## Implementación

- No ampliar la etapa en silencio; proponer subdivisión si excede una unidad revisable.
- No modificar Supabase real mediante seed, reset, push o migraciones de prueba.
- No usar un `.env` existente como autorización para tocar datos habituales.
- No desplegar, imprimir tags definitivos, procesar cobros ni contactar terceros sin autorización específica.
- Mantener compatibilidad hacia adelante entre API y clientes durante release.
- Para pagos, dinero nuevo se representa en unidades enteras mínimas, nunca `Float`.
- Para IA, pruebas automáticas no sustituyen la revisión humana del set.

## Evidencia

Cada reporte debe incluir:

- objetivo y checklist;
- archivos cambiados;
- pruebas y comandos exactos;
- resultados y evidencia visual;
- datos/entornos utilizados;
- no ejecutado y por qué;
- riesgos residuales;
- rollback;
- recomendación para revisión.

No marcar PASS por compilar, por recibir un error HTTP genérico, por un mock financiero o por una captura sin verificar persistencia.

## Final de etapa

El ejecutor deja la etapa en `NEEDS_REVIEW` y se detiene. La revisión devuelve `APPROVED` o `CHANGES_REQUESTED`; sólo al aprobar puede marcar la siguiente `READY`.

## Pausas humanas

- **P00:** aprobar alcance y decisiones.
- **P03 / PAUSA A:** validar operación completa y caja.
- **P05 / PAUSA B:** aceptar calidad del Sommelier o apagarlo.
- **P07 / PAUSA C:** GO/NO-GO del ensayo físico.
- **P08:** autorización explícita de promoción.
- **P09:** elegir expansión, continuación o cierre.

La aprobación técnica de P07 o P08 nunca equivale por sí sola a permiso de operar con clientes o dinero real.

