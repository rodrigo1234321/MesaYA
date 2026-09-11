-- E05: revisión por excepción, separada del modo manual global.
-- Aditiva y nullable para conservar órdenes históricas; el umbral tiene
-- default conservador para que uno o dos productos iguales no interrumpan el flujo.
ALTER TABLE "RestaurantModuleConfig"
  ADD COLUMN "reviewQuantityThreshold" INTEGER NOT NULL DEFAULT 6;

ALTER TABLE "Order"
  ADD COLUMN "reviewReasonCode" TEXT,
  ADD COLUMN "reviewReasonDetail" TEXT;
ALTER TABLE "RestaurantModuleConfig" ALTER COLUMN "requireWaiterValidation" SET DEFAULT false;
