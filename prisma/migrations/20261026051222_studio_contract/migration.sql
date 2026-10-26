-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "crCode" TEXT NOT NULL,
    "productCode" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "driveFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_crCode_key" ON "CreativeAsset"("crCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_sourceRef_key" ON "CreativeAsset"("sourceRef");
