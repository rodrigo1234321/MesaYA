# E24 — Diagnóstico de preparación de release

Fecha: 2026-09-16
Entrada: `9e4a4a06152cc3c068c4b6ee07ba717fae649fe4`
Alcance: lectura local, lectura remota Vercel, preflight PostgreSQL remoto y
preparación de un workflow de backup/restore; sin transferencia de datos,
migración ni deploy.

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

1. El preflight remoto confirmó conectividad, coincidencia de destino entre las
   dos URLs y presencia del historial Prisma/esquema núcleo, pero no reemplaza
   una migración ni el backup/restore.
2. No hay prueba S30 completa ejecutada en PostgreSQL: faltan herramientas
   locales y evidencia de backup/restauración aislada. Se preparó un
   `backup-drill` manual de alcance `public` que usaría un PostgreSQL efímero
   en GitHub y borraría el dump al terminar, pero sigue sin ejecutarse y no
   produce retención durable; el documento existente continúa siendo
   procedimiento/documentación, no evidencia suficiente del gate cloud actual.
3. El commit candidato está limpio y publicado. La lectura actual vinculó los
   deployment IDs productivos con sus SHAs fuente, pero todos son anteriores al
   candidato `9e4a4a0`; todavía falta publicar y verificar el candidato en los
   cuatro proyectos. El smoke baseline no sustituye esa verificación ni permite
   afirmar que los valores efectivos de variables sean correctos; no se
   descargaron valores completos.
4. La prueba k6 local de E22 usa SQLite aislada; no demuestra capacidad de
   producción, número de mesas, comportamiento del pooler ni límites reales.
5. E23 requiere observación presencial y sigue sin iniciar.
6. Documentos históricos discrepan en nombres de proyectos y en el conteo de
   migraciones; deben reconciliarse en el release candidate/staging, no por
   suposición.
7. El canal remoto de migración ya tiene los dos secretos explícitos y el
   preflight de sólo lectura pasó; el Environment `Production` no mostró reglas
   de protección. Vercel sí tiene secretos ocultos, pero no permite descargarlos.
   La lectura sí vinculó los cuatro deployments productivos actuales con SHAs
   anteriores al candidato. El workflow incluye un drill aislado preparado,
   pero no se ejecutó el drill, no se migró ni se modificó la base.

## Decisión

E24 queda preparada y verificada en alcance local/documental más preflight cloud
de sólo lectura. Aunque el usuario autorizó avanzar hacia producción, el estado
global de MesaYA sigue siendo `NO-GO` para producción, con `PENDING_CLOUD` y
`PENDING_HUMAN`, porque faltan backup/restore (el drill preparado aún no fue
autorizado ni ejecutado), migración, deployment trazable y E23. Ningún documento
de preparación ni preflight reemplaza S30 ni E23.
