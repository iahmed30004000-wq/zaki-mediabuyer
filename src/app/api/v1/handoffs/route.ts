import { NextResponse } from "next/server";
import { HANDOFF_STATUSES, type HandoffStatus } from "@/core/handoff";
import { invalid, withHandoffToken } from "@/server/handoff-api";
import { HandoffCreate, createHandoff, listHandoffs } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/handoffs?status=open,claimed&assignee=claude&workflow=daily-check — what is waiting for someone.
 * Claude Desktop polls this, takes one (POST …/:id/claim), does it, and answers (POST …/:id/complete).
 */
export async function GET(req: Request) {
  return withHandoffToken(req, async () => {
    const q = new URL(req.url).searchParams;
    const status = (q.get("status") ?? "open,claimed").split(",").map((s) => s.trim()).filter((s): s is HandoffStatus => (HANDOFF_STATUSES as readonly string[]).includes(s));
    const limit = Number(q.get("limit") ?? 50);
    const handoffs = await listHandoffs({ status, assignee: q.get("assignee") ?? undefined, workflow: q.get("workflow") ?? undefined, limit: Number.isFinite(limit) ? limit : 50 });
    return NextResponse.json({ handoffs });
  });
}

/** POST /api/v1/handoffs — hand a step over (it failed, timed out, waits on a connection, or needs an answer). */
export async function POST(req: Request) {
  return withHandoffToken(req, async ({ actor }) => {
    const parsed = HandoffCreate.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues);
    const r = await createHandoff(parsed.data, actor);
    return NextResponse.json({ handoff: r.handoff, created: r.created }, { status: r.created ? 201 : 200 });
  });
}
