/**
 * THE POST-CREATE CHECK (spec 9.1 «التحقق بعد الإنشاء — إلزامي قبل التفعيل») — read each created object back and
 * compare it with what the template asked for: catalog, conversion location, performance goal, bid, audience and
 * age, «audience per creative», budget sharing, every creative feature BY NAME, URL parameters, the page, the video.
 * Any difference = the object stays PAUSED, the change fails and the owner is told exactly what differs.
 */
import { CREATIVE_FEATURES_OFF, URL_TAGS } from "./templates";

export interface Mismatch {
  object: string;
  field: string;
  expected: unknown;
  actual: unknown;
  /** what the owner reads */
  sentence: string;
}

type Obj = Record<string, unknown>;
const get = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Obj)[k] : undefined), o);

export function verifyCampaign(name: string, actual: Obj, expectBudgetSharingOff: boolean): Mismatch[] {
  const out: Mismatch[] = [];
  const need = (field: string, expected: unknown, label: string) => {
    const a = get(actual, field);
    if (JSON.stringify(a) !== JSON.stringify(expected)) out.push({ object: name, field, expected, actual: a, sentence: `${label}: المطلوب ${JSON.stringify(expected)} والموجود ${JSON.stringify(a)}` });
  };
  need("objective", "OUTCOME_SALES", "هدف الحملة");
  if (expectBudgetSharingOff) need("is_adset_budget_sharing_enabled", false, "مشاركة الميزانية بين المجموعات");
  if (actual.promoted_object && get(actual, "promoted_object.product_catalog_id")) out.push({ object: name, field: "catalog", expected: null, actual: get(actual, "promoted_object.product_catalog_id"), sentence: "الحملة مربوطة بكتالوج — ممنوع" });
  return out;
}

export function verifyAdSet(name: string, actual: Obj, expected: { countries: string[]; minAge: number; pixelId: string }): Mismatch[] {
  const out: Mismatch[] = [];
  const need = (field: string, want: unknown, label: string) => {
    const a = get(actual, field);
    if (JSON.stringify(a) !== JSON.stringify(want)) out.push({ object: name, field, expected: want, actual: a, sentence: `${label}: المطلوب ${JSON.stringify(want)} والموجود ${JSON.stringify(a)}` });
  };
  need("optimization_goal", "OFFSITE_CONVERSIONS", "هدف الأداء");
  need("destination_type", "WEBSITE", "مكان التحويل (موقع واحد، مش «موقع وتطبيق»)");
  need("promoted_object.pixel_id", expected.pixelId, "مصدر البيانات");
  need("promoted_object.custom_event_type", "PURCHASE", "حدث التحسين");
  need("targeting.geo_locations.countries", expected.countries, "السوق");
  need("targeting.age_min", expected.minAge, "أقل عمر");
  need("targeting.targeting_automation.advantage_audience", 0, "جمهور Advantage+ (لازم مطفي)");
  need("is_dynamic_creative", false, "جمهور لكل إبداع / الإبداع الديناميكي");
  const bid = get(actual, "bid_strategy");
  if (bid !== undefined && bid !== "LOWEST_COST_WITHOUT_CAP") out.push({ object: name, field: "bid_strategy", expected: "LOWEST_COST_WITHOUT_CAP", actual: bid, sentence: `المزايدة: المطلوب أعلى حجم بدون سقف والموجود ${String(bid)}` });
  if (get(actual, "targeting.flexible_spec")) out.push({ object: name, field: "targeting.flexible_spec", expected: null, actual: get(actual, "targeting.flexible_spec"), sentence: "في اهتمامات (Detailed targeting) — ممنوعة بالقالب" });
  return out;
}

export function verifyCreative(name: string, actual: Obj, expected: { pageId: string; videoId: string }): Mismatch[] {
  const out: Mismatch[] = [];
  const feats = (get(actual, "degrees_of_freedom_spec.creative_features_spec") ?? {}) as Record<string, { enroll_status?: string }>;
  const on = CREATIVE_FEATURES_OFF.filter((f) => feats[f]?.enroll_status === "OPT_IN");
  // a feature the read-back does not list at all was not applied, which is what we want; one listed as OPT_IN is not
  for (const f of on) out.push({ object: name, field: `creative_features_spec.${f}`, expected: "OPT_OUT", actual: "OPT_IN", sentence: `تحسين «${f}» مفعّل — لازم مطفي` });
  for (const [f, v] of Object.entries(feats)) {
    if (v?.enroll_status === "OPT_IN" && !(CREATIVE_FEATURES_OFF as readonly string[]).includes(f)) out.push({ object: name, field: `creative_features_spec.${f}`, expected: "OPT_OUT", actual: "OPT_IN", sentence: `تحسين جديد «${f}» مفعّل لحاله — راجعه` });
  }
  if (get(actual, "url_tags") !== URL_TAGS) out.push({ object: name, field: "url_tags", expected: URL_TAGS, actual: get(actual, "url_tags"), sentence: "معاملات الرابط ناقصة أو غلط — الطلب ما رح ينربط بالإعلان" });
  if (get(actual, "object_story_spec.page_id") !== expected.pageId) out.push({ object: name, field: "page_id", expected: expected.pageId, actual: get(actual, "object_story_spec.page_id"), sentence: "الصفحة غلط" });
  if (get(actual, "object_story_spec.video_data.video_id") !== expected.videoId) out.push({ object: name, field: "video_id", expected: expected.videoId, actual: get(actual, "object_story_spec.video_data.video_id"), sentence: "الفيديو غلط" });
  if (get(actual, "contextual_multi_ads.enroll_status") === "OPT_IN") out.push({ object: name, field: "contextual_multi_ads", expected: "OPT_OUT", actual: "OPT_IN", sentence: "إعلانات متعددة المعلنين مفعّلة — لازم مطفية" });
  return out;
}

/** The fields to read back for each type (one GET per object). */
export const READ_FIELDS = {
  campaign: "objective,status,is_adset_budget_sharing_enabled,promoted_object,daily_budget,spend_cap",
  adset: "optimization_goal,destination_type,promoted_object,targeting,bid_strategy,is_dynamic_creative,status,daily_budget",
  creative: "object_story_spec,url_tags,degrees_of_freedom_spec,contextual_multi_ads",
  ad: "status,creative",
} as const;

/** One read-back against the expectation stored on its change item. */
export function verifyCreated(name: string, actual: Obj, e: import("./templates").Expectation): Mismatch[] {
  const status = get(actual, "status");
  const paused: Mismatch[] = status !== undefined && status !== "PAUSED" ? [{ object: name, field: "status", expected: "PAUSED", actual: status, sentence: "انعمل مش موقّف — لازم يبلّش موقّف لحد ما يخلص الفحص" }] : [];
  if (e.type === "campaign") return [...paused, ...verifyCampaign(name, actual, e.budgetSharingOff ?? false)];
  if (e.type === "adset") return [...paused, ...verifyAdSet(name, actual, { countries: e.countries ?? [], minAge: e.minAge ?? 18, pixelId: e.pixelId ?? "" })];
  if (e.type === "creative") return verifyCreative(name, actual, { pageId: e.pageId ?? "", videoId: e.videoId ?? "" });
  return paused;
}
