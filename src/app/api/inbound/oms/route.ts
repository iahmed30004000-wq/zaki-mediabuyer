import { NextResponse } from "next/server";
import { makeLimiter } from "@/core/rate-limit";
import { MAX_BODY_BYTES, parseStopEvent, stopTarget } from "@/core/oms-event";
import { verifySignature } from "@/core/step-exec";
import { stopByQuery } from "@/server/stop-by-query";

export const dynamic = "force-dynamic";

const SITE = () => process.env.APP_URL ?? "https://mediabuyer.zakiai.io";
const limit = makeLimiter(30, 60_000);
const NO_STORE = { "Cache-Control": "no-store" };
const refuse = (status: number, code: string, message: string, extra?: Record<string, string>) => NextResponse.json({ ok: false, code, message }, { status, headers: { ...NO_STORE, ...extra } });

/**
 * POST /api/inbound/oms — the OMS owns the Telegram bot; when the owner writes «اوقف CR00147» to it, the OMS sends this signed event
 * (contracts/oms-mediabuyer.v1.json → oms.stop-event). There is no session and no token here: the proof is the signature,
 * HMAC-SHA256 of «<X-Zaki-Timestamp>.<raw body>» with OMS_EVENT_SECRET (entered on «الإعدادات ← الربط», sealed; falls back to the environment),
 * the timestamp not older than five minutes. Without the secret set, every call is refused.
 * It does what the Telegram webhook does and nothing more: it PAUSES. A sentence that asks for anything that spends is answered with the site.
 */
export async function POST(req: Request) {
  const secret = process.env.OMS_EVENT_SECRET ?? "";
  const ts = req.headers.get("x-zaki-timestamp") ?? "";
  const sig = req.headers.get("x-zaki-signature") ?? "";
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return refuse(400, "VALIDATION_FAILED", "الطلب كبير");
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(400, "VALIDATION_FAILED", "الطلب كبير");

  // the signature first, over the exact bytes received: nothing is parsed, searched or written for a call that is not the OMS's
  if (!secret || !ts || !sig || !verifySignature(secret, ts, raw, sig, Date.now())) return refuse(401, "SIGNATURE_INVALID", "التوقيع مش صحيح أو قديم");

  const rl = limit("oms");
  if (!rl.ok) return refuse(429, "RATE_LIMITED", `كتير نداءات — جرّب بعد ${rl.retryAfterS} ثانية`, { "Retry-After": String(rl.retryAfterS) });

  const parsed = parseStopEvent(raw);
  if (!parsed.ok) return refuse(400, "VALIDATION_FAILED", "حدث مش معروف أو فيه حقل زيادة");

  const target = stopTarget(parsed.event.query);
  if (target.kind === "site_only") return NextResponse.json({ ok: true, reply: `${target.what} من الموقع بس، بعد ما تشوف الأثر المالي: ${SITE()}/inbox` }, { headers: NO_STORE });
  const reply = await stopByQuery(target.query, { id: `oms:${parsed.event.sourceChat}` }, `oms:${parsed.event.sourceChat}`);
  return NextResponse.json({ ok: true, reply: reply.slice(0, 500) }, { headers: NO_STORE });
}
