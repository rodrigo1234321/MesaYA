-- CreateTable
CREATE TABLE "UpsellEvent" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "experimentGroup" TEXT NOT NULL DEFAULT 'UPSELL',
    "sourceItemId" TEXT,
    "suggestionItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpsellEvent_idempotencyKey_key" ON "UpsellEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UpsellEvent_restaurantId_eventType_createdAt_idx" ON "UpsellEvent"("restaurantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "UpsellEvent_restaurantId_suggestionItemId_createdAt_idx" ON "UpsellEvent"("restaurantId", "suggestionItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "UpsellEvent" ADD CONSTRAINT "UpsellEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
