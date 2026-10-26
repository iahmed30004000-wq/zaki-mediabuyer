import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { prepareChange } from "@/agents/preparer";
import { AgentUnavailable } from "@/gateway";

const Body = z.object({ text: z.string().trim().min(3).max(1200) });

/** POST /api/agents/prepare — M04: a sentence becomes a change set the code checked; it waits for a person under «القرارات». */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اكتب شو بدك يتغيّر");
    await requireCapability("propose_change");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true, refused: [], items: [] });
    try {
      const r = await prepareChange(parsed.data.text);
      return NextResponse.json({ ok: true, changeSetId: r.changeSet.id, state: r.changeSet.state, items: r.items.length, refused: r.refused, warnings: r.warnings });
    } catch (e) {
      if (e instanceof AgentUnavailable) throw new HttpError(503, "ما في موديل موصول لمعدّ التغييرات — اعمل التغيير من «الإعلانات»");
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
