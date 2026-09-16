-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN IF NOT EXISTS "pinFingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StaffUser_restaurantId_pinFingerprint_key" ON "StaffUser"("restaurantId", "pinFingerprint");
