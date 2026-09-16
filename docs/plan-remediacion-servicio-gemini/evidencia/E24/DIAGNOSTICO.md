# E24 — Diagnóstico de preparación de release

Fecha: 2026-09-16
Entrada: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`
Alcance: lectura local y lectura remota Vercel; sin mutaciones.

## Lo que está bien

- Hay una separación explícita entre build productivo PostgreSQL, migración
  manual y CI. El workflow CI no ejecuta seed ni bases reales.
- El script de migración exige dos URLs PostgreSQL explícitas y rechaza usar
  las variables de runtime como fallback.
- Existe manifiesto de instancia sin secretos, validador de HTTPS en modo
  producción y plan de provisioning marcado `PLAN_ONLY`.
- Existe hardening SQL de Supabase, runbook de piloto, fallback en papel y una
  matriz de rollback que separa código, variables, dominio, schema y datos.
- El perfil E22 tiene límites y preflight fail-closed, y sus summaries locales
  conservan métricas sin tokens después de la sanitización documentada.
- La lectura Vercel confirmó cuatro proyectos reales, sus roots, Node 22 y
  deployments Ready visibles, sin que se modificara la cuenta.
- El smoke HTTP remoto de baseline confirmó health y las tres SPAs en 200 y
  CORS explícito para las tres origins; una origin no autorizada fue rechazada.

## Falencias/bloqueos reales

1. No hay commit limpio de release; el worktree conserva cambios de muchas
   etapas. No puede declararse un artefacto desplegable.
2. No hay prueba S30 ejecutada en PostgreSQL: faltan herramientas y entorno
   autorizado. El documento existente de backup es procedimiento/documentación,
   no evidencia suficiente del gate cloud actual.
3. Los deployment IDs visibles están registrados, pero no hay mapping probado
   entre ellos, su SHA fuente y este candidato. El smoke baseline no sustituye
   la verificación del candidato ni permite afirmar que los valores efectivos de
   variables sean correctos; no se descargaron valores completos.
4. La prueba k6 local de E22 usa SQLite aislada; no demuestra capacidad de
   producción, número de mesas, comportamiento del pooler ni límites reales.
5. E23 requiere observación presencial y sigue sin iniciar.
6. Documentos históricos discrepan en nombres de proyectos y en el conteo de
   migraciones; deben reconciliarse en el release candidate/staging, no por
   suposición.
7. El canal remoto de migración no está listo para ejecución demostrable:
   `release-migrate.yml` requiere dos secretos explícitos, el Environment
   `Production` no mostró reglas de protección y `gh secret list` no devolvió
   nombres para repo/environment; la consulta REST confirmó `total_count=0` con
   permisos administrativos. Vercel sí tiene secretos ocultos, pero no permite
   descargarlos. No se consultó ni modificó la base.

## Decisión

E24 queda preparada y verificada sólo en el alcance local/documental. Aunque el
usuario autorizó avanzar hacia producción, el estado global de MesaYA sigue
siendo `NO-GO` para producción, con `PENDING_CLOUD` y `PENDING_HUMAN`, porque
faltan canal seguro de migración, backup/restore y SHA trazable. Ningún documento
de preparación reemplaza S30 ni E23.
