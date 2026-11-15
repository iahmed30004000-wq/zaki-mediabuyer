import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeColumns } from "@/core/ads-table";
import { saveColumns } from "@/server/ads-prefs";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

const Body = z.object({ columns: z.array(z.string().max(30)).max(40) });

/** PUT /api/ads/columns — the columns this person wants in «الإعلانات», saved for them (not for the team). */
export async function PUT(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const caller = await requireCapability("view");
    // the demo caller has no account to save for: the page keeps the choice for the session
    if (caller.demo) return NextResponse.json({ ok: true, demo: true, columns: sanitizeColumns(parsed.data.columns) });
    return NextResponse.json({ ok: true, columns: await saveColumns(caller.id, parsed.data.columns) });
  } catch (e) {
    return errorResponse(e);
  }
}
