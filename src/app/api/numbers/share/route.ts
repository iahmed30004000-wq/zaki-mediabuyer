import { NextResponse } from "next/server";
import { missingText, isDemo } from "@/core/readiness";
import { summaryText } from "@/core/numbers";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { missingRateText } from "@/core/currency";
import { stampOf } from "@/core/freshness";
import { marketLabel } from "@/core/markets";
import { loadNumbers } from "@/lib/numbers-view";
import { loadSourceFacts } from "@/lib/source-facts";

export const dynamic = "force-dynamic";

/**
 * POST /api/numbers/share?d=…&from=…&to=… — the day's numbers as a short summary on the owner's Telegram. The text is
 * written by the code (src/core/numbers.ts) from the same numbers the screen shows; nobody types a figure. Money is never
 * approved from here — this only reports.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("money.view");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const q = new URL(req.url).searchParams;
    const tg = telegramFromEnv();
    if (!tg) throw new HttpError(409, missingText("telegram") ?? "تيليجرام مش مربوط");
    const data = await loadNumbers({ d: q.get("d"), from: q.get("from"), to: q.get("to"), market: q.get("market") });
    // R-23: the summary says whether its figures are «حقيقي» or «تقدير» (the OMS silent for three hours turns them into an estimate)
    const facts = await loadSourceFacts({ products: data.products });
    // v6 · P11: the summary says which market it is, and names a currency that has no rate
    const stamp = [stampOf(facts), data.market ? marketLabel(data.market) : null, data.missingRates.length ? missingRateText(data.missingRates) : null].filter(Boolean).join(" · ");
    await sendTelegram(tg, summaryText(data.label, data.totals.current, data.products.map((p) => ({ name: p.name, set: p.current })), stamp));
    await audit({ type: "user", id: caller.id }, "numbers.share_telegram", { type: "numbers", id: `${data.range.from}..${data.range.to}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
