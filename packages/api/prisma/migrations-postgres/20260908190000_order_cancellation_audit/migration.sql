-- C05: motivo y actor de rechazo/cancelación de una tanda.
-- Todo aditivo y anulable para conservar órdenes históricas anteriores.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
