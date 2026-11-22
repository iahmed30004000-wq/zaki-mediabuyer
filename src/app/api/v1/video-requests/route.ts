import { NextResponse } from "next/server";
import { REQUEST_STATUSES, type RequestStatus } from "@/core/video-board";
import { withHandoffToken } from "@/server/handoff-api";
import { listVideoRequests } from "@/server/video-requests";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/video-requests?status=asked,with_hermes&product=TRF01 — the requests about videos (hooks, scenarios, a test,
 * a tired one) waiting for Hermes. Each carries the video's JOB, its scenario file and the numbers. Take one with
 * POST …/:id/claim, answer with POST …/:id/complete. The same «طابور التسليم» token as the handoffs.
 */
export async function GET(req: Request) {
  return withHandoffToken(req, async () => {
    const q = new URL(req.url).searchParams;
    const status = (q.get("status") ?? "asked,with_hermes").split(",").map((s) => s.trim()).filter((s): s is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(s));
    const limit = Number(q.get("limit") ?? 50);
    return NextResponse.json({ requests: await listVideoRequests({ status, product: q.get("product") ?? undefined, limit: Number.isFinite(limit) ? limit : 50 }) });
  }, "videos");
}
