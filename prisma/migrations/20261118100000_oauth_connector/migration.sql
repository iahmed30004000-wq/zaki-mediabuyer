-- The claude.ai custom connector (OAuth 2.1 + dynamic client registration + PKCE) for /mcp. Additive only: the mbm_/mbh_ Bearer tokens are untouched.
ALTER TABLE "ApiToken" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiToken" ADD COLUMN "oauthClientId" TEXT;
CREATE INDEX "ApiToken_oauthClientId_idx" ON "ApiToken"("oauthClientId");

-- A client that registered itself (RFC 7591). Public clients only: no secret, PKCE instead.
CREATE TABLE "OAuthClient" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "redirectUris" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- A one-time authorization code: only its sha256 is kept, ten minutes, used once.
CREATE TABLE "OAuthCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "scopes" TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthCode_codeHash_key" ON "OAuthCode"("codeHash");

-- What the owner approved: one grant per approval, tied to the ApiToken that /mcp checks (its hash rotates on refresh, so a revoke or a refresh kills the old token at once).
CREATE TABLE "OAuthGrant" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiTokenId" TEXT NOT NULL,
  "refreshHash" TEXT NOT NULL,
  "scopes" TEXT[],
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthGrant_apiTokenId_key" ON "OAuthGrant"("apiTokenId");
CREATE UNIQUE INDEX "OAuthGrant_refreshHash_key" ON "OAuthGrant"("refreshHash");
CREATE INDEX "OAuthGrant_clientId_idx" ON "OAuthGrant"("clientId");
