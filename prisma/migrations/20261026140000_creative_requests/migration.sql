-- CreateTable
CREATE TABLE "CreativeRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "vpId" TEXT,
    "crCode" TEXT,
    "count" INTEGER NOT NULL DEFAULT 4,
    "brief" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeRequest_status_createdAt_idx" ON "CreativeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CreativeRequest_crCode_idx" ON "CreativeRequest"("crCode");

