-- One team member's numbers for one day (v5 · P9): a new table, nothing existing changes. Employees only.
CREATE TABLE "PersonDay" (
    "id" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "claims" INTEGER,
    "confirmed" INTEGER,
    "rejected" INTEGER,
    "noAnswer" INTEGER,
    "noAnswerFast" INTEGER,
    "firstClaimSec" INTEGER,
    "stuck48h" INTEGER,
    "reactivated" INTEGER,
    "delivered" INTEGER,
    "rejectReasons" JSONB,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonDay_actorKey_date_key" ON "PersonDay"("actorKey", "date");
CREATE INDEX "PersonDay_date_idx" ON "PersonDay"("date");
