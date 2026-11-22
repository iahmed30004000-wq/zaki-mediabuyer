import { makeLimiter } from "@/core/rate-limit";
import { oauthError } from "@/core/oauth";
import { exchangeCode, refreshGrant } from "@/server/oauth";
import { clientIp, jsonError, jsonOk, preflight, readParams } from "@/server/oauth-http";

export const dynamic = "force-dynamic";

const limit = makeLimiter(60, 60_000);

/** POST /oauth/token — authorization_code (with the PKCE verifier) or refresh_token. Public clients: no secret to check, so the code itself, the address and the verifier are everything. */
export async function POST(req: Request) {
  const rl = limit(clientIp(req));
  if (!rl.ok) return jsonError(429, oauthError("server_error", `كتير طلبات — جرّب بعد ${rl.retryAfterS} ثانية`));
  const f = await readParams(req);
  const type = f.get("grant_type");
  const r = type === "authorization_code" ? await exchangeCode(f) : type === "refresh_token" ? await refreshGrant(f) : null;
  if (!r) return jsonError(400, oauthError("unsupported_grant_type", "نوع الطلب مش مدعوم"));
  return r.ok ? jsonOk(r.data) : jsonError(r.status, r.body);
}

export const OPTIONS = preflight;
