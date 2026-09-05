-- Etapa 03 COCINA-CUENTAS: datos y contratos aditivos (cocina/cuentas).
-- Sólo ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT.
-- Sin DROP, sin DELETE, sin UPDATE de datos: pedidos y personal previos
-- se conservan; los campos nuevos son nullable o con DEFAULT seguro.
-- Filas previas de StaffUser quedan con pinDigest NULL (sin backfill:
-- el PIN en claro no se conserva); login bcrypt intacto.

-- AlterTable: StaffUser.pinDigest (HMAC con secreto del servidor, etapa 03)
ALTER TABLE "StaffUser" ADD COLUMN     "pinDigest" TEXT;

-- AlterTable: MenuItem precio canónico en centavos + versión
ALTER TABLE "MenuItem" ADD COLUMN     "priceCents" INTEGER;
ALTER TABLE "MenuItem" ADD COLUMN     "priceCurrency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "MenuItem" ADD COLUMN     "priceVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: Order moneda, total en centavos e idempotencia de creación
ALTER TABLE "Order" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Order" ADD COLUMN     "totalCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable: OrderItem autoría de visita, tanda y snapshots versionados
ALTER TABLE "OrderItem" ADD COLUMN     "participantId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN     "tandaId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN     "productNameSnapshot" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN     "unitPriceCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN     "lineTotalCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "OrderItem" ADD COLUMN     "priceVersion" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN     "modifierVersion" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN     "modifiersSnapshot" TEXT;

-- AlterTable: SplitBillSession centavos + revisión de reparto (etapa 07)
ALTER TABLE "SplitBillSession" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "SplitBillSession" ADD COLUMN     "totalCents" INTEGER;
ALTER TABLE "SplitBillSession" ADD COLUMN     "remainingCents" INTEGER;
ALTER TABLE "SplitBillSession" ADD COLUMN     "partAmountCents" INTEGER;
ALTER TABLE "SplitBillSession" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: PaymentTransaction centavos (propina separada)
ALTER TABLE "PaymentTransaction" ADD COLUMN     "amountCents" INTEGER;
ALTER TABLE "PaymentTransaction" ADD COLUMN     "tipCents" INTEGER;
ALTER TABLE "PaymentTransaction" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';

-- CreateTable: VisitParticipant (identidad emitida por servidor, ligada a visita)
CREATE TABLE "VisitParticipant" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "displayName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OrderTanda (tandas independientes por visita, idempotentes)
CREATE TABLE "OrderTanda" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "createdByParticipantId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ModifierGroup (versionado, por producto)
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ModifierOption (delta en centavos ARS)
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_restaurantId_pinDigest_key" ON "StaffUser"("restaurantId", "pinDigest");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "VisitParticipant_tokenHash_key" ON "VisitParticipant"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitParticipant_tableSessionId_status_idx" ON "VisitParticipant"("tableSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTanda_idempotencyKey_key" ON "OrderTanda"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTanda_tableSessionId_seq_key" ON "OrderTanda"("tableSessionId", "seq");

-- CreateIndex
CREATE INDEX "OrderTanda_tableSessionId_status_idx" ON "OrderTanda"("tableSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_menuItemId_name_version_key" ON "ModifierGroup"("menuItemId", "name", "version");

-- CreateIndex
CREATE INDEX "ModifierGroup_menuItemId_isActive_idx" ON "ModifierGroup"("menuItemId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierOption_groupId_name_key" ON "ModifierOption"("groupId", "name");

-- CreateIndex
CREATE INDEX "ModifierOption_groupId_isAvailable_idx" ON "ModifierOption"("groupId", "isAvailable");

-- AddForeignKey
ALTER TABLE "VisitParticipant" ADD CONSTRAINT "VisitParticipant_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTanda" ADD CONSTRAINT "OrderTanda_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTanda" ADD CONSTRAINT "OrderTanda_createdByParticipantId_fkey" FOREIGN KEY ("createdByParticipantId") REFERENCES "VisitParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "VisitParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tandaId_fkey" FOREIGN KEY ("tandaId") REFERENCES "OrderTanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
