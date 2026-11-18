import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { getRules, saveRules } from "@/server/rules";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/** GET /api/rules — the campaign rules v2 as they are now: the numbers, the 14 sentences, what is still missing. */
export async function GET() {
  try {
    await requireCapability("ads.view");
    return NextResponse.json(await getRules());
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT /api/rules — the owner saves the rules (a new version; any old one can come back). Claude reads them with `get_rules`. */
export async function PUT(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const body = await req.json().catch(() => null);
    try {
      return NextResponse.json({ ok: true, ...(await saveRules(body, caller.id)) });
    } catch (e) {
      if (e instanceof ZodError) throw new HttpError(400, "قاعدة مش صحيحة: " + e.issues.slice(0, 3).map((i) => `${i.path.join(".")} — ${i.message}`).join(" · "));
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
