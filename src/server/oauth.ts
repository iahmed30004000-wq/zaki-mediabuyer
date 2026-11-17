/**
 * THE CONNECTOR'S OAUTH, on the database (docs: D61). claude.ai adds `/mcp` as a custom connector by URL: it finds the authorization server from the 401 of /mcp,
 * registers itself (RFC 7591), sends the owner to /oauth/authorize (he is logged in to the site and approves), and exchanges the code (PKCE S256) for an access token.
 * The access token IS an `ApiToken` (so /mcp checks it exactly like an mbm_ token, scope by scope, and a revoke is felt on the very next call); a refresh rotates its
 * hash in place. Only hashes are stored; nothing here is ever logged.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ACCESS_TTL_S, CODE_TTL_S, CONNECTOR_ACTOR, REFRESH_TTL_DAYS, clientName, hostsOf, isChallenge, isVerifier, oauthError, parseScopes, redirectUriProblem, type OAuthError } from "@/core/oauth";
import type { McpScope } from "@/core/token-scopes";
import { audit } from "./audit";
import { db } from "./db";
import { hashToken } from "./api-token";
import { appOrigin } from "./env";

const secret = (prefix: string) => prefix + randomBytes(32).toString("base64url");
const extraHosts = () => hostsOf(process.env.OAUTH_REDIRECT_HOSTS);
const pkceOf = (verifier: string) => createHash("sha256").update(verifier, "utf8").digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type Failure = { ok: false; status: number; body: OAuthError };
const fail = (status: number, error: Parameters<typeof oauthError>[0], why: string): Failure => ({ ok: false, status, body: oauthError(error, why) });

/** RFC 7591: a client says who it is and where it wants to come back to. Public client, PKCE, no secret. */
export async function registerClient(body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | Failure> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 5) return fail(400, "invalid_redirect_uri", "ابعت من 1 لـ 5 عناوين رجوع (redirect_uris)");
  for (const u of uris) {
    const p = redirectUriProblem(u, extraHosts());
    if (p) return fail(400, "invalid_redirect_uri", p);
  }
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return fail(400, "invalid_client_metadata", "بس عملاء بلا سرّ (token_endpoint_auth_method = none) مع PKCE");
  const name = clientName(b.client_name);
  const redirectUris = [...new Set(uris as string[])].sort();
  // the same app registering again (every «connect» attempt does) gets its own client back, not a new row
  const known = await db.oAuthClient.findMany({ where: { revokedAt: null, name } });
  const again = known.find((c) => JSON.stringify([...c.redirectUris].sort()) === JSON.stringify(redirectUris));
  if (!again && (await db.oAuthClient.count({ where: { revokedAt: null } })) >= 50) return fail(429, "server_error", "عندك 50 تطبيق متصل — شيل واحد قبل ما تضيف");
  const row = again ?? (await db.oAuthClient.create({ data: { clientId: secret("mbc_"), name, redirectUris } }));
  if (!again) await audit({ type: "system", id: "oauth" }, "oauth.client_register", { type: "oauth_client", id: row.id }, { after: { name, hosts: redirectUris.map((u) => new URL(u).host) } });
  return {
    ok: true,
    data: {
      client_id: row.clientId,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: row.name,
      redirect_uris: row.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

export interface AuthRequest {
  clientDbId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  challenge: string;
  scopes: McpScope[];
  state: string | null;
}

/** The request the owner is asked to approve, checked completely. A problem here is shown to the owner — never redirected (an unverified address must not be trusted). */
export async function checkAuthRequest(p: Record<string, string | string[] | undefined>): Promise<{ ok: true; req: AuthRequest } | { ok: false; why: string }> {
  const one = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  if (one("response_type") !== "code") return { ok: false, why: "الطلب لازم يكون response_type=code" };
  const client = one("client_id") ? await db.oAuthClient.findUnique({ where: { clientId: one("client_id") } }) : null;
  if (!client || client.revokedAt) return { ok: false, why: "التطبيق مش معروف أو انشال" };
  const redirectUri = one("redirect_uri");
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, why: "عنوان الرجوع مش من اللي سجّله التطبيق" };
  if (one("code_challenge_method") !== "S256" || !isChallenge(one("code_challenge"))) return { ok: false, why: "بدنا PKCE بطريقة S256" };
  const resource = one("resource");
  if (resource && resource.replace(/\/+$/, "") !== `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/mcp` && process.env.APP_URL) return { ok: false, why: "المورد (resource) مش /mcp تبع هالموقع" };
  return {
    ok: true,
    req: { clientDbId: client.id, clientId: client.clientId, clientName: client.name, redirectUri, redirectHost: new URL(redirectUri).host, challenge: one("code_challenge"), scopes: parseScopes(one("scope")), state: one("state") || null },
  };
}

/** The owner said yes: a one-time code, bound to the client, the address, the challenge and the scopes he saw. */
export async function createCode(r: AuthRequest, userId: string): Promise<string> {
  const code = secret("mbq_");
  await db.oAuthCode.create({ data: { codeHash: hashToken(code), clientId: r.clientDbId, userId, redirectUri: r.redirectUri, challenge: r.challenge, scopes: r.scopes, expiresAt: new Date(Date.now() + CODE_TTL_S * 1000) } });
  await audit({ type: "user", id: userId }, "oauth.approve", { type: "oauth_client", id: r.clientDbId }, { after: { client: r.clientName, scopes: r.scopes } });
  return code;
}

export type TokenResponse = { ok: true; data: Record<string, unknown> };

async function newTokens(grant: { clientId: string; userId: string; scopes: string[] }, clientLabel: string, existing?: { grantId: string; apiTokenId: string }): Promise<{ access: string; refresh: string }> {
  const access = secret("mbo_");
  const refresh = secret("mbr_");
  const expiresAt = new Date(Date.now() + ACCESS_TTL_S * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
  if (existing) {
    // a refresh rotates both hashes in place: the old access token and the old refresh token stop working at once
    await db.$transaction([
      db.apiToken.update({ where: { id: existing.apiTokenId }, data: { tokenHash: hashToken(access), prefix: access.slice(0, 10), expiresAt } }),
      db.oAuthGrant.update({ where: { id: existing.grantId }, data: { refreshHash: hashToken(refresh), refreshExpiresAt } }),
    ]);
  } else {
    const token = await db.apiToken.create({ data: { name: `ربط ${clientLabel}`.slice(0, 60), scopes: grant.scopes, tokenHash: hashToken(access), prefix: access.slice(0, 10), actorKey: CONNECTOR_ACTOR, createdById: grant.userId, expiresAt, oauthClientId: grant.clientId } });
    await db.oAuthGrant.create({ data: { clientId: grant.clientId, userId: grant.userId, apiTokenId: token.id, refreshHash: hashToken(refresh), scopes: grant.scopes, refreshExpiresAt } });
  }
  return { access, refresh };
}

const tokenBody = (t: { access: string; refresh: string }, scopes: string[]) => ({ access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope: scopes.join(" ") });

/** grant_type=authorization_code: the code, the same address, and the verifier whose sha256 is the challenge. The code works once. */
export async function exchangeCode(f: URLSearchParams): Promise<TokenResponse | Failure> {
  const code = f.get("code") ?? "";
  const verifier = f.get("code_verifier");
  if (!code || !isVerifier(verifier)) return fail(400, "invalid_request", "ناقص code أو code_verifier");
  const client = f.get("client_id") ? await db.oAuthClient.findUnique({ where: { clientId: f.get("client_id")! } }) : null;
  if (!client || client.revokedAt) return fail(401, "invalid_client", "التطبيق مش معروف أو انشال");
  const row = await db.oAuthCode.findUnique({ where: { codeHash: hashToken(code) } });
  if (!row || row.clientId !== client.id || row.usedAt || row.expiresAt <= new Date()) return fail(400, "invalid_grant", "الرمز مش صالح أو انتهى أو انستعمل");
  if (f.get("redirect_uri") !== row.redirectUri) return fail(400, "invalid_grant", "redirect_uri مش نفس اللي بالطلب");
  if (!same(pkceOf(verifier), row.challenge)) return fail(400, "invalid_grant", "التحقق PKCE فشل");
  // used exactly once, even if two calls race
  const used = await db.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) return fail(400, "invalid_grant", "الرمز انستعمل");
  const t = await newTokens({ clientId: client.id, userId: row.userId, scopes: row.scopes }, client.name);
  return { ok: true, data: tokenBody(t, row.scopes) };
}

/** grant_type=refresh_token: a new pair, and the old pair is dead. A revoked or expired grant never comes back. */
export async function refreshGrant(f: URLSearchParams): Promise<TokenResponse | Failure> {
  const refresh = f.get("refresh_token") ?? "";
  if (!refresh) return fail(400, "invalid_request", "ناقص refresh_token");
  const client = f.get("client_id") ? await db.oAuthClient.findUnique({ where: { clientId: f.get("client_id")! } }) : null;
  if (!client || client.revokedAt) return fail(401, "invalid_client", "التطبيق مش معروف أو انشال");
  const grant = await db.oAuthGrant.findUnique({ where: { refreshHash: hashToken(refresh) } });
  if (!grant || grant.clientId !== client.id || grant.revokedAt || grant.refreshExpiresAt <= new Date()) return fail(400, "invalid_grant", "رمز التجديد مش صالح أو انتهى أو انسحب");
  const t = await newTokens({ clientId: client.id, userId: grant.userId, scopes: grant.scopes }, client.name, { grantId: grant.id, apiTokenId: grant.apiTokenId });
  return { ok: true, data: tokenBody(t, grant.scopes) };
}

export interface ConnectedClient {
  id: string;
  name: string;
  host: string;
  scopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

/** What the owner sees under «توكنات الوكلاء»: the apps he let in, when, and when each last called. */
export async function listConnected(): Promise<ConnectedClient[]> {
  const clients = await db.oAuthClient.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const grants = await db.oAuthGrant.findMany({ where: { clientId: { in: clients.map((c) => c.id) } } });
  const tokens = await db.apiToken.findMany({ where: { id: { in: grants.map((g) => g.apiTokenId) } }, select: { id: true, lastUsedAt: true } });
  const used = new Map(tokens.map((t) => [t.id, t.lastUsedAt]));
  return clients
    .map((c) => {
      const mine = grants.filter((g) => g.clientId === c.id);
      const live = mine.filter((g) => !g.revokedAt);
      const last = mine.map((g) => used.get(g.apiTokenId)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      let host = "";
      try {
        host = new URL(c.redirectUris[0] ?? "").host;
      } catch {
        host = "";
      }
      return { id: c.id, name: c.name, host, scopes: [...new Set(live.flatMap((g) => g.scopes))], connectedAt: (mine[0]?.createdAt ?? c.createdAt).toISOString(), lastUsedAt: last?.toISOString() ?? null, active: !c.revokedAt && live.length > 0 };
    })
    .filter((c) => c.active || c.lastUsedAt);
}

/** Revoke: the client, its grants and its access tokens, in one go — the next /mcp call with any of them is refused. */
export async function revokeClient(id: string, byUserId: string): Promise<boolean> {
  const c = await db.oAuthClient.findUnique({ where: { id } });
  if (!c) return false;
  const now = new Date();
  await db.$transaction([
    db.oAuthClient.update({ where: { id }, data: { revokedAt: c.revokedAt ?? now } }),
    db.oAuthGrant.updateMany({ where: { clientId: id, revokedAt: null }, data: { revokedAt: now } }),
    db.apiToken.updateMany({ where: { oauthClientId: id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await audit({ type: "user", id: byUserId }, "oauth.revoke", { type: "oauth_client", id }, { after: { client: c.name } });
  return true;
}
