/**
 * THE CAMPAIGN TEMPLATES (spec 5.3) — every setting written out by name, so nothing Meta turns on by itself slips
 * through (the KamaaEye launch, 16.6: catalog, Maximize value, Website and app, Advantage+ audience at 18, audience
 * per creative, Flex media, Optimize text per person on 8 of 20 ads, Website summaries — all on by themselves).
 *
 * Pure: a launch request in, the exact Meta payloads out (with the names of spec 5.1), plus the settings the
 * post-create check must find. Field names checked against facebook-nodejs-business-sdk v24.0 (campaign.js,
 * ad-set.js, ad.js, ad-creative.js, ad-creative-features-spec.js, targeting-automation.js).
 * Everything is created PAUSED; activation comes only after the read-back matches (src/core/verify.ts).
 */
import { formatCampaignName, type Market, type Stage } from "./naming";

/** The creative enhancements a video/text ad can get by default — every one opted out by name (spec 5.3). */
export const CREATIVE_FEATURES_OFF = [
  "adapt_to_placement", "add_text_overlay", "advantage_plus_creative", "audio", "biz_ai", "creative_stickers", "cv_transformation",
  "description_automation", "dha_optimization", "enhance_cta", "feed_caption_optimization", "generate_cta", "image_animation",
  "image_auto_crop", "image_background_gen", "image_brightness_and_contrast", "image_enhancement", "image_templates", "image_touchups",
  "image_uncrop", "inline_comment", "media_type_automation", "multi_photo_to_video", "music_generation", "product_extensions",
  "replace_media_text", "reveal_details_over_time", "show_destination_blurbs", "show_summary", "site_extensions", "standard_enhancements",
  "text_extraction_for_headline", "text_extraction_for_tap_target", "text_generation", "text_optimizations", "text_overlay_translation",
  "text_translation", "translate_voiceover", "video_auto_crop", "video_filtering", "video_highlight", "video_to_image", "video_uncrop",
] as const;

/** URL parameters on every landing-page ad (spec 2) — the OMS ties each order to its ad with them. */
export const URL_TAGS = "utm_source=fb&utm_medium={{site_source_name}}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&ad_name={{ad.name}}";

export type TemplateKey = "TEST" | "CRT" | "SCALE";

export interface TemplateInfo {
  key: TemplateKey;
  stage: Stage;
  title: string;
  /** ABO: budget per ad set (tests) · CBO: budget on the campaign (scale) */
  budgetLevel: "adset" | "campaign";
  days: number;
}

export const TEMPLATES: Record<TemplateKey, TemplateInfo> = {
  TEST: { key: "TEST", stage: "TEST", title: "اختبار منتج", budgetLevel: "adset", days: 6 },
  CRT: { key: "CRT", stage: "CRT", title: "اختبار إبداعات", budgetLevel: "adset", days: 4 },
  SCALE: { key: "SCALE", stage: "SCALE", title: "تكبير", budgetLevel: "campaign", days: 7 },
};

export interface LaunchCreative {
  crCode: string;
  videoId: string;
  /** the chosen thumbnail (an uploaded image hash) — never a random frame (7.5) */
  thumbnailHash?: string | null;
  hookCode: string;
  angleCode: string;
  conceptId: string;
  message: string;
  title: string;
}

export interface LaunchRequest {
  template: TemplateKey;
  market: Market;
  productCode: string;
  accountId: string;
  pageId: string;
  pageCode: string;
  pixelId: string;
  landingUrl: string;
  lpCode: string;
  date: string; // YYMMDD
  seq: number;
  /** per ad set (ABO) or for the campaign (CBO), USD per day */
  dailyBudgetUsd: number;
  /** the campaign spend cap = the test budget (spec 5.3), USD */
  spendCapUsd?: number;
  minAge?: number;
  creatives: LaunchCreative[];
}

const cents = (usd: number) => Math.round(usd * 100);

export interface PlannedObject {
  ref: string;
  type: "campaign" | "adset" | "creative" | "ad";
  /** POST target: «act_…/campaigns» etc. */
  endpoint: string;
  name: string;
  payload: Record<string, unknown>;
}

