-- B04: liquidaciones de cuenta por sesión (C4) + columnas minor-unit aditivas (C3).
-- Todo aditivo y anulable: la historia Float legada queda intacta y el backfill solo
-- rellena donde el destino es NULL. Sin DROP, sin DELETE, sin reescritura.

-- 1. Columnas minor-unit en modelos existentes (lectura futura; B04 escribe solo tablas nuevas).
ALTER TABLE "MenuItem"
  ADD COLUMN "priceMinor" INTEGER;
ALTER TABLE "Order"
  ADD COLUMN "totalAmountMinor" INTEGER;
ALTER TABLE "OrderItem"
  ADD COLUMN "unitPriceMinor" INTEGER;
ALTER TABLE "SplitBillSession"
  ADD COLUMN "partAmountMinor" INTEGER,
  ADD COLUMN "totalAmountMinor" INTEGER,
  ADD COLUMN "remainingAmountMinor" INTEGER;
ALTER TABLE "PaymentTransaction"
  ADD COLUMN "amountMinor" INTEGER,
  ADD COLUMN "tipAmountMinor" INTEGER,
  ADD COLUMN "applicationFeeMinor" INTEGER;
ALTER TABLE "OccupancySession"
  ADD COLUMN "totalRevenueMinor" INTEGER;

-- 2. Tablas nuevas de liquidación por sesión (única escritura de B04).
CREATE TABLE "AccountSettlement" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tipMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "accountVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementAllocation" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountSettlement_idempotencyKey_key"
  ON "AccountSettlement"("idempotencyKey");
CREATE UNIQUE INDEX "SettlementAllocation_settlementId_orderId_key"
  ON "SettlementAllocation"("settlementId", "orderId");
CREATE UNIQUE INDEX "AccountSettlement_tableSessionId_accountVersion_key"
  ON "AccountSettlement"("tableSessionId", "accountVersion");
CREATE INDEX "AccountSettlement_tableSessionId_createdAt_idx"
  ON "AccountSettlement"("tableSessionId", "createdAt");
CREATE INDEX "AccountSettlement_restaurantId_createdAt_idx"
  ON "AccountSettlement"("restaurantId", "createdAt");
CREATE INDEX "SettlementAllocation_settlementId_idx"
  ON "SettlementAllocation"("settlementId");
CREATE INDEX "SettlementAllocation_orderId_idx"
  ON "SettlementAllocation"("orderId");

ALTER TABLE "AccountSettlement"
  ADD CONSTRAINT "AccountSettlement_tableSessionId_fkey"
  FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountSettlement"
  ADD CONSTRAINT "AccountSettlement_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementAllocation"
  ADD CONSTRAINT "SettlementAllocation_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "AccountSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementAllocation"
  ADD CONSTRAINT "SettlementAllocation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Backfill determinista desde Float legado (solo NULL; re-ejecutable sin cambios).
UPDATE "MenuItem" SET "priceMinor" = CAST(ROUND("price" * 100) AS INTEGER) WHERE "priceMinor" IS NULL;
UPDATE "Order" SET "totalAmountMinor" = CAST(ROUND("totalAmount" * 100) AS INTEGER) WHERE "totalAmountMinor" IS NULL;
UPDATE "OrderItem" SET "unitPriceMinor" = CAST(ROUND("unitPrice" * 100) AS INTEGER) WHERE "unitPriceMinor" IS NULL;
UPDATE "SplitBillSession" SET "partAmountMinor" = CAST(ROUND("partAmount" * 100) AS INTEGER) WHERE "partAmountMinor" IS NULL AND "partAmount" IS NOT NULL;
UPDATE "SplitBillSession" SET "totalAmountMinor" = CAST(ROUND("totalAmount" * 100) AS INTEGER) WHERE "totalAmountMinor" IS NULL;
UPDATE "SplitBillSession" SET "remainingAmountMinor" = CAST(ROUND("remainingAmount" * 100) AS INTEGER) WHERE "remainingAmountMinor" IS NULL;
UPDATE "PaymentTransaction" SET "amountMinor" = CAST(ROUND("amount" * 100) AS INTEGER) WHERE "amountMinor" IS NULL;
UPDATE "PaymentTransaction" SET "tipAmountMinor" = CAST(ROUND("tipAmount" * 100) AS INTEGER) WHERE "tipAmountMinor" IS NULL;
UPDATE "PaymentTransaction" SET "applicationFeeMinor" = CAST(ROUND("applicationFee" * 100) AS INTEGER) WHERE "applicationFeeMinor" IS NULL AND "applicationFee" IS NOT NULL;
UPDATE "OccupancySession" SET "totalRevenueMinor" = CAST(ROUND("totalRevenue" * 100) AS INTEGER) WHERE "totalRevenueMinor" IS NULL AND "totalRevenue" IS NOT NULL;
