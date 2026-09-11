-- S05: trazabilidad del origen de la tanda y del actor presencial.
-- Aditivo y nullable para conservar pedidos históricos y compatibilidad.
ALTER TABLE "Order"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "createdByStaffUserId" TEXT;
