/**
 * ONE MARK OF SOURCE in the reports and the exports (v6 · P6, R-23): the morning report, the Telegram summary and the print page all ask `src/core/freshness.ts`. The OMS silent for three hours turns EVERY figure
 * that stands on it into «تقدير» — not a line of one report; a product's own line is «حقيقي» only when its economics are real AND the OMS answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  facts: null as unknown as Record<string, unknown>,
  truth: [] as unknown[],
}));
vi.mock("@/lib/source-facts", () => ({ loadSourceFacts: async () => h.facts }));
vi.mock("@/server/settings", () => ({ getSetting: async () => "7d_click" }));
vi.mock("@/jobs/runner", () => ({ lastSuccess: async () => null }));
vi.mock("@/server/db", () => ({
  db: {
    truthDaily: { findMany: async (a: { where: { level: string } }) => (a.where.level === "product" ? h.truth : []) },
    productEconomics: { findMany: async () => [{ productCode: "ALB", name: "ALBETCHU", source: "actual" }] },
    productAlias: { findMany: async () => [{ productCode: "ALB", alias: "حرير" }] },
    ad: { findMany: async () => [] },
    insightDaily: { findMany: async () => [] },
    adAccount: { findMany: async () => [] },
    attributedOrder: { count: async () => 0 },
    jobRun: { findMany: async () => [] },
  },
}));

import { summaryText, SET_KEYS, type NumbersSet } from "@/core/numbers";
import { buildMorningReport } from "@/jobs/morning-report";

const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
const FRESH = { now: "2026-11-22T12:00:00.000Z", metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T11:30:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };

beforeEach(() => {
  h.facts = FRESH;
  h.truth = [{ objectId: "ALB", spendWithFee: 100, orders: 40, confirmed: 20, matureOrders: 40, delivered: 10, scalingCeiling: 4, profitPerDelivered: 2 }];
});

describe("the morning report", () => {
  it("OMS answering: «حقيقي» on the account line and on a product whose economics are real; the product is named in Arabic", async () => {
    const text = await buildMorningReport(new Date("2026-11-21T00:00:00Z"));
    expect(text).toContain("[حقيقي]");
    expect(text).toContain("حرير: صرف");
    expect(text).not.toContain("ALBETCHU");
    expect(text).not.toContain("تقدير");
  });

  it("OMS silent for hours: the account line AND every product line say «تقدير» — not just one line", async () => {
    h.facts = { ...FRESH, omsLastPullAt: "2026-11-22T03:00:00.000Z" };
    const text = await buildMorningReport(new Date("2026-11-21T00:00:00Z"));
    expect(text).toContain("[تقدير — الـ OMS ما ردّ من أكتر من 3 ساعات]");
    expect(text).toMatch(/حرير: صرف.*\[تقدير\]/);
    expect(text).not.toContain("[حقيقي]");
  });

  it("the OMS was never pulled: an estimate too", async () => {
    h.facts = { ...FRESH, omsLastPullAt: null };
    expect(await buildMorningReport(new Date("2026-11-21T00:00:00Z"))).toContain("[تقدير — الـ OMS ما ردّ من أكتر من 3 ساعات]");
  });
});

describe("the Telegram summary", () => {
  it("carries the source line under the title when the caller gives one, and nothing extra when it does not", () => {
    const totals = set({ spend: 100, ordersIn: 40 });
    expect(summaryText("آخر 7 أيام", totals, [], "تقدير — نظام الطلبات ما ردّ من 9 ساعات (أكتر من 3 ساعات)").split("\n").slice(0, 2)).toEqual(["📊 أرقام آخر 7 أيام", "المصدر: تقدير — نظام الطلبات ما ردّ من 9 ساعات (أكتر من 3 ساعات)"]);
    expect(summaryText("آخر 7 أيام", totals, []).split("\n")[1]).toMatch(/^المجموع:/);
  });
});
