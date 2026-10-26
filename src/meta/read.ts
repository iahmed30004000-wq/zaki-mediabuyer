/**
 * What Phase 1 reads from Meta (spec 9.1 «الاستدعاءات» and «حقول Insights»), and how a raw insights row becomes an
 * InsightDaily row. Field names checked against facebook-nodejs-business-sdk v24.0 (objects/ads-insights.js).
 */
import type { MetaClient } from "./client";

export const ACCOUNT_FIELDS = "id,name,currency,timezone_name,account_status,spend_cap,disable_reason";
export const CAMPAIGN_FIELDS = "id,name,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,spend_cap";
export const ADSET_FIELDS = "id,name,campaign_id,effective_status,optimization_goal,daily_budget,learning_stage_info";
export const AD_FIELDS = "id,name,adset_id,effective_status";

export const INSIGHT_FIELDS = [
  "ad_id",
  "adset_id",
  "campaign_id",
  "date_start",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "inline_link_clicks",
  "outbound_clicks",
  "actions",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
].join(",");

/** The attribution window is ALWAYS explicit: a pull can silently inherit the account's setting otherwise (spec 9.1). */
export const ATTRIBUTION_WINDOWS: Record<string, string[]> = { "7d_click": ["7d_click"], "1d_click": ["1d_click"] };

type ActionList = { action_type: string; value: string }[] | undefined;

/** The first action type present, in order of preference (Meta reports the same thing under several names). */
export function actionValue(list: ActionList, types: string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export const PURCHASE_TYPES = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
export const LPV_TYPES = ["landing_page_view", "omni_landing_page_view"];
export const CONVERSATION_TYPES = ["onsite_conversion.messaging_conversation_started_7d"];
export const VIDEO3S_TYPES = ["video_view"];

export interface RawInsight {
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  outbound_clicks?: ActionList;
  actions?: ActionList;
  video_thruplay_watched_actions?: ActionList;
  video_p25_watched_actions?: ActionList;
  video_p50_watched_actions?: ActionList;
  video_p75_watched_actions?: ActionList;
  video_p95_watched_actions?: ActionList;
  video_p100_watched_actions?: ActionList;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
}

const n = (v: string | undefined) => (v === undefined ? 0 : Number(v) || 0);
const video = (l: ActionList) => actionValue(l, ["video_view"]);

export function toInsightRow(r: RawInsight, attributionSetting: string) {
  return {
    level: "ad" as const,
    objectId: r.ad_id ?? "",
    date: r.date_start,
    spend: r.spend ?? "0",
    impressions: n(r.impressions),
    reach: n(r.reach),
    frequency: r.frequency ?? "0",
    linkClicks: n(r.inline_link_clicks),
    outboundClicks: actionValue(r.outbound_clicks, ["outbound_click"]),
    lpv: actionValue(r.actions, LPV_TYPES),
    purchases: actionValue(r.actions, PURCHASE_TYPES),
    conversations: actionValue(r.actions, CONVERSATION_TYPES),
    video3s: actionValue(r.actions, VIDEO3S_TYPES),
    thruplays: video(r.video_thruplay_watched_actions),
    p25: video(r.video_p25_watched_actions),
    p50: video(r.video_p50_watched_actions),
    p75: video(r.video_p75_watched_actions),
    p95: video(r.video_p95_watched_actions),
    p100: video(r.video_p100_watched_actions),
    qualityRanking: r.quality_ranking ?? null,
    engagementRanking: r.engagement_rate_ranking ?? null,
    conversionRanking: r.conversion_rate_ranking ?? null,
    attributionSetting,
  };
}
export type InsightRow = ReturnType<typeof toInsightRow>;

/** Daily ad-level insights of one account for a date range, with the window explicit. */
export function readInsights(client: MetaClient, accountId: string, since: string, until: string, window = "7d_click") {
  return client.all<RawInsight>(`${accountId}/insights`, {
    level: "ad",
    fields: INSIGHT_FIELDS,
    time_range: { since, until },
    time_increment: 1,
    action_attribution_windows: ATTRIBUTION_WINDOWS[window] ?? [window],
  });
}

export const readAccounts = (c: MetaClient) => c.all<Record<string, unknown>>("me/adaccounts", { fields: ACCOUNT_FIELDS });
export const readCampaigns = (c: MetaClient, act: string) => c.all<Record<string, unknown>>(`${act}/campaigns`, { fields: CAMPAIGN_FIELDS });
export const readAdSets = (c: MetaClient, act: string) => c.all<Record<string, unknown>>(`${act}/adsets`, { fields: ADSET_FIELDS });
export const readAds = (c: MetaClient, act: string) => c.all<Record<string, unknown>>(`${act}/ads`, { fields: AD_FIELDS });

/** A day that suddenly reads zero after having numbers = «تحقق من النافذة» (spec 4, attribution changes). */
export function windowSuspicious(previous: { purchases: number; spend: number }, current: { purchases: number; spend: number }): boolean {
  return previous.purchases >= 5 && current.purchases === 0 && current.spend >= previous.spend * 0.5;
}
