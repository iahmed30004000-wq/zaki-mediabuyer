import { describe, expect, it } from "vitest";
import { buildPlan, launchDailySpend, resolveRefs, URL_TAGS, CREATIVE_FEATURES_OFF, type LaunchRequest } from "@/core/templates";
import { verifyAdSet, verifyCampaign, verifyCreative } from "@/core/verify";
import { parseAdName, parseAdSetName, parseCampaignName } from "@/core/naming";

const req: LaunchRequest = {
  template: "CRT", market: "SY", productCode: "TRF01", accountId: "act_1029", pageId: "PAGE1", pageCode: "SP", pixelId: "PX1",
  landingUrl: "https://crm.zakiai.io/lp/kamaa", lpCode: "LP1", date: "261026", seq: 1, dailyBudgetUsd: 15, spendCapUsd: 180,
  creatives: [
    { crCode: "CR00147", videoId: "V1", hookCode: "H07", angleCode: "HER", conceptId: "CPT0012", message: "m", title: "t" },
    { crCode: "CR00152", videoId: "V2", hookCode: "H03", angleCode: "ING", conceptId: "CPT0012", message: "m", title: "t" },
    { crCode: "CR00160", videoId: "V3", hookCode: "H01", angleCode: "PRB", conceptId: "CPT0015", message: "m", title: "t" },
  ],
};

describe("the builder (spec 5.3)", () => {
  const plan = buildPlan(req);
  it("one campaign, one ad set per concept, a creative and an ad per video, all PAUSED, all named by the code", () => {
    expect(plan.map((p) => p.type)).toEqual(["campaign", "adset", "creative", "ad", "creative", "ad", "adset", "creative", "ad"]);
    expect(parseCampaignName(plan[0]!.name)).toMatchObject({ market: "SY", productCode: "TRF01", stage: "CRT", seq: 1 });
    expect(parseAdSetName(plan[1]!.name)).toMatchObject({ pageCode: "SP", conceptId: "CPT0012" });
    expect(parseAdName(plan[3]!.name)).toMatchObject({ creativeCode: "CR00147", lpCode: "LP1" });
    for (const p of plan.filter((x) => x.type !== "creative")) expect(p.payload.status).toBe("PAUSED");
  });
  it("every risky default is explicit: no catalog, website only, no Advantage+ audience, 7-day click, budget sharing off", () => {
    const c = plan[0]!.payload;
    expect(c).toMatchObject({ objective: "OUTCOME_SALES", is_adset_budget_sharing_enabled: false, spend_cap: 18000 });
    const s = plan[1]!.payload as Record<string, any>;
    expect(s.destination_type).toBe("WEBSITE");
    expect(s.promoted_object).toEqual({ pixel_id: "PX1", custom_event_type: "PURCHASE" });
    expect(s.targeting).toEqual({ geo_locations: { countries: ["SY"] }, age_min: 18, targeting_automation: { advantage_audience: 0 } });
    expect(s.attribution_spec).toEqual([{ event_type: "CLICK_THROUGH", window_days: 7 }]);
    expect(s.daily_budget).toBe(1500);
  });
  it("each creative opts out of every enhancement by name, carries the URL parameters, no multi-advertiser", () => {
    const cr = plan[2]!.payload as Record<string, any>;
    expect(Object.keys(cr.degrees_of_freedom_spec.creative_features_spec)).toHaveLength(CREATIVE_FEATURES_OFF.length);
    expect(cr.degrees_of_freedom_spec.creative_features_spec.text_optimizations).toEqual({ enroll_status: "OPT_OUT" });
    expect(cr.degrees_of_freedom_spec.creative_features_spec.media_type_automation).toEqual({ enroll_status: "OPT_OUT" });
    expect(cr.url_tags).toBe(URL_TAGS);
    expect(cr.contextual_multi_ads).toEqual({ enroll_status: "OPT_OUT" });
  });
  it("references are filled with Meta's ids", () => {
    expect(resolveRefs(plan[3]!.payload, { adset1: "111", creative_CR00147: "222" })).toMatchObject({ adset_id: "111", creative: { creative_id: "222" } });
  });
  it("the money per day: 2 concepts × 15$", () => expect(launchDailySpend(req)).toBe(30));
});

