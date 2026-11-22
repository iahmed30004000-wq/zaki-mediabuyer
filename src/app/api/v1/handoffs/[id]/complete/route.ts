import { NextResponse } from "next/server";
import { invalid, withHandoffToken } from "@/server/handoff-api";
import { HandoffComplete, completeHandoff } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/handoffs/:id/complete — answer it: `{ note, result: {…}, run_status: "ok" | "failed" | "running", claim }` (`claim` = the code claim gave you).
 * A run the owner asked for ends with the answer; a stuck step unblocks its run (the caller goes on and reports with log_run).
 */
export async function POST(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  return withHandoffToken(req, async ({ by, actor, actorKey }) => {
    const parsed = HandoffComplete.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return invalid(parsed.error.issues);
    const r = await completeHandoff(params.id, parsed.data, by, actor, new Date(), { actorKey });
    return NextResponse.json({ handoff: r.handoff, run: r.run });
  });
}
