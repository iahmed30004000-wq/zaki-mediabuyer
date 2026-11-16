import { NextResponse } from "next/server";
import { z } from "zod";
import { REQUEST_STATUSES } from "@/core/video-board";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused } from "@/server/handoffs";
import { moveVideoRequest } from "@/server/video-requests";

export const dynamic = "force-dynamic";

const Body = z.object({ to: z.enum(REQUEST_STATUSES) }).strict();

/** PATCH /api/video-requests/:id — `{ to }`: move the request along (عند هيرمز · جاهز · مرفوع), give it back (طلب) or cancel it. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const caller = await requireCapability("ads.propose");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    try {
      return NextResponse.json({ ok: true, request: await moveVideoRequest(params.id, parsed.data.to, { type: "user", id: caller.id }) });
    } catch (e) {
      if (e instanceof HandoffRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
