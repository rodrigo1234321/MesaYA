# Dictamen Formal GO / NO-GO para Piloto de 1 Día — MesaYA (GATE-E12)

Fecha: 2026-09-14  
Versión: 2.1.0  
Rama auditada: `release/pilot-1day-v1.0.0`  
Entorno: Producción acotada (Trattoria del Puerto - Mesas 1 a 4)

---

## 1. Verificación de Criterios Bloqueantes (Zero-Tolerance Gates)

| Criterio | Requisito | Estado Auditado |
|---|---|:---:|
| **Núcleo Monetario (E03)** | Recálculo atómico de comandas en centavos minor; cero divergencia. | `APROBADO (100% local)` |
| **Seguridad y Vulnerabilidades (E02)** | `npm audit --omit=dev` sin vulnerabilidades en Fastify 5. | `APROBADO (0 vulns)` |
| **Identidad Staff, PIN concurrente y Sanitización (E04)** | PIN 4-6 dígitos con HMAC-SHA256 fingerprint en DB (P2002 race defense), bootstrap seguro, 0 fugas de `err.message` en 500 vía `sendSanitizedError`. | `APROBADO (100% local)` |
| **Frontends y Timezone (E05)** | Ver ticket directo, QR local sin APIs externas, alérgenos sin fallos por acentos, timezone IANA. | `APROBADO (100% local)` |
| **Observabilidad y Logging (E06)** | CorrelationId end-to-end, logs Pino JSON estructurados, campos sensibles redactados. | `APROBADO (100% local)` |
| **Serverless Handler Lifecycle (E07)** | Ejecución real de solicitudes HTTP con arranque en frío certificado. | `APROBADO (100% local)` |
| **Supabase Hardening & Backup (E08)** | Script SQL de hardening listo y protocolo de restore documentado. **Pendiente prueba de restore en vivo contra Supabase Cloud**. | `PENDIENTE CLOUD` |
| **Topología Vercel (E09)** | Documentación canónica lista. **Pendiente push a remoto y despliegue real en Vercel**. | `PENDIENTE CLOUD` |
| **Carga Concurrente (E10)** | Perfil k6 con endpoints de negocio reales (menú, sesión, workspace, ventas). | `APROBADO (Local)` |
| **Aceptación Física y Salón (E11)** | QRs acrílicos, Wi-Fi 20 dispositivos, tablets, comandas de papel. | `PENDIENTE SALÓN` |

---

## 2. Dictamen Oficial Conjunto

### Dictamen Técnico: **PASS_LOCAL TÉCNICO — NO-GO PARA PILOTO REAL**
- **Lead Técnico**: Rodrigo
- **Veredicto Técnico**:
  - `PASS_LOCAL`: La base de código local es robusta, 616 tests pasan (0 fallos), 0 vulnerabilidades npm, contratos de dominio verificados, PIN concurrente protegido en DB, y 100% de controladores de ruta sanitizados contra fugas 5xx.
  - `NO-GO PARA PILOTO REAL`: No se puede otorgar el GO a producción real hasta completar:
    1. Despliegue efectivo en Supabase Cloud y verificación del script de hardening `scripts/supabase-hardening.sql`.
    2. Simulacro de restauración (backup restore drill) en vivo contra base de datos PostgreSQL.
    3. Push de la rama `release/pilot-1day-v1.0.0` y despliegue certificado de los 4 proyectos en Vercel.
    4. Ensayo físico en salón con hardware real (tablets, impresoras, Wi-Fi).

### Dictamen Operativo: **CONDICIONADO A DESPLIEGUE CLOUD Y ENSAYO FÍSICO**
- **Encargado de Salón**: Jefe de Operaciones - Trattoria del Puerto
- **Declaración**: El personal y el salón están preparados con el kit de contingencia en papel, a la espera de la confirmación técnica del despliegue en la nube y el ensayo previo de hardware.

---

## 3. Resolución Final
El estado oficial del proyecto es:
**`PASS_LOCAL técnico — NO-GO para piloto real`**.

Se autoriza el avance a las tareas de despliegue remoto en staging/producción (Supabase y Vercel). Una vez validados los entornos remotos y el simulacro de restore, se emitirá el dictamen definitivo GO de servicio.
