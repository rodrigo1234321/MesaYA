-- B06: serie de mutación por sesión para serializar escrituras de cuenta.
-- Aditiva: columna NOT NULL con DEFAULT (backfill inherente, re-ejecutable).
-- Sin DROP, sin DELETE. La historia queda en 0 y avanza solo con nuevas mutaciones.

ALTER TABLE "TableSession"
  ADD COLUMN "mutationSeq" INTEGER NOT NULL DEFAULT 0;
