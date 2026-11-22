import { NextResponse } from "next/server";
import { isRecipeName } from "@/core/recipes";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused } from "@/server/handoffs";
import { loadJob } from "@/server/job-map";
import { RecipeRefused, runRecipe } from "@/server/recipes";
import { ExecRefused, executeWorkflow } from "@/server/step-exec";
import { UnknownJob } from "@/server/workflows";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/workflow/:key/execute — «شغّلها من الموقع». The site walks the straight line of GREEN steps whose doer is n8n, an HTTP
 * address or Telegram — only to targets the owner listed in the server's environment — logs each step on the run, and hands the first
 * step it may not run (or one that failed) to the handoff queue. A job that is one of the site's own recipes (v6 · P4-2) is carried out by the site itself: read · compare · tell.
 * Owner only: it calls out of the site. Spends nothing, touches no Meta.
 */
export async function POST(_req: Request, { params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    try {
      const job = await loadJob(params.key);
      if (job && !job.archivedAt && job.wake === "site_run" && isRecipeName(job.recipe)) {
        const r = await runRecipe(job.key, { type: "user", id: caller.id });
        return NextResponse.json({ ok: true, site: true, ...r });
      }
      const r = await executeWorkflow(params.key, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      if (e instanceof ExecRefused || e instanceof HandoffRefused || e instanceof RecipeRefused) throw new HttpError(e.status, e.message);
      if (e instanceof UnknownJob) throw new HttpError(404, "المهمة مش موجود");
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
