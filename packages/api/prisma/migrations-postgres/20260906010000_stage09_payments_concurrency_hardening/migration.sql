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
