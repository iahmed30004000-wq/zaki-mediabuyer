import { NextResponse } from "next/server";
import { z } from "zod";
import { proposeRaise } from "@/server/ads-actions";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

const Body = z.object({ objectType: z.enum(["campaign", "adset"]), objectId: z.string().min(3) });

/**
 * POST /api/objects/scale — «اقترح زيادة» on a row: ONE step of the ladder on the object's own daily budget, as a proposal.
 * It never spends: see `proposeRaise` — only a person's yes (on the site) executes it.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("propose_change");
    // demo numbers are not real campaigns (their ids are not Meta ids either): say so, change nothing
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    return NextResponse.json({ ok: true, ...(await proposeRaise(parsed.data, caller)) });
  } catch (e) {
    return errorResponse(e);
  }
}
