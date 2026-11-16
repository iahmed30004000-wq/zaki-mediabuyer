-- The scheduled jobs' place on the map (v5 · P5): every column is optional or has a default — nothing existing changes.
ALTER TABLE "Workflow" ADD COLUMN "number" INTEGER,
ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'ads',
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'recurring',
ADD COLUMN "scheduleText" TEXT,
ADD COLUMN "runsAt" TIMESTAMP(3),
ADD COLUMN "endsAt" TIMESTAMP(3),
ADD COLUMN "finishedAt" TIMESTAMP(3),
ADD COLUMN "runsFrom" TEXT,
ADD COLUMN "origin" TEXT,
ADD COLUMN "touches" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "talksTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "note" TEXT,
ADD COLUMN "advice" TEXT,
ADD COLUMN "adviceText" TEXT,
ADD COLUMN "decision" TEXT,
ADD COLUMN "decidedAt" TIMESTAMP(3),
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'seed';

ALTER TABLE "WorkflowRun" ADD COLUMN "report" TEXT;

-- The seeded jobs get their number, domain and kind (docs/rebuild/07-phases.md P5); a job somebody else created is not «seed».
UPDATE "Workflow" SET "number" = 1,  "domain" = 'ads', "kind" = 'recurring' WHERE "key" = 'night-round' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 2,  "domain" = 'ads', "kind" = 'recurring' WHERE "key" = 'daily-check' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 3,  "domain" = 'ads', "kind" = 'recurring' WHERE "key" = 'product-tests' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 4,  "domain" = 'ads', "kind" = 'recurring' WHERE "key" = 'video-collection' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 5,  "domain" = 'ads', "kind" = 'manual'    WHERE "key" = 'hermes-requests' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 6,  "domain" = 'ads', "kind" = 'manual'    WHERE "key" = 'tinnitus-experiment' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 7,  "domain" = 'ads', "kind" = 'manual'    WHERE "key" = 'breakeven-refresh' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 8,  "domain" = 'ads', "kind" = 'manual'    WHERE "key" = 'review-fixes' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 9,  "domain" = 'ads', "kind" = 'manual'    WHERE "key" = 'one-off-verdicts' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 10, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'team-round' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 11, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'manager-comment' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 12, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'leak-plan' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 13, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'shipments-check' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 14, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'stock-alerts' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 15, "domain" = 'ops', "kind" = 'recurring' WHERE "key" = 'girls-training' AND "number" IS NULL;
UPDATE "Workflow" SET "number" = 16, "domain" = 'ops', "kind" = 'manual'    WHERE "key" = 'basha-parcels' AND "number" IS NULL;
UPDATE "Workflow" SET "source" = 'mcp' WHERE "key" NOT IN ('night-round','daily-check','product-tests','video-collection','hermes-requests','tinnitus-experiment','breakeven-refresh','review-fixes','one-off-verdicts','team-round','manager-comment','leak-plan','shipments-check','stock-alerts','girls-training','basha-parcels');
