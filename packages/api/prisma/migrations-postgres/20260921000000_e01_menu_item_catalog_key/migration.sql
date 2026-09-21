-- E01: Identidad externa estable de platos mediante catalogKey opcional y única.
-- Formato: restaurantId:source:externalId (sin secretos).
-- Non-destructive: ADD COLUMN nullable con UNIQUE INDEX para SQLite y PostgreSQL.
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "catalogKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "MenuItem_catalogKey_key" ON "MenuItem"("catalogKey");
