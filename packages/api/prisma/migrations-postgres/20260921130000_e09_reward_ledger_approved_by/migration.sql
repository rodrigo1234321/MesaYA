-- E09: Auditoría de operador / aprobador en RewardLedgerEntry.
-- Aditiva, nullable para histórico. Permite auditar qué mozo o encargado autorizó ajustes o canjes.
ALTER TABLE "RewardLedgerEntry" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
