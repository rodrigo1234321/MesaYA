-- Etapa 09 fix: objetivo dirigido solicitado en PaymentTransaction para idempotencia simétrica.
-- Aditiva y posterior a 20260906010000 (ya consolidada): no reescribe la migración previa.
-- Nullable para pagos generales y filas históricas; sin FK para no bloquear borrados de ítems.

ALTER TABLE "PaymentTransaction" ADD COLUMN "requestedOrderItemId" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentTransaction_requestedOrderItemId_idx" ON "PaymentTransaction"("requestedOrderItemId");