describe("the post-create check (spec 9.1)", () => {
  it("a clean read-back has no mismatch", () => {
    expect(verifyCampaign("c", { objective: "OUTCOME_SALES", is_adset_budget_sharing_enabled: false }, true)).toEqual([]);
    expect(verifyAdSet("s", { optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE", promoted_object: { pixel_id: "PX1", custom_event_type: "PURCHASE" }, targeting: { geo_locations: { countries: ["SY"] }, age_min: 18, targeting_automation: { advantage_audience: 0 } }, is_dynamic_creative: false, bid_strategy: "LOWEST_COST_WITHOUT_CAP" }, { countries: ["SY"], minAge: 18, pixelId: "PX1" })).toEqual([]);
  });
  it("catches what Meta turned on by itself (the KamaaEye lessons)", () => {
    const s = verifyAdSet("s", { optimization_goal: "VALUE", destination_type: "WEBSITE_AND_APP", promoted_object: { pixel_id: "PX1", custom_event_type: "PURCHASE" }, targeting: { geo_locations: { countries: ["SY"] }, age_min: 18, targeting_automation: { advantage_audience: 1 } }, is_dynamic_creative: false }, { countries: ["SY"], minAge: 18, pixelId: "PX1" });
    expect(s.map((m) => m.field)).toEqual(["optimization_goal", "destination_type", "targeting.targeting_automation.advantage_audience"]);
    const c = verifyCreative("cr", { url_tags: URL_TAGS, object_story_spec: { page_id: "PAGE1", video_data: { video_id: "V1" } }, degrees_of_freedom_spec: { creative_features_spec: { text_optimizations: { enroll_status: "OPT_IN" }, brand_new_feature: { enroll_status: "OPT_IN" } } } }, { pageId: "PAGE1", videoId: "V1" });
    expect(c.map((m) => m.field)).toEqual(["creative_features_spec.text_optimizations", "creative_features_spec.brand_new_feature"]);
    expect(verifyCampaign("c", { objective: "OUTCOME_SALES", is_adset_budget_sharing_enabled: true, promoted_object: { product_catalog_id: "9" } }, true).map((m) => m.field)).toEqual(["is_adset_budget_sharing_enabled", "catalog"]);
  });
  it("a missing URL parameter is caught: the order would not tie to the ad", () => {
    expect(verifyCreative("cr", { url_tags: "", object_story_spec: { page_id: "PAGE1", video_data: { video_id: "V1" } } }, { pageId: "PAGE1", videoId: "V1" })[0]!.field).toBe("url_tags");
  });
});

import { applyItem } from "@/meta/write";
import { launchItems } from "@/core/templates";
import type { MetaClient } from "@/meta/client";
import type { ChangeItemDraft } from "@/core/changeset";

/** A pretend Meta that answers every create with an id and reads back what was sent, plus whatever it turned on itself. */
function fakeMeta(extra: Record<string, unknown> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const posts: { path: string; params: Record<string, unknown>; retry?: boolean }[] = [];
  let n = 0;
  const client = {
    async post(path: string, params: Record<string, unknown>, opts: { retry?: boolean } = {}) {
      posts.push({ path, params, retry: opts.retry });
      const id = `M${++n}`;
      store.set(id, { ...JSON.parse(JSON.stringify(params)), ...extra });
      return { id };
    },
    async get(id: string) {
      return store.get(id) ?? {};
    },
  } as unknown as MetaClient;
  return { client, posts };
}

describe("the launch as change items (live against a pretend Meta)", () => {
  const items = launchItems(req) as ChangeItemDraft[];
  it("creates first (campaign → ad set → creative → ad), switches on last (ads → ad sets → campaign)", () => {
    expect(items.filter((i) => i.op === "create")).toHaveLength(9);
    expect(items.slice(9).map((i) => `${i.op}:${i.objectType}`)).toEqual(["resume:ad", "resume:ad", "resume:ad", "resume:adset", "resume:adset", "resume:campaign"]);
    expect(items.filter((i) => i.op === "create" && i.after.dailyBudget).map((i) => i.after.dailyBudget)).toEqual([15, 15]);
  });
  it("a create is posted once, never retried, and read back clean", async () => {
    const { client, posts } = fakeMeta();
    const r = await applyItem(items[1]!, "live", client);
    expect(posts[0]).toMatchObject({ path: "act_1029/adsets", retry: false });
    expect(r).toMatchObject({ verified: true, createdId: "M1" });
  });
  it("Meta turning a creative feature on by itself fails the check (the object stays paused)", async () => {
    const { client } = fakeMeta({ degrees_of_freedom_spec: { creative_features_spec: { text_optimizations: { enroll_status: "OPT_IN" } } } });
    const r = await applyItem(items[2]!, "live", client);
    expect(r.verified).toBe(false);
    expect(r.mismatches?.[0]?.field).toBe("creative_features_spec.text_optimizations");
  });
  it("an ad set that came back «website and app» fails too", async () => {
    const { client } = fakeMeta({ destination_type: "WEBSITE_AND_APP" });
    expect((await applyItem(items[1]!, "live", client)).verified).toBe(false);
  });
  it("dry-run sends nothing and gives a stand-in id so the next items can be written down", async () => {
    const r = await applyItem(items[0]!, "dry_run", null);
    expect(r.verified).toBe(true);
    expect(r.createdId).toMatch(/^dry_campaign_[0-9a-f]{8}$/);
    expect((await applyItem(items[0]!, "dry_run", null)).createdId).not.toBe(r.createdId);
  });
});
