-- C05: motivo y actor de rechazo/cancelación de una tanda.
-- Todo aditivo y anulable para conservar órdenes históricas anteriores.
ALTER TABLE "Order"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancelledBy" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);