/** The objects to create, in order; `{{ref:x}}` in a payload is replaced by the id Meta gave object x. */
export function buildPlan(r: LaunchRequest): PlannedObject[] {
  const t = TEMPLATES[r.template];
  const campaignName = formatCampaignName({ market: r.market, productCode: r.productCode, objective: "WEB", stage: t.stage, date: r.date, seq: r.seq });
  const out: PlannedObject[] = [];
  out.push({
    ref: "campaign",
    type: "campaign",
    endpoint: `${r.accountId}/campaigns`,
    name: campaignName,
    payload: {
      name: campaignName,
      objective: "OUTCOME_SALES",
      status: "PAUSED",
      buying_type: "AUCTION",
      special_ad_categories: [],
      ...(t.budgetLevel === "campaign" ? { daily_budget: cents(r.dailyBudgetUsd), bid_strategy: "LOWEST_COST_WITHOUT_CAP" } : { is_adset_budget_sharing_enabled: false }),
      ...(r.spendCapUsd ? { spend_cap: cents(r.spendCapUsd) } : {}),
    },
  });

  // one ad set per concept (spec 5.3: «كل مجموعة = مفهوم واحد»)
  const concepts = [...new Set(r.creatives.map((c) => c.conceptId))];
  for (const [i, concept] of concepts.entries()) {
    const adsetRef = `adset${i + 1}`;
    const adsetName = `BROAD_ADV_${r.pageCode}_${concept}_v1`;
    out.push({
      ref: adsetRef,
      type: "adset",
      endpoint: `${r.accountId}/adsets`,
      name: adsetName,
      payload: {
        name: adsetName,
        campaign_id: "{{ref:campaign}}",
        status: "PAUSED",
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        destination_type: "WEBSITE",
        promoted_object: { pixel_id: r.pixelId, custom_event_type: "PURCHASE" },
        attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }],
        is_dynamic_creative: false,
        ...(t.budgetLevel === "adset" ? { daily_budget: cents(r.dailyBudgetUsd), bid_strategy: "LOWEST_COST_WITHOUT_CAP" } : {}),
        targeting: {
          geo_locations: { countries: [r.market] },
          age_min: r.minAge ?? 18,
          targeting_automation: { advantage_audience: 0 },
        },
      },
    });
    for (const c of r.creatives.filter((x) => x.conceptId === concept)) {
      const adName = `${c.crCode}_${c.hookCode}_${c.angleCode}_${r.lpCode}`;
      out.push({
        ref: `creative_${c.crCode}`,
        type: "creative",
        endpoint: `${r.accountId}/adcreatives`,
        name: adName,
        payload: {
          name: adName,
          object_story_spec: {
            page_id: r.pageId,
            video_data: {
              video_id: c.videoId,
              ...(c.thumbnailHash ? { image_hash: c.thumbnailHash } : {}),
              title: c.title,
              message: c.message,
              call_to_action: { type: "ORDER_NOW", value: { link: r.landingUrl } },
            },
          },
          url_tags: URL_TAGS,
          degrees_of_freedom_spec: { creative_features_spec: Object.fromEntries(CREATIVE_FEATURES_OFF.map((f) => [f, { enroll_status: "OPT_OUT" }])) },
          contextual_multi_ads: { enroll_status: "OPT_OUT" },
        },
      });
      out.push({
        ref: `ad_${c.crCode}`,
        type: "ad",
        endpoint: `${r.accountId}/ads`,
        name: adName,
        payload: { name: adName, adset_id: `{{ref:${adsetRef}}}`, creative: { creative_id: `{{ref:creative_${c.crCode}}}` }, status: "PAUSED" },
      });
    }
  }
  return out;
}

/** Fill `{{ref:x}}` placeholders with the ids Meta returned, anywhere in a payload. */
export function resolveRefs<T>(payload: T, ids: Record<string, string>): T {
  return JSON.parse(JSON.stringify(payload).replace(/\{\{ref:([a-zA-Z0-9_]+)\}\}/g, (whole, ref: string) => ids[ref] ?? whole)) as T;
}

/** What one launch costs per day (the «+45$ باليوم» of the change card). */
export function launchDailySpend(r: LaunchRequest): number {
  const t = TEMPLATES[r.template];
  if (t.budgetLevel === "campaign") return r.dailyBudgetUsd;
  return r.dailyBudgetUsd * new Set(r.creatives.map((c) => c.conceptId)).size;
}

/** What the post-create check must find on each object (kept on the change item, so the check runs from the item alone). */
export interface Expectation {
  type: PlannedObject["type"];
  countries?: string[];
  minAge?: number;
  pixelId?: string;
  pageId?: string;
  videoId?: string;
  budgetSharingOff?: boolean;
}

export interface LaunchItem {
  op: "create" | "resume";
  objectType: PlannedObject["type"];
  objectId: string;
  before: { status?: string };
  after: { status?: string; dailyBudget?: number; endpoint?: string; payload?: Record<string, unknown>; ref?: string; name?: string; expect?: Expectation };
}

/**
 * The launch as change items: create everything PAUSED in order (the change stops at the first object whose read-back
 * differs), then switch ad → ad set → campaign on. A failed check leaves everything paused, nothing half-on.
 */
export function launchItems(r: LaunchRequest): LaunchItem[] {
  const t = TEMPLATES[r.template];
  const plan = buildPlan(r);
  const creates: LaunchItem[] = plan.map((p) => {
    const budget = p.type === "campaign" ? (t.budgetLevel === "campaign" ? r.dailyBudgetUsd : undefined) : p.type === "adset" && t.budgetLevel === "adset" ? r.dailyBudgetUsd : undefined;
    const c = p.type === "creative" ? r.creatives.find((x) => p.ref === `creative_${x.crCode}`) : undefined;
    const expect: Expectation =
      p.type === "campaign" ? { type: "campaign", budgetSharingOff: t.budgetLevel === "adset" }
      : p.type === "adset" ? { type: "adset", countries: [r.market], minAge: r.minAge ?? 18, pixelId: r.pixelId }
      : p.type === "creative" ? { type: "creative", pageId: r.pageId, videoId: c?.videoId }
      : { type: "ad" };
    return { op: "create", objectType: p.type, objectId: `{{ref:${p.ref}}}`, before: {}, after: { endpoint: p.endpoint, payload: p.payload, ref: p.ref, name: p.name, dailyBudget: budget, expect } };
  });
  const order: PlannedObject["type"][] = ["ad", "adset", "campaign"];
  const switches: LaunchItem[] = order.flatMap((type) => plan.filter((p) => p.type === type).map((p) => ({ op: "resume" as const, objectType: p.type, objectId: `{{ref:${p.ref}}}`, before: { status: "PAUSED" }, after: { status: "ACTIVE" } })));
  return [...creates, ...switches];
}
