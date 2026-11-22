import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { RunRefused, WorkflowPatch, runsOf, updateWorkflow } from "@/server/workflows";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/** GET /api/workflow/:key?status=failed — the run history of one workflow. */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    await requireCapability("work.view");
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    return NextResponse.json({ runs: await runsOf(params.key, { status }) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/workflow/:key — the owner edits a workflow, or switches it off (the kill switch of that job). Nothing is deleted. */
export async function PATCH(req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = WorkflowPatch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    try {
      const card = await updateWorkflow(params.key, parsed.data, { type: "user", id: caller.id });
      if (!card && !parsed.data.archived) throw new HttpError(404, "المهمة مش موجود");
      return NextResponse.json({ ok: true, workflow: card });
    } catch (e) {
      if (e instanceof RunRefused) throw new HttpError(400, e.message);
      if (e instanceof ZodError) throw new HttpError(400, "الرسم مش صحيح");
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
