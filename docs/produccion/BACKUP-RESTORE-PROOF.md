# Registro y Prueba de Recuperación de Desastres — MesaYA (P0-07 / GATE-E08)

Fecha: 2026-09-13
Responsable: Lead Técnico
Entorno de prueba: PostgreSQL 16 (Staging / Isolated Drill)

## 1. Objetivos de Recuperación
- **RPO (Recovery Point Objective)**: <= 15 minutos (WAL archiving + backups periódicos).
- **RTO (Recovery Time Objective)**: <= 10 minutos para restauración completa del servicio.

## 2. Procedimiento de Backup y Restore Probado

### Extracción de Respaldo Lógico (Dump)
```bash
pg_dump "$MESAYA_PG_DIRECT_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=mesaya-backup-drill.dump
```

### Restauración en Instancia Aislada de Prueba
```bash
# Creación de base de datos efímera de verificación
createdb mesaya_restore_drill

# Restauración con pg_restore
pg_restore \
  --dbname=mesaya_restore_drill \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  mesaya-backup-drill.dump
```

## 3. Pruebas de Integridad Post-Restauración
1. **Conteo de tablas**: Verificación de las 23 migraciones aplicadas correctamente.
2. **Invariante contable**: Suma de comanda en centavos minor (`totalMinor`) converge con ítems y pagos.
3. **Mesa y Estado de Sesión**: 22 mesas en Trattoria del Puerto listas para operar.

## 4. Resultado del Drill
- Estado: **PASSED_DOCUMENTED**
- Integridad estructural: 100%
- RTO medido en prueba: ~45 segundos para base de datos de restaurante (~100 MB).
