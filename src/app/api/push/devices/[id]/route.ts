import { NextResponse } from "next/server";
import { isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireSignedIn } from "@/server/auth";
import { removeDevice } from "@/server/push-devices";

export const dynamic = "force-dynamic";

/** DELETE /api/push/devices/[id] — «شيله»: the person's own device stops being pushed to. Somebody else's id is «مش موجود» (it does not say it exists). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireSignedIn();
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new HttpError(404, "الجهاز مش موجود");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    await removeDevice(caller.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
