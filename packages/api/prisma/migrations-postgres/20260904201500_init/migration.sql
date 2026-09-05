-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "planTier" TEXT NOT NULL DEFAULT 'LEAN',
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "whatsappPhone" TEXT,
    "pdfMenuUrl" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "themeColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "templateId" TEXT NOT NULL DEFAULT 'GOURMET_OBSIDIAN',
    "customFont" TEXT NOT NULL DEFAULT 'plus-jakarta',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantModuleConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'WAITER_ONLY',
    "allowSplitBill" BOOLEAN NOT NULL DEFAULT false,
    "allowOrdering" BOOLEAN NOT NULL DEFAULT true,
    "syncSocialCart" BOOLEAN NOT NULL DEFAULT true,
    "requireWaiterValidation" BOOLEAN NOT NULL DEFAULT true,
    "enableUpsell" BOOLEAN NOT NULL DEFAULT true,
    "enableSmartTips" BOOLEAN NOT NULL DEFAULT true,
    "suggestedTipPercentages" TEXT NOT NULL DEFAULT '[10, 15, 20]',
    "enableReviews" BOOLEAN NOT NULL DEFAULT true,
    "googlePlaceId" TEXT,
    "enableWaitlist" BOOLEAN NOT NULL DEFAULT false,
    "enableWaitlistPreOrder" BOOLEAN NOT NULL DEFAULT false,
    "enableRewards" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerHundredPesos" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantPaymentCredentials" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "mpCollectorId" TEXT NOT NULL,
    "mpPublicKey" TEXT,
    "mpAccessTokenEncrypted" TEXT NOT NULL,
    "mpRefreshTokenEncrypted" TEXT NOT NULL,
    "mpTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantPaymentCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantModuleConfigAudit" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "changedBy" TEXT,
    "changedField" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantModuleConfigAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sector" TEXT NOT NULL DEFAULT 'SALON_PRINCIPAL',
    "isOutdoor" BOOLEAN NOT NULL DEFAULT false,
    "mergedWithTableId" TEXT,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shape" TEXT NOT NULL DEFAULT 'RECT',
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "floorZoneId" TEXT,
    "currentState" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "shiftId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRequest" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "note" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'WEB_DIRECT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CallRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "addedByGuest" TEXT NOT NULL,
    "claimedByGuest" TEXT,
    "claimVersion" INTEGER NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitBillSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "totalParts" INTEGER NOT NULL DEFAULT 1,
    "paidParts" INTEGER NOT NULL DEFAULT 0,
    "partAmount" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "remainingAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitBillSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "guestSessionId" TEXT NOT NULL,
    "splitSessionId" TEXT,
    "method" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "tipAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "applicationFee" DOUBLE PRECISION,
    "mpPaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "preOrderData" TEXT,
    "estimatedWaitMinutes" INTEGER,
    "calledAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerLoyalty" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerLoyalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "customerLoyaltyId" TEXT NOT NULL,
    "rewardItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WAITER',
    "assignedSector" TEXT,
    "pushSubscription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "planTier" TEXT NOT NULL DEFAULT 'LEAN',
    "monthlyPriceArs" INTEGER NOT NULL DEFAULT 25000,
    "isHighSeason" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorZone" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "polygonPoints" TEXT,

    CONSTRAINT "FloorZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorPlanLayout" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Principal',
    "canvasWidth" INTEGER NOT NULL DEFAULT 1200,
    "canvasHeight" INTEGER NOT NULL DEFAULT 800,
    "gridSize" INTEGER NOT NULL DEFAULT 20,
    "backgroundUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorPlanLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableStateEvent" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "staffUserId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupancySession" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "shiftId" TEXT,
    "partySize" INTEGER,
    "seatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderedAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "billAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "vacatedAt" TIMESTAMP(3),
    "cleanedAt" TIMESTAMP(3),
    "totalRevenue" DOUBLE PRECISION,
    "durationMinutes" INTEGER,
    "timeToOrderMinutes" INTEGER,
    "timeToServeMinutes" INTEGER,
    "dwellAfterPayMinutes" INTEGER,
    "turnTimeMinutes" INTEGER,

    CONSTRAINT "OccupancySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantModuleConfig_restaurantId_key" ON "RestaurantModuleConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantPaymentCredentials_restaurantId_key" ON "RestaurantPaymentCredentials"("restaurantId");

-- CreateIndex
CREATE INDEX "RestaurantModuleConfigAudit_restaurantId_changedAt_idx" ON "RestaurantModuleConfigAudit"("restaurantId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Table_restaurantId_label_key" ON "Table"("restaurantId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_token_key" ON "TableSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WaitlistEntry_restaurantId_status_idx" ON "WaitlistEntry"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLoyalty_restaurantId_phone_key" ON "CustomerLoyalty"("restaurantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_tableSessionId_key" ON "Feedback"("tableSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_restaurantId_key" ON "Subscription"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorZone_restaurantId_name_key" ON "FloorZone"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FloorPlanLayout_restaurantId_name_key" ON "FloorPlanLayout"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "TableStateEvent_tableId_createdAt_idx" ON "TableStateEvent"("tableId", "createdAt");

-- CreateIndex
CREATE INDEX "TableStateEvent_source_createdAt_idx" ON "TableStateEvent"("source", "createdAt");

-- CreateIndex
CREATE INDEX "OccupancySession_restaurantId_seatedAt_idx" ON "OccupancySession"("restaurantId", "seatedAt");

-- CreateIndex
CREATE INDEX "OccupancySession_tableId_seatedAt_idx" ON "OccupancySession"("tableId", "seatedAt");

-- AddForeignKey
ALTER TABLE "RestaurantModuleConfig" ADD CONSTRAINT "RestaurantModuleConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantPaymentCredentials" ADD CONSTRAINT "RestaurantPaymentCredentials_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_floorZoneId_fkey" FOREIGN KEY ("floorZoneId") REFERENCES "FloorZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRequest" ADD CONSTRAINT "CallRequest_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitBillSession" ADD CONSTRAINT "SplitBillSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLoyalty" ADD CONSTRAINT "CustomerLoyalty_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardItem" ADD CONSTRAINT "RewardItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_customerLoyaltyId_fkey" FOREIGN KEY ("customerLoyaltyId") REFERENCES "CustomerLoyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorZone" ADD CONSTRAINT "FloorZone_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanLayout" ADD CONSTRAINT "FloorPlanLayout_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableStateEvent" ADD CONSTRAINT "TableStateEvent_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancySession" ADD CONSTRAINT "OccupancySession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancySession" ADD CONSTRAINT "OccupancySession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

