-- v6 P11: the ad account a video was uploaded to. Additive only (one new nullable column; no row is rewritten).
ALTER TABLE "CreativeAsset" ADD COLUMN IF NOT EXISTS "metaAccountId" TEXT;
