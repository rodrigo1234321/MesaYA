# Revisión Codex — Etapa 19: Eliminar inyección de contenido en cliente

Fecha de revisión inicial: 2026-09-04 (-03:00)  
Veredicto final: **APPROVED**

## Hallazgo bloqueante

`sanitizeUrl` acepta cualquier cadena que empiece con `/` salvo `//`. En navegadores, una ruta con barra invertida como `/\\evil.example/x` se normaliza como URL protocol-relative y resuelve a `https://evil.example/x`; por lo tanto evade la validación declarada contra URLs protocol-relative. La prueba cubre `//evil.com`, pero no este bypass de normalización.

Además, la función acepta cualquier host `http:` o `https:`. Eso valida protocolo, pero no la política de dominios admitidos que exige expresamente el checklist para enlaces e imágenes. Los campos de branding, menú e IA son no confiables y hoy pueden forzar carga de cualquier host externo.

## Corrección requerida, sin iniciar la Etapa 20

- Endurecer `sanitizeUrl` tanto en `packages/shared/src/security.ts` como en la copia ejecutada por `apps/client-web/app.js`: rechazar barras invertidas y cualquier ruta que el navegador pueda canonicalizar como authority/protocol-relative. Validar mediante canonicalización URL, no sólo por prefijo textual.
- Definir y documentar una allowlist mínima de hosts externos que el cliente realmente admite (más rutas same-origin seguras); rechazar hosts arbitrarios, credenciales embebidas y puertos no permitidos. Preservar los recursos legítimos actualmente usados por el piloto.
- Agregar pruebas de regresión para `/\\evil.example/x` y variantes relevantes, host HTTPS no permitido, y host permitido/ruta same-origin. Verificar que ninguna URL rechazada llegue a `src` o `href` activo.
- Actualizar reporte, ejecutar build completo y `test:isolated` completo, verificar hash canónico de `dev.db`, dejar CONTROL con Etapa 19 en `NEEDS_REVIEW` y detenerse.

## Revisión de la corrección

La corrección ya cierra el bypass con barra invertida y aplica una allowlist explícita de hosts. Queda una discrepancia puntual con la política de puertos estándar: `sanitizeUrl` acepta `80` y `443` como conjunto sin relacionarlos con el protocolo. En consecuencia, permite `https://images.unsplash.com:80/...` y `http://images.unsplash.com:443/...`, que son puertos no estándar para esos respectivos esquemas.

## Corrección requerida adicional, sin iniciar la Etapa 20

- Hacer que la validación de puerto sea dependiente del protocolo: para `http:` permitir sólo puerto vacío o `80`; para `https:` sólo vacío o `443`. Mantener el mismo comportamiento en `packages/shared/src/security.ts` y `apps/client-web/app.js`.
- Agregar pruebas de regresión que rechacen específicamente `https` por `:80` y `http` por `:443`, además de conservar los casos válidos de cada esquema.
- Actualizar reporte, ejecutar build completo y `test:isolated` completo, verificar hash canónico de `dev.db`, dejar CONTROL con Etapa 19 en `NEEDS_REVIEW` y detenerse.

## Verificación final de la corrección

- `sanitizeUrl` ahora asocia puerto y esquema: sólo `80` para `http:` y `443` para `https:`, además de mantener la allowlist de hosts, la canonicalización de rutas locales y el rechazo de barras invertidas.
- La política se mantiene idéntica en la utilidad compartida y en el cliente que la ejecuta.
- La suite específica verifica los puertos cruzados, hosts no permitidos, bypasses de canonicalización y payloads XSS; la ejecución independiente aprobó **23/23** pruebas sobre SQLite efímera.
- Se revisó la evidencia de build completo y de `test:isolated` completo (**21/21** suites), con `dev.db` conservando el hash canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

No quedan hallazgos bloqueantes. La Etapa 19 se aprueba y queda habilitada únicamente la Etapa 20; no se inició su ejecución.
