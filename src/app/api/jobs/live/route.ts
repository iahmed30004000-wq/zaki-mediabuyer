import { NextResponse } from "next/server";
import { isDemo } from "@/core/readiness";
import { HttpError, errorResponse, requireCapability } from "@/server/auth";
import { loadLive } from "@/server/jobs-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/live?since=<ISO> — what is going on right now (docs/rebuild-v6/01-model.md §13): the agents (running · awake · silent), the runs that are
 * queued, running or waiting plus the ones that changed after `since`, each with its steps' lamps and the sentence under the rope, and the requests nobody
 * has taken. No drawings, one query per table. (The scheduled jobs live under /api/jobs because /api/tasks is for the people's tasks.)
 */
export async function GET(req: Request) {
  try {
    await requireCapability("work.view");
    const now = new Date();
    if (isDemo(process.env)) return NextResponse.json({ at: now.toISOString(), agents: [], runs: [], queue: [] });
    const raw = new URL(req.url).searchParams.get("since");
    let since: Date | null = null;
    if (raw) {
      since = new Date(raw);
      if (Number.isNaN(since.getTime())) throw new HttpError(400, "since: وقت مش صحيح (ISO)");
    }
    return NextResponse.json(await loadLive({ since, now }));
  } catch (e) {
    return errorResponse(e);
  }
}
