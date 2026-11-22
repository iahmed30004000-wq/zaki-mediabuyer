import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { HttpError, errorResponse, requireCapability } from "@/server/auth";
import { RunRefused, WorkflowConflict, setStepEnabled } from "@/server/workflows";

export const dynamic = "force-dynamic";

const Body = z.object({ enabled: z.boolean() }).strict();

/**
 * POST /api/jobs/:key/steps/:id { enabled } — switches ONE step of a job on or off (docs/rebuild-v6/01-model.md §14). The server flips that step on the
 * drawing as it is now, so a switch from a stale page, or two quick switches, cannot undo each other. The agent is told by its next `log_run` answer.
 */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ key: string; id: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    try {
      const r = await setStepEnabled(params.key, params.id, parsed.data.enabled, { type: "user", id: caller.id });
      if (!r) throw new HttpError(404, "المهمة مش موجودة");
      return NextResponse.json({ ok: true, changed: r.changed, version: r.card.version, workflow: r.card });
    } catch (e) {
      if (e instanceof WorkflowConflict) throw new HttpError(409, e.message);
      if (e instanceof RunRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
