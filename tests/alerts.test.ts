import { describe, expect, it } from "vitest";
import { detect, reading, telegramText, type AlertFacts } from "@/core/alerts";

const calm: AlertFacts = { hour: 15, adsets: [{ id: "AS1", name: "BROAD_ADV_SP_CPT0012_v1", dailyBudget: 40, impressionsToday: 4000 }], pixelPurchasesToday: 8, webOrdersToday: 7, cpmToday: 3, impressionsToday: 20000, cpm7: [2.8, 3, 3.1, 2.9, 3.2, 3, 2.7], metaLinked: true, omsLinked: true, metaAgeHours: 0.5, omsAgeHours: 0.8, attributedPct: 88, capiRejectedLastHour: 0, tokenDaysLeft: 40 };

describe("instant alerts (spec 12.3)", () => {
  it("a calm day raises nothing", () => expect(detect(calm)).toEqual([]));
  it("no delivery, tracking, CPM, a stale source, weak attribution, CAPI refused, a token ending", () => {
    const s = detect({ ...calm, adsets: [{ ...calm.adsets[0]!, impressionsToday: 0 }], pixelPurchasesToday: 0, webOrdersToday: 5, cpmToday: 7, metaAgeHours: 3, attributedPct: 60, capiRejectedLastHour: 2, tokenDaysLeft: 5 });
    expect(s.map((x) => x.key)).toEqual(["delivery:AS1", "tracking:pixel", "cpm", "stale:meta", "attribution", "capi", "token"]);
  });
  it("no delivery is not judged in the morning; an ended token is danger and instant", () => {
    expect(detect({ ...calm, hour: 9, adsets: [{ ...calm.adsets[0]!, impressionsToday: 0 }] })).toEqual([]);
    expect(detect({ ...calm, tokenDaysLeft: 0 })[0]).toMatchObject({ tone: "danger", instant: true });
  });
  it("two readings in a row raise once; an instant one at once; a gap starts over", () => {
    const t0 = new Date("2026-10-26T12:00:00Z");
    const later = (m: number) => new Date(t0.getTime() + m * 60_000);
    const cpm = detect({ ...calm, cpmToday: 7 });
    const r1 = reading(cpm, [], t0);
    expect(r1.raise).toEqual([]);
    const r2 = reading(cpm, r1.keep, later(15));
    expect(r2.raise.map((x) => x.key)).toEqual(["cpm"]);
    expect(reading(cpm, r2.keep, later(30)).raise).toEqual([]);
    expect(reading(cpm, r1.keep, later(90)).raise).toEqual([]);
    expect(reading([{ key: "token", kind: "k", tone: "danger", text: "t", href: "/", instant: true }], [], t0).raise).toHaveLength(1);
  });
  it("one Telegram message, danger first, with the site's link", () => {
    expect(telegramText([{ tone: "warn", text: "ب" }, { tone: "danger", text: "أ" }], "https://mediabuyer.zakiai.io")).toBe("تنبيهات الميديا باير\n🔴 أ\n🟠 ب\n\nافتح: https://mediabuyer.zakiai.io");
  });
});
