import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { setSetting } from "@/server/settings";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

const Body = z.object({ value: z.number().positive().max(100_000).nullable() }).strict();

/**
 * PUT /api/videos/min-spend — `{ value }`: the least a video must spend over its last 7 days before it is ranked as a winner.
 * `null` goes back to the default (twice the cost he aims for per order). The owner types it; nothing is committed in code.
 */
export async function PUT(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "رقم مش صحيح");
    await setSetting("videos.min_spend", parsed.data.value, caller.id);
    return NextResponse.json({ ok: true, value: parsed.data.value });
  } catch (e) {
    return errorResponse(e);
  }
}
