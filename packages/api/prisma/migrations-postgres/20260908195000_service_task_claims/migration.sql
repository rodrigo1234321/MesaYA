-- S03: toma auditable de trabajo en el terminal compartido.
-- Todo aditivo; activeKey nullable permite conservar historial y arbitrar
-- simultaneidad por tarea lógica sin borrar asignaciones anteriores.
CREATE TABLE "ServiceTaskClaim" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "taskType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "terminalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceTaskClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceTaskClaim_activeKey_key"
  ON "ServiceTaskClaim"("activeKey");
CREATE INDEX "ServiceTaskClaim_taskKey_claimedAt_idx"
  ON "ServiceTaskClaim"("taskKey", "claimedAt");
CREATE INDEX "ServiceTaskClaim_restaurantId_status_claimedAt_idx"
  ON "ServiceTaskClaim"("restaurantId", "status", "claimedAt");
CREATE INDEX "ServiceTaskClaim_staffUserId_status_idx"
  ON "ServiceTaskClaim"("staffUserId", "status");
