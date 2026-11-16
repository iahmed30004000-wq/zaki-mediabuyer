import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { HandoffRefused } from "@/server/handoffs";
import { VideoRequestCreate, createVideoRequest } from "@/server/video-requests";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/request — `{ key, kind, note? }`: one of the four buttons of a video's card. It makes ONE request (a card on
 * المهام for Hermes, delivered to Hermes by its API or its chat) carrying the video's JOB, scenario file and numbers.
 * The numbers are computed here; the caller only says which video and what for. On the demo nothing is saved.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("ads.propose");
    // the demo's videos are made up: nothing is asked of anyone for them
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const parsed = VideoRequestCreate.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    try {
      const r = await createVideoRequest(parsed.data, { type: "user", id: caller.id });
      return NextResponse.json({ ok: true, ...r }, { status: r.created ? 201 : 200 });
    } catch (e) {
      if (e instanceof HandoffRefused) throw new HttpError(e.status, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
