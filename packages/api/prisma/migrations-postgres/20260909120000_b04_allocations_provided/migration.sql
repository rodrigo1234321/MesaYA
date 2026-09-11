-- Gate A (E00-E03/L2): presencia exacta de allocations en AccountSettlement.
-- Aditiva: columna NOT NULL con DEFAULT (backfill inherente, re-ejecutable).
-- Sin DROP, sin DELETE. Las filas legadas quedan en false (= camino FIFO sin
-- allocations explícito) y los replays comparan marca + contenido normalizado.
-- Reemplaza la marca auxiliar runtime SettlementIntentMeta (raw SQL eliminado).

ALTER TABLE "AccountSettlement"
  ADD COLUMN "allocationsProvided" BOOLEAN NOT NULL DEFAULT false;
