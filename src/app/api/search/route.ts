import { NextResponse } from "next/server";
import { searchable } from "@/core/search";
import { errorResponse, requireSignedIn } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";
import { searchData } from "@/server/search";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=… — names that match (products, workflows, tasks, videos, ads, campaigns), each with the screen that shows it. Names and links only.
 * What is found depends on the caller's role (S-18): only the kinds he may open, the jobs of his areas and the tasks of his scope.
 */
export async function GET(req: Request) {
  try {
    const me = await requireSignedIn();
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
    if (!searchable(q)) return NextResponse.json({ hits: [] });
    return NextResponse.json({ hits: await searchData(q, { role: me.role, taskKeys: await taskKeysFor(me) }) });
  } catch (e) {
    return errorResponse(e);
  }
}
