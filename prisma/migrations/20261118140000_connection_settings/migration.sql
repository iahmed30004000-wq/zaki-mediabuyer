-- Connection values entered from the site (docs: D62). Additive only; the environment variables keep working and are the fallback.
-- A secret is stored AES-256-GCM encrypted (key: SECRETS_MASTER_KEY); only the last four characters are kept in the clear for the owner's «آخر 4 خانات».
CREATE TABLE "ConnectionSetting" (
  "name" TEXT NOT NULL,
  "secret" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'app',
  "valueEnc" TEXT,
  "valuePlain" TEXT,
  "last4" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectionSetting_pkey" PRIMARY KEY ("name")
);

-- The media buyer as an OAuth CLIENT of another of our systems («اربط ← اسمح»): who it registered with there.
CREATE TABLE "OAuthLinkClient" (
  "key" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "tokenEndpoint" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthLinkClient_pkey" PRIMARY KEY ("key")
);

-- A link in progress: the state it came back with and the sealed PKCE verifier (ten minutes, used once).
CREATE TABLE "OAuthLinkPending" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verifierEnc" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthLinkPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthLinkPending_state_key" ON "OAuthLinkPending"("state");
