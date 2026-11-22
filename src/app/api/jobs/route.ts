import { NextResponse } from "next/server";
import { JobDraftSchema } from "@/core/job-draft";
import { isDemo } from "@/core/readiness";
import { errorResponse, requireCapability } from "@/server/auth";
import { DraftRefused, createJobFromDraft } from "@/server/jobs-create";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs — «اعتمد المهمة» (docs/rebuild-v6/02-screens.md §3.7): the draft of «مهمة جديدة» (`{ draft }`, or the draft itself) is checked, turned into a job with the next number
 * and `source: "ui"`, and saved; a one-time job for a person is a task instead. The owner and the manager (`work.create`). It spends nothing and changes nothing on Meta:
 * a job only describes work. With sign-in switched off (the demo) nothing is saved. The scheduled jobs live under /api/jobs because /api/tasks is for the people's tasks.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("work.create");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const body: unknown = await req.json().catch(() => null);
    const raw = body && typeof body === "object" && "draft" in body ? (body as { draft: unknown }).draft : body;
    const parsed = JobDraftSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "المسودة مش مفهومة — حدّث الصفحة وجرّب كمان مرة", field: parsed.error.issues[0]?.path.join(".") || undefined }, { status: 400 });
    try {
      const created = await createJobFromDraft(parsed.data, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, ...created }, { status: 201 });
    } catch (e) {
      if (e instanceof DraftRefused) return NextResponse.json({ ok: false, error: e.message, ...(e.field ? { field: e.field } : {}) }, { status: e.status });
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
