import { makeLimiter } from "@/core/rate-limit";
import { oauthError } from "@/core/oauth";
import { registerClient } from "@/server/oauth";
import { clientIp, jsonError, jsonOk, preflight } from "@/server/oauth-http";

export const dynamic = "force-dynamic";

const limit = makeLimiter(20, 60_000);

/** POST /oauth/register — dynamic client registration (RFC 7591). Open (the client has no account), but only Claude's own and local addresses are accepted back, and nothing works until the owner approves. */
export async function POST(req: Request) {
  const rl = limit(clientIp(req));
  if (!rl.ok) return jsonError(429, oauthError("server_error", `كتير طلبات — جرّب بعد ${rl.retryAfterS} ثانية`));
  const raw = await req.text();
  let body: unknown = null;
  try {
    body = raw.length <= 20_000 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return jsonError(400, oauthError("invalid_client_metadata", "ابعت JSON بـ redirect_uris"));
  const r = await registerClient(body);
  return r.ok ? jsonOk(r.data, 201) : jsonError(r.status, r.body);
}

export const OPTIONS = preflight;
