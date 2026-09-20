-- E15: contador atómico de tickets por local/período para unicidad bajo concurrencia.
-- Se inicializa por aplicación sobre el máximo existente (ver ReceiptService);
-- esta migración sólo garantiza tabla, unicidad e integridad referencial.
CREATE TABLE IF NOT EXISTS "ReceiptCounter" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptCounter_restaurantId_period_key"
  ON "ReceiptCounter"("restaurantId", "period");
CREATE INDEX IF NOT EXISTS "ReceiptCounter_restaurantId_updatedAt_idx"
  ON "ReceiptCounter"("restaurantId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "ReceiptCounter"
    ADD CONSTRAINT "ReceiptCounter_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
