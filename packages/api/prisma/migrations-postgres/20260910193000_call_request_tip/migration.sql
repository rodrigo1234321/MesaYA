-- Persist the tip selected by the guest when requesting the bill.
ALTER TABLE "CallRequest"
ADD COLUMN "tipMinor" INTEGER NOT NULL DEFAULT 0;
