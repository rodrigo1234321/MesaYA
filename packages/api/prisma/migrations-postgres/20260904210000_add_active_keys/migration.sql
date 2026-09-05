-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "activeKey" TEXT;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "activeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Shift_activeKey_key" ON "Shift"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_activeKey_key" ON "TableSession"("activeKey");

