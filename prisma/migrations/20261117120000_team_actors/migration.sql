-- P10 (docs/rebuild/05-permissions.md): four new roles, the team directory (people and agents as data), and a token that knows which agent it is.
-- Additive only: nothing is dropped, every existing user and token keeps working.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPS_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TEAM_LEAD';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MEMBER';

CREATE TABLE "Actor" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "team" TEXT,
  "userId" TEXT,
  "telegram" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Actor_key_key" ON "Actor"("key");
CREATE UNIQUE INDEX "Actor_userId_key" ON "Actor"("userId");

ALTER TABLE "ApiToken" ADD COLUMN "actorKey" TEXT;

-- The seven who already exist keep their keys, so every old Task.assignee still points at somebody. The display name is the key until the owner
-- writes the real one from the team screen (names are data, not code), and the chat each one is reached on moves out of the `notify.contacts` setting.
INSERT INTO "Actor" ("id", "key", "name", "kind", "team", "telegram", "updatedAt")
SELECT 'actor_' || k.key, k.key, k.key, k.kind, k.team, c.value ->> k.key, CURRENT_TIMESTAMP
FROM (VALUES
  ('abdullah', 'person', NULL),
  ('hassan', 'person', NULL),
  ('laith', 'person', NULL),
  ('mohammad', 'person', NULL),
  ('hermes', 'agent', NULL),
  ('muse', 'agent', NULL),
  ('claude', 'agent', NULL)
) AS k(key, kind, team)
LEFT JOIN (SELECT value FROM "Setting" WHERE key = 'notify.contacts' LIMIT 1) c ON TRUE
ON CONFLICT ("key") DO NOTHING;
