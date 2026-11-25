import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { mutateSetting } from "@/server/settings";
import { nextRates, type OwnerRates } from "@/core/currency";
import { isDemo } from "@/core/readiness";
import { rebuildTruth } from "@/jobs/truth";

const Body = z.object({ rates: z.record(z.string().max(12), z.number().finite().nullable()) });

/**
 * POST /api/currency {rates: {EGP: 50, SYP: null}} — the owner writes how many units of a currency make one dollar (null removes his figure). Owner only, kept
 * as a new version of the setting with the date; the stored truth of the recent days is then worked out again with the new figures.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الأسعار مش مفهومة");
    if (isDemo(process.env)) return NextResponse.json({ ok: true, demo: true });
    const now = new Date();
    const saved = await mutateSetting(
      "currency.rates",
      async (current) => {
        const next = nextRates(current, parsed.data.rates, now);
        if ("error" in next) throw new HttpError(400, next.error);
        return { value: next.rates as OwnerRates, result: null };
      },
      caller.id,
    );
    // the screens convert as they read; the stored truth (reports, exports) is rebuilt here for the days that hold another currency
    const recomputed = await rebuildTruth(now).then(
      () => true,
      (e) => {
        // the rate is saved; the worker works the recent days out again
        console.error("truth recompute after a rate change failed:", e instanceof Error ? e.message : e);
        return false;
      },
    );
    return NextResponse.json({ ok: true, version: saved?.version, recomputed });
  } catch (e) {
    return errorResponse(e);
  }
}
