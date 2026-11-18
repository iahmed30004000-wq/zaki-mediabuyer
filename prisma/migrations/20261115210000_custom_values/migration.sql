-- CreateTable
CREATE TABLE "CustomValue" (
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomValue_pkey" PRIMARY KEY ("entity","entityId","fieldId")
);

-- CreateIndex
CREATE INDEX "CustomValue_entity_fieldId_idx" ON "CustomValue"("entity", "fieldId");
