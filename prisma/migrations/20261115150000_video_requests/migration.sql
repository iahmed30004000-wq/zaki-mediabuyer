-- AlterTable
ALTER TABLE "VideoBankItem" ADD COLUMN     "scenarioFileId" TEXT;

-- CreateTable
CREATE TABLE "VideoRequest" (
    "id" TEXT NOT NULL,
    "videoKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "job" TEXT,
    "vName" TEXT,
    "crCode" TEXT,
    "driveFileId" TEXT,
    "scenarioFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "numbers" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "taskId" TEXT,
    "via" TEXT NOT NULL DEFAULT 'none',
    "deliveredAt" TIMESTAMP(3),
    "deliveryError" TEXT,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "result" JSONB,
    "resultNote" TEXT,
    "readyAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoRequest_status_createdAt_idx" ON "VideoRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoRequest_videoKey_status_idx" ON "VideoRequest"("videoKey", "status");
