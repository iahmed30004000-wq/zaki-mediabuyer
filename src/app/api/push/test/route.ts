import { NextResponse } from "next/server";
import { z } from "zod";
import { sendTestPush } from "@/jobs/notify-dispatch";
import { isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireSignedIn } from "@/server/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ ring: z.boolean().optional() }).strict();

/** One test at a time per person, a few seconds apart (a button pressed ten times is not ten phones ringing). */
const last = new Map<string, number>();
const COOLDOWN_MS = 5_000;

/**
 * POST /api/push/test `{ ring? }` — a test notification to the caller's OWN phones, through the same road as any other. It says what happened: «انبعت» only when a phone took it, «لازم تربط Firebase»
 * when the setup is not done, «ما في جهاز» when this person has none. No notice is written (the bell is not cluttered by a test).
 */
export async function POST(req: Request) {
  try {
    const caller = await requireSignedIn();
    const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: false, sent: 0, failed: 0, reason: "setup_needed" });
    const now = Date.now();
    if (now - (last.get(caller.id) ?? 0) < COOLDOWN_MS) throw new HttpError(429, "استنى كم ثانية وجرّب كمان مرة");
    last.set(caller.id, now);
    return NextResponse.json(await sendTestPush(caller.id, { ring: parsed.data.ring }));
  } catch (e) {
    return errorResponse(e);
  }
}
