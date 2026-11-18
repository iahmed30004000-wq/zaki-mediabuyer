import { NextResponse } from "next/server";
import { z } from "zod";
import { killSwitch } from "@/server/changes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isDemo } from "@/core/readiness";

/** POST /api/kill-switch {scope: "all" | "act_…", confirm: "اوقف"} — the second confirmation is the typed word. */
const Body = z.object({ scope: z.string().regex(/^(all|act_\d+)$/), confirm: z.literal("اوقف") });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "للتأكيد لازم تكتب «اوقف»");
    const caller = await requireCapability("ads.pause");
    // demo numbers are not real campaigns: say so, change nothing
    if (isDemo(process.env)) return NextResponse.json({ ok: true, demo: true });
    return NextResponse.json({ ok: true, ...(await killSwitch(parsed.data.scope, caller)) });
  } catch (e) {
    return errorResponse(e);
  }
}
