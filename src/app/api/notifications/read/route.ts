import { NextResponse } from "next/server";
import { z } from "zod";
import { isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireSignedIn } from "@/server/auth";
import { markBellRead } from "@/server/notifications";

export const dynamic = "force-dynamic";

const Body = z.object({ ids: z.array(z.string().trim().min(1).max(40)).max(100).optional() }).strict();

/** POST /api/notifications/read — «علّم الكل مقروء» (`{}`), or only these ids (`{ ids: [...] }`): the person's own notices, nobody else's. */
export async function POST(req: Request) {
  try {
    const caller = await requireSignedIn();
    const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true, marked: 0 });
    return NextResponse.json({ ok: true, marked: await markBellRead(caller, parsed.data.ids) });
  } catch (e) {
    return errorResponse(e);
  }
}
