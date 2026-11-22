import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS } from "@/core/assistant";
import { isDemo } from "@/core/readiness";
import { DRAFT_NEEDS_KEY, OFF_BY_PRIVACY, assistantConfigured, externalModelsOff } from "@/server/assistant/config";
import { draftJobFromSentence } from "@/server/assistant/draft-job";
import { failure } from "@/server/assistant/failure";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ sentence: z.string().trim().min(3, "اكتب المهمة بجملة").max(LIMITS.question, `الجملة لحد ${LIMITS.question} حرف`) }).strict();

/**
 * POST /api/assistant/draft-job — «اكتبها بجملة» (docs/rebuild-v6/02-screens.md §3.7). The sentence goes to the assistant, which can do one thing: turn it into a job draft through `draft_job`.
 * The answer is the draft (the same shape `POST /api/jobs` takes) and its sentence — or the assistant's own question when something was missing. NOTHING IS SAVED: the owner reads «هيك فهمتها — صح؟»
 * and presses «اعتمدها», which is the one save every way of making a job ends in. The owner and the manager (`work.create`) who may use the assistant (`assistant.use`). With no key linked it says so plainly
 * (`setup: true`) and the other two ways keep working; the sentence goes through the privacy filter like every question, and the model is never given a customer, a token or a phone number.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("work.create");
    await requireCapability("assistant.use");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "اكتب المهمة بجملة");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true, draft: null, sentence: null, say: "بالوضع التجريبي ما في مساعد. ركّب المهمة بإيدك أو من قالب." });
    if (externalModelsOff()) return NextResponse.json({ ok: false, setup: false, error: OFF_BY_PRIVACY }, { status: 403 });
    if (!(await assistantConfigured())) return NextResponse.json({ ok: false, setup: true, error: DRAFT_NEEDS_KEY }, { status: 503 });
    try {
      const r = await draftJobFromSentence(parsed.data.sentence, caller);
      return NextResponse.json({ ok: true, draft: r.draft, sentence: r.sentence, say: r.say });
    } catch (e) {
      const f = failure(e);
      return NextResponse.json({ ok: false, setup: f.code === "off", error: f.message, ...(f.code ? { code: f.code } : {}) }, { status: f.status });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
