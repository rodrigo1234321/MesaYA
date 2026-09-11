-- E13: nombre opcional del participante como dato separado (aditivo, sin borrar datos).
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
