import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused, cancelHandoff, completeHandoff, reassignHandoff } from "@/server/handoffs";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reassign"), assignee: z.string().trim().min(1).max(40) }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("complete"), note: z.string().trim().min(1).max(300).optional() }).strict(),
]);

/**
 * PATCH /api/handoffs/:id — the owner decides what happens to a handoff from the site:
 * give it to someone else (reassign), drop it (cancel — the run it held up is marked skipped), or mark it done by hand.
 */
export async function PATCH(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("work.control");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const actor = { type: "user" as const, id: caller.id };
    try {
      const b = parsed.data;
      if (b.action === "reassign") return NextResponse.json({ ok: true, handoff: await reassignHandoff(params.id, b.assignee, actor) });
      if (b.action === "cancel") return NextResponse.json({ ok: true, handoff: await cancelHandoff(params.id, actor) });
      const r = await completeHandoff(params.id, { ...(b.note ? { note: b.note } : {}) }, `owner:${caller.id}`.slice(0, 60), actor, new Date(), { owner: true });
      return NextResponse.json({ ok: true, handoff: r.handoff, run: r.run });
    } catch (e) {
      if (e instanceof HandoffRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
