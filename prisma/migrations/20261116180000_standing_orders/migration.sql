-- The standing orders (v5 · P7): a new table, nothing existing changes.
CREATE TABLE "StandingOrder" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'ads',
    "jobKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "endRequestedAt" TIMESTAMP(3),
    "endRequestedBy" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ui',
    "saidAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandingOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StandingOrder_status_domain_idx" ON "StandingOrder"("status", "domain");
