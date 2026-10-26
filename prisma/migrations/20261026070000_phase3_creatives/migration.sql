-- AlterTable
ALTER TABLE "CreativeAsset" ADD COLUMN     "angle" TEXT,
ADD COLUMN     "aspect" TEXT,
ADD COLUMN     "awareness" TEXT,
ADD COLUMN     "conceptId" TEXT,
ADD COLUMN     "dateIn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dialect" TEXT,
ADD COLUMN     "dupOf" TEXT,
ADD COLUMN     "durationS" DECIMAL(8,2),
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "hookType" TEXT,
ADD COLUMN     "md5" TEXT,
ADD COLUMN     "metaVideoId" TEXT,
ADD COLUMN     "policyFlag" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "policyNote" TEXT,
ADD COLUMN     "probe" JSONB,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "style" TEXT,
ADD COLUMN     "thumbnailHash" TEXT;

-- CreateTable
CREATE TABLE "CreativeCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreativeCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFile" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "productCode" TEXT,
    "originalName" TEXT NOT NULL,
    "newName" TEXT,
    "folder" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "crCode" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCheck" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "adText" TEXT,
    "transcript" TEXT,
    "ocrText" TEXT,
    "lpText" TEXT,
    "codeHits" JSONB NOT NULL,
    "agentVerdict" TEXT,
    "flag" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThumbnailCandidate" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "frameIndex" INTEGER NOT NULL,
    "atSeconds" DECIMAL(6,2) NOT NULL,
    "path" TEXT NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThumbnailCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveFile_driveId_key" ON "DriveFile"("driveId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_md5_key" ON "CreativeAsset"("md5");

-- AddForeignKey
ALTER TABLE "PolicyCheck" ADD CONSTRAINT "PolicyCheck_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CreativeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThumbnailCandidate" ADD CONSTRAINT "ThumbnailCandidate_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CreativeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

