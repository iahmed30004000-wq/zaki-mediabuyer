import { NextResponse } from "next/server";
import { missingText } from "@/core/readiness";
import { summaryOfDay } from "@/core/day";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";
import { loadDay, readDay } from "@/lib/day-view";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/done/share?day=2026-11-14 — the day (what was done, what is planned) as a short summary on the owner's Telegram.
 * The text is written by the code (src/core/day.ts) from the same lines the screen shows. This only reports.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("money.view");
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const tg = telegramFromEnv();
    if (!tg) throw new HttpError(409, missingText("telegram") ?? "تيليجرام مش مربوط");
    const data = await loadDay(readDay(new URL(req.url).searchParams.get("day") ?? undefined));
    await sendTelegram(tg, summaryOfDay(data.title, data.done, data.planned, data.demo));
    await audit({ type: "user", id: caller.id }, "done.share_telegram", { type: "day", id: data.day });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
