-- CreateTable
CREATE TABLE "LaunchRequest" (
    "id" TEXT NOT NULL,
    "vpId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "filePath" TEXT,
    "crCode" TEXT,
    "changeSetId" TEXT,
    "closedStatus" TEXT,
    "reason" TEXT,
    "errorCode" TEXT,
    "meta" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchRequest_vpId_mode_idx" ON "LaunchRequest"("vpId", "mode");

-- CreateIndex
CREATE INDEX "LaunchRequest_crCode_idx" ON "LaunchRequest"("crCode");

