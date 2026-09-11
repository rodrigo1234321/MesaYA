-- Persist the sales-plan tables and the immutable ticket renderer output.
CREATE TABLE "ReceiptSnapshot" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "settlementId" TEXT,
    "receiptType" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "snapshotData" TEXT NOT NULL,
    "contentHash" TEXT,
    "pdfVersion" INTEGER NOT NULL DEFAULT 1,
    "pdfData" BYTEA,
    "pdfPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAdjustment" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tipMinor" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "adjustedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalDocumentAssociation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "pointOfSale" INTEGER NOT NULL,
    "docNumber" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "emitter" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "notes" TEXT,
    "fileRef" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentAssociation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalDocumentCoverage" (
    "id" TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "coveredMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiptSnapshot_idempotencyKey_key"
  ON "ReceiptSnapshot"("idempotencyKey");
CREATE UNIQUE INDEX "ReceiptSnapshot_restaurantId_receiptNumber_key"
  ON "ReceiptSnapshot"("restaurantId", "receiptNumber");
CREATE INDEX "ReceiptSnapshot_restaurantId_createdAt_idx"
  ON "ReceiptSnapshot"("restaurantId", "createdAt");
CREATE INDEX "ReceiptSnapshot_tableSessionId_createdAt_idx"
  ON "ReceiptSnapshot"("tableSessionId", "createdAt");
CREATE INDEX "PaymentAdjustment_settlementId_idx"
  ON "PaymentAdjustment"("settlementId");
CREATE INDEX "PaymentAdjustment_restaurantId_createdAt_idx"
  ON "PaymentAdjustment"("restaurantId", "createdAt");
CREATE UNIQUE INDEX "FiscalDocumentAssociation_restaurantId_pointOfSale_docNumber_docType_key"
  ON "FiscalDocumentAssociation"("restaurantId", "pointOfSale", "docNumber", "docType");
CREATE INDEX "FiscalDocumentAssociation_restaurantId_docDate_idx"
  ON "FiscalDocumentAssociation"("restaurantId", "docDate");
CREATE UNIQUE INDEX "FiscalDocumentCoverage_fiscalDocumentId_tableSessionId_key"
  ON "FiscalDocumentCoverage"("fiscalDocumentId", "tableSessionId");
CREATE INDEX "FiscalDocumentCoverage_tableSessionId_idx"
  ON "FiscalDocumentCoverage"("tableSessionId");

ALTER TABLE "ReceiptSnapshot"
  ADD CONSTRAINT "ReceiptSnapshot_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReceiptSnapshot_tableSessionId_fkey"
  FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReceiptSnapshot_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "AccountSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentAdjustment"
  ADD CONSTRAINT "PaymentAdjustment_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "AccountSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentAdjustment_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiscalDocumentAssociation"
  ADD CONSTRAINT "FiscalDocumentAssociation_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiscalDocumentCoverage"
  ADD CONSTRAINT "FiscalDocumentCoverage_fiscalDocumentId_fkey"
  FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocumentAssociation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FiscalDocumentCoverage_tableSessionId_fkey"
  FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
