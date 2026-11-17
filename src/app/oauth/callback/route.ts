import { NextResponse } from "next/server";
import { HttpError, requireCapability } from "@/server/auth";
import { appOrigin } from "@/server/env";
import { completeLink } from "@/server/oauth-client";

export const dynamic = "force-dynamic";

/**
 * GET /oauth/callback — the other system sends the owner back here after «اسمح». Needs the owner's session (it is not on the open list), the state must be
 * the one we made for that owner, and the code is exchanged server-side. We go back to the page with a short word, never with the code or a token in the address.
 */
export async function GET(req: Request) {
  const back = (q: string) => NextResponse.redirect(`${appOrigin()}/settings/connections?${q}`, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  try {
    const caller = await requireCapability("owner_only");
    const u = new URL(req.url);
    if (u.searchParams.get("error")) return back("link_error=denied");
    const state = u.searchParams.get("state");
    const code = u.searchParams.get("code");
    if (!state || !code) return back("link_error=missing");
    const r = await completeLink(state, code, caller.id);
    return back(`linked=${encodeURIComponent(r.key)}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return NextResponse.redirect(`${appOrigin()}/login?next=${encodeURIComponent("/settings/connections")}`, { status: 303 });
    return back(`link_error=${encodeURIComponent(e instanceof HttpError ? e.message.slice(0, 120) : "failed")}`);
  }
}
