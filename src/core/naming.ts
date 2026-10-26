/**
 * NAMING — the backbone (spec 5.1). Every object the system creates is named by the code; every
 * old name is read by `parse*`, and what cannot be read lands in «بدها تسمية».
 *
 *   campaign  {MARKET}_{PRODUCT}_{OBJECTIVE}_{STAGE}_{YYMMDD}_C{nn}   SY_TRF01_WEB_CRT_261026_C01
 *   ad set    {AUDIENCE}_{PLACEMENT}_{PAGE}_CPT{####}_v{n}            BROAD_ADV_SP_CPT0012_v1
 *   ad        CR{#####}_{HOOK}_{ANGLE}_LP{n}                          CR00147_H07_HER_LP1
 */
export const MARKETS = ["SY", "JO", "EG", "SA", "LY", "MR"] as const;
export const OBJECTIVES = ["MSG", "WEB", "RET"] as const;
export const STAGES = ["TEST", "CRT", "AUD", "OFR", "SCALE"] as const;
export const AUDIENCES = ["BROAD", "ENG", "VV", "MSGD", "LAL"] as const;
export const PLACEMENTS = ["ADV"] as const;

export type Market = (typeof MARKETS)[number];
export type Objective = (typeof OBJECTIVES)[number];
export type Stage = (typeof STAGES)[number];

export const MARKET_AR: Record<Market, string> = { SY: "سوريا", JO: "الأردن", EG: "مصر", SA: "السعودية", LY: "ليبيا", MR: "موريتانيا" };
export const OBJECTIVE_AR: Record<Objective, string> = { MSG: "رسائل", WEB: "صفحة هبوط", RET: "إعادة استهداف" };
export const STAGE_AR: Record<Stage, string> = { TEST: "اختبار منتج", CRT: "اختبار إبداعات", AUD: "اختبار جمهور", OFR: "اختبار عرض", SCALE: "تكبير" };

const oneOf = <T extends string>(list: readonly T[]) => `(${list.join("|")})`;

const CAMPAIGN = new RegExp(`^${oneOf(MARKETS)}_([A-Z]{3}\\d{2})_${oneOf(OBJECTIVES)}_${oneOf(STAGES)}_(\\d{6})_C(\\d{2})$`);
const ADSET = new RegExp(`^${oneOf(AUDIENCES)}_${oneOf(PLACEMENTS)}_([A-Z]{2})_CPT(\\d{4})_v(\\d+)$`);
const AD = /^CR(\d{5})_(H\d{2})_([A-Z]{3})_LP(\d)$/;

export interface CampaignName {
  market: Market;
  productCode: string;
  objective: Objective;
  stage: Stage;
  date: string;
  seq: number;
}

export function parseCampaignName(name: string): CampaignName | null {
  const m = CAMPAIGN.exec(name.trim());
  if (!m) return null;
  return { market: m[1] as Market, productCode: m[2]!, objective: m[3] as Objective, stage: m[4] as Stage, date: m[5]!, seq: Number(m[6]) };
}

export function formatCampaignName(c: CampaignName): string {
  return `${c.market}_${c.productCode}_${c.objective}_${c.stage}_${c.date}_C${String(c.seq).padStart(2, "0")}`;
}

/** The next free name: `C{nn}` goes up until the name is not taken in the account (5.1, «منع التكرار»). */
export function nextFreeCampaignName(base: Omit<CampaignName, "seq">, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let seq = 1; seq < 100; seq++) {
    const name = formatCampaignName({ ...base, seq });
    if (!used.has(name)) return name;
  }
  throw new Error("no free campaign number left for this day");
}

export function parseAdSetName(name: string) {
  const m = ADSET.exec(name.trim());
  if (!m) return null;
  return { audience: m[1]!, placement: m[2]!, pageCode: m[3]!, conceptId: `CPT${m[4]}`, version: Number(m[5]) };
}

export function parseAdName(name: string) {
  const m = AD.exec(name.trim());
  if (!m) return null;
  return { creativeCode: `CR${m[1]}`, hookCode: m[2]!, angleCode: m[3]!, lpCode: `LP${m[4]}` };
}

/** `YYMMDD` of a date in the business time zone. */
export function yymmdd(date: Date, timeZone = "Asia/Amman"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

// ───────────────────────────── old names: aliases (16.1) ─────────────────────────────

export interface ProductAlias {
  code: string;
  name: string;
  aliases: string[];
}

/** Arabic is written many ways: strip diacritics and tatweel, unify alef / ya / ta marbuta, lower-case Latin. */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[_\-|/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The product of an old campaign name, by the longest alias found in it (so «ماء الكمأة» wins over
 * «كمأة»). `null` when nothing matches — the campaign goes to «بدها تسمية» and its spend is orphan.
 */
export function productFromLegacyName(name: string, products: readonly ProductAlias[]): { code: string; via: string } | null {
  const hay = ` ${normalizeArabic(name)} `;
  let best: { code: string; via: string; len: number } | null = null;
  for (const p of products) {
    for (const alias of [p.code, p.name, ...p.aliases]) {
      const needle = normalizeArabic(alias);
      if (needle.length < 2) continue;
      if (hay.includes(needle) && (!best || needle.length > best.len)) best = { code: p.code, via: alias, len: needle.length };
    }
  }
  return best ? { code: best.code, via: best.via } : null;
}

/** Seed aliases (16.1) — the real codes come from the OMS. */
export const SEED_PRODUCTS: ProductAlias[] = [
  { code: "TRF01", name: "ماء الكمأة", aliases: ["كمأة", "كمأ", "الكمأة", "ماء كمأه", "KamaaEye"] },
  { code: "TIN01", name: "قطرة طنين الأذن", aliases: ["طنين", "قطرة الطنين", "اذن"] },
  { code: "SCR01", name: "كريم الندبات", aliases: ["ندبات", "ندب"] },
  { code: "NFG01", name: "كريم فطريات الأظافر", aliases: ["فطريات", "اظافر"] },
];
