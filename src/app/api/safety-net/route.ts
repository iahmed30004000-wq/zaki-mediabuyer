import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { proposeSafetyNet } from "@/server/safety-net";

const Body = z.object({ accountMetaId: z.string().min(3) });

/** POST /api/safety-net — prepare the safety net on Meta for one account; it waits for the owner under «القرارات». */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اختار حساب");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const cs = await proposeSafetyNet(parsed.data.accountMetaId, { type: "user", id: caller.id }, { reset: false, source: "user" });
    return NextResponse.json({ ok: true, changeSetId: cs.id, state: cs.state });
  } catch (e) {
    return errorResponse(e);
  }
}
