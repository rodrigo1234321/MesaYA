-- B06: recibos de envío idempotente + clave de borrador único por sesión.
-- Todo aditivo y anulable: la historia existente queda intacta. Sin DROP, sin DELETE.
-- draftKey se deja NULL en historia (borradores viejos no se reclaman); solo los
-- borradores nuevos la portan. Un backfill ciego violaría la unicidad si una sesión
-- tuviera varios DRAFT históricos, por eso NO se rellena.

-- 1. Clave de borrador único en comandas (un solo carrito DRAFT por sesión).
ALTER TABLE "Order"
  ADD COLUMN "draftKey" TEXT;

-- 2. Tabla nueva de recibos de envío (una clave aceptada = una tanda).
CREATE TABLE "SubmitReceipt" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmitReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubmitReceipt_idempotencyKey_key"
  ON "SubmitReceipt"("idempotencyKey");
CREATE UNIQUE INDEX "Order_draftKey_key"
  ON "Order"("draftKey");
CREATE INDEX "SubmitReceipt_tableSessionId_createdAt_idx"
  ON "SubmitReceipt"("tableSessionId", "createdAt");

ALTER TABLE "SubmitReceipt"
  ADD CONSTRAINT "SubmitReceipt_tableSessionId_fkey"
  FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmitReceipt"
  ADD CONSTRAINT "SubmitReceipt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
