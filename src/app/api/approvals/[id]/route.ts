import { NextResponse } from "next/server";
import { DecisionInput, decideApproval } from "@/server/approvals";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/:id {action: approve | reject | postpone | cancel, note?, until?} — the owner's answer to a request.
 * A session of the owner only: not a token, not Telegram. Claude reads the answer with `get_approvals`.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("inbox.view");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = DecisionInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const approval = await decideApproval(params.id, parsed.data, caller);
    return NextResponse.json({ ok: true, approval });
  } catch (e) {
    return errorResponse(e);
  }
}
