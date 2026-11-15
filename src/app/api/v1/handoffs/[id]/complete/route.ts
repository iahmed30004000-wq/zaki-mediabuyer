import { NextResponse } from "next/server";
import { invalid, withHandoffToken } from "@/server/handoff-api";
import { HandoffComplete, completeHandoff } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/handoffs/:id/complete — answer it: `{ note, result: {…}, run_status: "ok" | "failed" | "running" }`.
 * A run the owner asked for ends with the answer; a stuck step unblocks its run (the caller goes on and reports with log_run).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withHandoffToken(req, async ({ by, actor }) => {
    const parsed = HandoffComplete.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return invalid(parsed.error.issues);
    const r = await completeHandoff(params.id, parsed.data, by, actor);
    return NextResponse.json({ handoff: r.handoff, run: r.run });
  });
}
