import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { RunRefused, WorkflowCreate, createWorkflow } from "@/server/workflows";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflow — `{ name, template?, copy_of?, description? }`: a new workflow from a template (blank · daily · approval ·
 * person) or a copy of another, laid out and saved as its first version. The owner only; on the demo nothing is saved.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = WorkflowCreate.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    try {
      const workflow = await createWorkflow(parsed.data, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, workflow }, { status: 201 });
    } catch (e) {
      if (e instanceof RunRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
