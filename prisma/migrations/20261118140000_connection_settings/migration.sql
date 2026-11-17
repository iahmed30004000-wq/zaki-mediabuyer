-- Connection values entered from the site (docs: D62). Additive only; the environment variables keep working and are the fallback.
-- A secret is stored AES-256-GCM encrypted (key: SECRETS_MASTER_KEY); only the last four characters are kept in the clear for the owner's «آخر 4 خانات».
CREATE TABLE "ConnectionSetting" (
  "name" TEXT NOT NULL,
  "secret" BOOLEAN NOT NULL DEFAULT false,
  "valueEnc" TEXT,
  "valuePlain" TEXT,
  "last4" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectionSetting_pkey" PRIMARY KEY ("name")
);
