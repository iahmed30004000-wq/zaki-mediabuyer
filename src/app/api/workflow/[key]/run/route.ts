import { NextResponse } from "next/server";
import { isRecipeName } from "@/core/recipes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused, requestRun } from "@/server/handoffs";
import { loadJob } from "@/server/job-map";
import { RecipeRefused, runRecipe } from "@/server/recipes";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflow/:key/run — «شغّل هلق». The app does not run an agent's jobs: Claude does. This hands the job to Claude through the
 * handoff queue (one request at a time per workflow); Claude takes it, runs it and logs its steps, and the card moves.
 * The one exception is a job that is one of the site's own recipes (v6 · P4-2): nobody in the queue could take it, so the site carries it out right now (read · compare · tell) and answers with how it ended.
 * It spends nothing and changes nothing on Meta — anything that needs the owner's yes still asks for it.
 */
export async function POST(_req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("work.control");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    try {
      const job = await loadJob(params.key);
      if (job && !job.archivedAt && job.wake === "site_run" && isRecipeName(job.recipe)) {
        const r = await runRecipe(job.key, { type: "user", id: caller.id });
        return NextResponse.json({ ok: true, created: true, site: true, status: r.status, summary: r.summary, runId: r.runId });
      }
      const r = await requestRun(params.key, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, created: r.created, ...(r.since ? { since: r.since } : {}), handoff: r.handoff });
    } catch (e) {
      if (e instanceof HandoffRefused || e instanceof RecipeRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
