-- Corrige concurrencia de tandas y preserva trazabilidad operativa.
-- Aditiva: no borra ni reescribe pedidos, tandas ni pagos existentes.

ALTER TABLE "TableSession" ADD COLUMN "nextTandaSeq" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "OrderTanda" ADD COLUMN "notes" TEXT;

-- Las visitas que ya tienen tandas continúan desde la siguiente secuencia.
UPDATE "TableSession" AS session
SET "nextTandaSeq" = COALESCE(
  (
    SELECT MAX(tanda."seq") + 1
    FROM "OrderTanda" AS tanda
    WHERE tanda."tableSessionId" = session."id"
  ),
  1
);
