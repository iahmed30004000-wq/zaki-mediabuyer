import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { HttpError, errorResponse, requireCapability } from "@/server/auth";
import { HandoffRefused } from "@/server/handoffs";
import { RUN_ACTIONS, cancelRun, dismissMissed, reassignRun, retryRun, skipRunStep } from "@/server/run-actions";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    /** reassign: لمين (مفتاح وكيل أو شخص) */
    assignee: z.string().trim().min(1).max(40).optional(),
    /** skip: الخطوة (الافتراضي: اللي وقف عندها التشغيل) */
    node: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

/**
 * POST /api/jobs/:key/runs/:id/{retry|skip|cancel|reassign} — the owner's buttons on a run that stopped (docs/rebuild-v6/01-model.md §8):
 *   retry     أعد المحاولة من هون: the run goes back in the queue from where it stopped, one try more
 *   skip      تخطّى هالخطوة: the step that stopped is set aside and the run goes on from the one after it
 *   cancel    ألغِ التشغيل: the run ends, and the agent is told to stop
 *   reassign  سلّمها لغيره: the request this run waits on goes to somebody else (body: { assignee })
 *   dismiss   تجاهل: a slot that was missed becomes «انتخطت» (v6 · P3) — it leaves the lane of the missed
 * The site does not run the steps: it asks the job's agent. Nothing here spends or touches Meta.
 */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ key: string; id: string; action: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("work.control");
    if (!(RUN_ACTIONS as readonly string[]).includes(params.action)) throw new HttpError(404, "الزر مش معروف");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const actor = { type: "user" as const, id: caller.id };
    try {
      const b = parsed.data;
      const r =
        params.action === "retry"
          ? await retryRun(params.key, params.id, actor)
          : params.action === "skip"
            ? await skipRunStep(params.key, params.id, actor, new Date(), b.node, { role: caller.role })
            : params.action === "cancel"
              ? await cancelRun(params.key, params.id, actor)
              : params.action === "dismiss"
                ? await dismissMissed(params.key, params.id, actor)
                : await reassignRun(params.key, params.id, b.assignee ?? "", actor);
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      if (e instanceof HandoffRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
