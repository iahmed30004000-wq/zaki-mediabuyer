import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isDemo } from "@/core/readiness";
import { DecisionsInput, applyDecisions } from "@/server/jobs";
import { RunRefused } from "@/server/workflows";

export const dynamic = "force-dynamic";

/**
 * POST /api/work/decisions — the owner's decision sheet: `{ items: [{ key, decision: "keep"|"cancel"|"merge", branches?: { [nodeId]: boolean } }] }`.
 * One transaction (switch off / record / merge), a new drawing version for each branch switched off, ONE handoff to Claude in numbers,
 * a line in the audit per job. It spends nothing and touches nothing on Meta.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("work.control");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = DecisionsInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "ورقة القرار مش مفهومة: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    try {
      return NextResponse.json({ ok: true, ...(await applyDecisions(parsed.data, { type: "user", id: caller.id })) });
    } catch (e) {
      if (e instanceof RunRefused) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
