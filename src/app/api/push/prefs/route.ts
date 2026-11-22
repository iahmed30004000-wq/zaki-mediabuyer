import { NextResponse } from "next/server";
import { isDemo } from "@/core/readiness";
import { errorResponse, requireSignedIn } from "@/server/auth";
import { getPrefs, setPrefs } from "@/server/push-devices";

export const dynamic = "force-dynamic";

/** GET /api/push/prefs — the person's own choices per kind of notice (ring · silent · site); a kind they never chose is not in the answer (the default applies). */
export async function GET() {
  try {
    const caller = await requireSignedIn();
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ prefs: {} });
    return NextResponse.json({ prefs: await getPrefs(caller.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT /api/push/prefs `{ [kind]: "ring" | "silent" | "site" }` — saves some of the caller's own choices; the rest stay. */
export async function PUT(req: Request) {
  try {
    const caller = await requireSignedIn();
    const body = await req.json().catch(() => null);
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true, prefs: {} });
    return NextResponse.json({ ok: true, prefs: await setPrefs(caller.id, body) });
  } catch (e) {
    return errorResponse(e);
  }
}
