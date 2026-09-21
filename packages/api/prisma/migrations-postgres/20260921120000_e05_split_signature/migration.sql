-- E05: Firma normalizada de SplitOperation en AccountSettlement.
-- Aditiva, nullable para histórico/legacy (sin split). No rompe backfill ni idempotencia legada.
-- Formato canónico: FIXED:<amountMinor> | PERCENTAGE:<pct> | EQUAL_PARTS:<parts>:<partIndex>
-- Una misma idempotencyKey con split distinto debe responder 409 aunque el monto coincida,
-- por eso se persiste la firma y el replay compara firma + allocations + versión.
ALTER TABLE "AccountSettlement" ADD COLUMN IF NOT EXISTS "splitSignature" TEXT;
