-- Etapa 09: Serialización de cobros concurrentes y trazabilidad de participante / reversión
-- Aditiva: preserva transacciones contables previas y compatibilidad retroactiva

ALTER TABLE "TableSession" ADD COLUMN "paymentSeq" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PaymentTransaction" ADD COLUMN "participantId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "reversalReason" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "reversalStaffId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "reversalAt" TIMESTAMP(3);

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "VisitParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "PaymentTransaction_participantId_idx" ON "PaymentTransaction"("participantId");

-- Asignaciones contables granulares por ítem / participante
CREATE TABLE IF NOT EXISTS "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentAllocation_paymentTransactionId_idx" ON "PaymentAllocation"("paymentTransactionId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_orderItemId_idx" ON "PaymentAllocation"("orderItemId");

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentTransactionId_fkey"
  FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
