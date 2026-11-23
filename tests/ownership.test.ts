import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A push never rewrites the status, the budget or the parent of an object Meta's sync owns (the stop and the scale ladder read those three from the site's copy). The database is a small double that records the update it was asked for.
 */
const s = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
  adset: null as Record<string, unknown> | null,
  ad: null as Record<string, unknown> | null,
  parent: null as Record<string, unknown> | null,
  updates: [] as { table: string; data: Record<string, unknown> }[],
}));
vi.mock("@/server/db", () => ({
  db: {
    campaign: { findUnique: async () => s.campaign, update: async ({ data }: { data: Record<string, unknown> }) => void s.updates.push({ table: "campaign", data }) },
    adSet: { findUnique: async ({ where }: { where: { metaId?: string; id?: string } }) => (where.id ? s.parent : s.adset), update: async ({ data }: { data: Record<string, unknown> }) => void s.updates.push({ table: "adset", data }) },
    ad: { findUnique: async () => s.ad, update: async ({ data }: { data: Record<string, unknown> }) => void s.updates.push({ table: "ad", data }) },
  },
}));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/notify", () => ({ createNotification: async () => ({ created: false }) }));

import { adSetOwnedByMeta, campaignOwnedByMeta, withoutProtected } from "@/core/ownership";
import { structureOf } from "@/server/push";

beforeEach(() => Object.assign(s, { campaign: null, adset: null, ad: null, parent: null, updates: [] }));

describe("what Meta's sync owns", () => {
  it("a campaign it filled has an objective; one only a push made does not", () => {
    expect(campaignOwnedByMeta({ objective: "OUTCOME_SALES" })).toBe(true);
    expect(campaignOwnedByMeta({ objective: null })).toBe(false);
  });
  it("an ad set it filled has an optimization goal", () => {
    expect(adSetOwnedByMeta({ optimizationGoal: "OFFSITE_CONVERSIONS" })).toBe(true);
    expect(adSetOwnedByMeta({ optimizationGoal: null })).toBe(false);
  });
  it("withoutProtected drops exactly the three, names them, and leaves a push's own fields", () => {
    const r = withoutProtected("adset", { name: "x", status: "PAUSED", dailyBudget: 999, campaignId: "other", audienceCode: "BROAD" }, true);
    expect(r.data).toEqual({ name: "x", audienceCode: "BROAD" });
    expect(r.dropped.sort()).toEqual(["campaignId", "dailyBudget", "status"]);
    expect(withoutProtected("adset", { status: "PAUSED" }, false)).toEqual({ data: { status: "PAUSED" }, dropped: [] });
  });
});

describe("a push over Meta's own objects", () => {
  it("a campaign: «PAUSED» and a ×10 budget are dropped, the name still lands", async () => {
    s.campaign = { metaId: "C1", objective: "OUTCOME_SALES", name: "old", productCode: "TRF01" };
    await structureOf({ level: "campaign", id: "C1", date: "2026-11-22", name: "SY_TRF01_WEB_TEST_261120_C01", status: "PAUSED", budget_daily: 500 } as never, undefined, []);
    expect(s.updates).toHaveLength(1);
    expect(s.updates[0]!.data).not.toHaveProperty("status");
    expect(s.updates[0]!.data).not.toHaveProperty("dailyBudget");
    expect(s.updates[0]!.data).not.toHaveProperty("accountId");
    expect(s.updates[0]!.data).toHaveProperty("name", "SY_TRF01_WEB_TEST_261120_C01");
  });
  it("a campaign a push made itself (no objective yet) can still be updated by a push", async () => {
    s.campaign = { metaId: "C2", objective: null, name: "mine" };
    await structureOf({ level: "campaign", id: "C2", date: "2026-11-22", status: "PAUSED", budget_daily: 20 } as never, undefined, []);
    expect(s.updates[0]!.data).toMatchObject({ status: "PAUSED", dailyBudget: 20 });
  });
  it("an ad set: the status, the budget and the move to another campaign are dropped", async () => {
    s.adset = { metaId: "S1", optimizationGoal: "OFFSITE_CONVERSIONS", name: "old" };
    s.campaign = { id: "campaign-row-2", metaId: "C9" };
    await structureOf({ level: "adset", id: "S1", date: "2026-11-22", parent_id: "C9", name: "BROAD_ADV_SP_CPT0001_v1", status: "PAUSED", budget_daily: 900 } as never, undefined, []);
    const d = s.updates[0]!.data;
    expect(d).not.toHaveProperty("status");
    expect(d).not.toHaveProperty("dailyBudget");
    expect(d).not.toHaveProperty("campaignId");
    expect(d).toHaveProperty("name", "BROAD_ADV_SP_CPT0001_v1");
  });
  it("an ad under an ad set Meta owns keeps its status and its parent", async () => {
    s.ad = { metaId: "A1", adSetId: "row-s1", name: "old" };
    s.parent = { optimizationGoal: "OFFSITE_CONVERSIONS" };
    s.adset = { id: "row-s2", metaId: "S2" };
    await structureOf({ level: "ad", id: "A1", date: "2026-11-22", parent_id: "S2", name: "CR00001_H01_ABC_LP1", status: "PAUSED" } as never, undefined, []);
    const d = s.updates[0]!.data;
    expect(d).not.toHaveProperty("status");
    expect(d).not.toHaveProperty("adSetId");
    expect(d).toHaveProperty("name", "CR00001_H01_ABC_LP1");
  });
  it("an ad under an ad set only a push knows is still the push's to change", async () => {
    s.ad = { metaId: "A2", adSetId: "row-s3", name: "old" };
    s.parent = { optimizationGoal: null };
    await structureOf({ level: "ad", id: "A2", date: "2026-11-22", name: "CR00002_H01_ABC_LP1", status: "PAUSED" } as never, undefined, []);
    expect(s.updates[0]!.data).toMatchObject({ status: "PAUSED" });
  });
});
