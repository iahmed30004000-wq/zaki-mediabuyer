import { NextResponse } from "next/server";
import { z } from "zod";
import { ENTITIES } from "@/core/customize";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { runButton } from "@/server/customize";

export const dynamic = "force-dynamic";

const Body = z.object({ buttonId: z.string().trim().min(1).max(40), entity: z.enum(ENTITIES), entityId: z.string().trim().min(1).max(120) }).strict();

/**
 * POST /api/ui/button — a button on a card, pressed. Like «شغّل هلق» it hands the workflow to Claude through the queue of handoffs
 * (one at a time per card), carrying the card's own words; it spends nothing and changes nothing on Meta. On the demo nothing runs.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const r = await runButton(parsed.data.buttonId, parsed.data.entity, parsed.data.entityId, caller);
    return NextResponse.json({ ok: true, created: r.created, handoff: r.handoff });
  } catch (e) {
    return errorResponse(e);
  }
}
