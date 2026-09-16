-- AlterTable
ALTER TABLE "RestaurantModuleConfig" ADD COLUMN IF NOT EXISTS "allowWaitersToCollectCash" BOOLEAN NOT NULL DEFAULT false;
