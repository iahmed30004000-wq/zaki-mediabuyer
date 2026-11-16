import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused, requestRun } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflow/:key/run — «شغّل هلق». The app does not run jobs: Claude does. This hands the job to Claude through the
 * handoff queue (one request at a time per workflow); Claude takes it, runs it and logs its steps, and the card moves.
 * It spends nothing and changes nothing on Meta — anything that needs the owner's yes still asks for it.
 */
export async function POST(_req: Request, { params }: { params: { key: string } }) {
  try {
    const caller = await requireCapability("work.control");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    try {
      const r = await requestRun(params.key, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, created: r.created, handoff: r.handoff });
    } catch (e) {
      if (e instanceof HandoffRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
