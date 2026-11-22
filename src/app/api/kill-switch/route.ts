import { NextResponse } from "next/server";
import { z } from "zod";
import { killSwitch } from "@/server/changes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isDemo } from "@/core/readiness";
import { stopSentence, type StopResult } from "@/core/stop-result";

/** POST /api/kill-switch {scope: "all" | "act_…", confirm: "اوقف"} — the second confirmation is the typed word. Answers with what really happened (src/core/stop-result.ts). */
const Body = z.object({ scope: z.string().regex(/^(all|act_\d+)$/), confirm: z.literal("اوقف") });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "للتأكيد لازم تكتب «اوقف»");
    const caller = await requireCapability("ads.pause");
    // demo numbers are not real campaigns: a trial, nothing sent
    if (isDemo(process.env)) {
      const trial: StopResult = { state: "trial", done: 0, failed: 0, reachedMeta: false, failures: [], changeSetId: null, objects: 0 };
      return NextResponse.json({ ok: true, demo: true, ...trial, sentence: stopSentence(trial) });
    }
    const result = await killSwitch(parsed.data.scope, caller);
    return NextResponse.json({ ok: true, ...result, sentence: stopSentence(result) });
  } catch (e) {
    return errorResponse(e);
  }
}
