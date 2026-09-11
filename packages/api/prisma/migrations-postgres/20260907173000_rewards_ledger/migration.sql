-- Rewards: consentimiento, ledger inmutable y canjes idempotentes.

ALTER TABLE "CustomerLoyalty"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consentAt" TIMESTAMP(3);

CREATE TABLE "RewardLedgerEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerLoyaltyId" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "ruleVersion" TEXT NOT NULL DEFAULT 'rewards-v1',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedgerEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RewardRedemption"
  ADD COLUMN "pointsCost" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "redeemedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "RewardRedemption"
SET "idempotencyKey" = 'legacy-redemption-' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "RewardRedemption"
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "pointsCost" DROP DEFAULT;

CREATE UNIQUE INDEX "RewardLedgerEntry_idempotencyKey_key"
  ON "RewardLedgerEntry"("idempotencyKey");
CREATE UNIQUE INDEX "RewardRedemption_idempotencyKey_key"
  ON "RewardRedemption"("idempotencyKey");
CREATE INDEX "RewardLedgerEntry_restaurantId_createdAt_idx"
  ON "RewardLedgerEntry"("restaurantId", "createdAt");
CREATE INDEX "RewardLedgerEntry_customerLoyaltyId_createdAt_idx"
  ON "RewardLedgerEntry"("customerLoyaltyId", "createdAt");
CREATE INDEX "RewardLedgerEntry_restaurantId_referenceType_referenceId_idx"
  ON "RewardLedgerEntry"("restaurantId", "referenceType", "referenceId");

ALTER TABLE "RewardLedgerEntry"
  ADD CONSTRAINT "RewardLedgerEntry_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardLedgerEntry"
  ADD CONSTRAINT "RewardLedgerEntry_customerLoyaltyId_fkey"
  FOREIGN KEY ("customerLoyaltyId") REFERENCES "CustomerLoyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_rewardItemId_fkey"
  FOREIGN KEY ("rewardItemId") REFERENCES "RewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
