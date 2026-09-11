-- B04: preserve the staff member responsible for the service on each settlement.
-- Nullable for existing settlements; the application resolves a default from
-- the bill claim or creator when the field is absent.
ALTER TABLE "AccountSettlement"
  ADD COLUMN IF NOT EXISTS "responsibleStaffUserId" TEXT;
