/**
 * THE IMPORT (spec S13 «رفع ← ربط أعمدة ← معاينة ← استيراد», 17.2 «نفس الملف مرتين = مرة») — pure: a daily, per-ad
 * export from Meta's Ads Manager (CSV or Excel, English or Arabic headers) becomes archive rows. The columns are
 * guessed from known names and the owner can change each one before importing. A row is keyed by (ad, day), so a
 * file imported twice changes nothing the second time.
 */
export const FIELDS = ["day", "adId", "adName", "spend", "impressions", "reach", "linkClicks", "lpv", "purchases", "video3s", "thruplays"] as const;
export type Field = (typeof FIELDS)[number];
export const REQUIRED: Field[] = ["day", "spend", "impressions"];

export const FIELD_AR: Record<Field, string> = {
  day: "اليوم", adId: "رقم الإعلان", adName: "اسم الإعلان", spend: "المبلغ المصروف", impressions: "مرات الظهور", reach: "الوصول",
  linkClicks: "نقرات الرابط", lpv: "مشاهدات صفحة الهبوط", purchases: "عمليات الشراء", video3s: "تشغيل 3 ثواني", thruplays: "ThruPlay",
};

/** Header names Meta uses (English and Arabic Ads Manager), lower-cased, without the currency in brackets. */
const KNOWN: Record<Field, string[]> = {
  day: ["day", "date", "reporting starts", "اليوم", "التاريخ", "بدء إعداد التقارير", "بداية التقرير"],
  adId: ["ad id", "معرف الإعلان", "معرّف الإعلان", "رقم الإعلان"],
  adName: ["ad name", "اسم الإعلان"],
  spend: ["amount spent", "spend", "المبلغ المنفق", "المبلغ الذي تم إنفاقه", "المبلغ المصروف"],
  impressions: ["impressions", "مرات الظهور", "الظهور"],
  reach: ["reach", "الوصول", "مدى الوصول"],
  linkClicks: ["link clicks", "نقرات الرابط"],
  lpv: ["landing page views", "مشاهدات الصفحة المقصودة", "مشاهدات صفحة الهبوط"],
  purchases: ["purchases", "website purchases", "عمليات الشراء", "مشتريات"],
  video3s: ["3-second video plays", "video plays at 3 seconds", "مرات تشغيل الفيديو لمدة 3 ثوان", "تشغيل 3 ثواني"],
  thruplays: ["thruplays", "thruplay"],
};

const clean = (h: string) => h.replace(/^﻿/, "").replace(/\(.*?\)/g, "").trim().toLowerCase();

export function guessMapping(headers: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  headers.forEach((h, i) => {
    const c = clean(h);
    for (const f of FIELDS) if (out[f] === undefined && KNOWN[f].some((k) => c === k || c.startsWith(`${k} `))) out[f] = i;
  });
  return out;
}

/** CSV with quotes, commas or semicolons, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const toNumber = (v: string | undefined) => {
  if (v === undefined || v.trim() === "" || v.trim() === "-") return 0;
  const n = Number(v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** 2026-10-25 · 25/10/2026 · 10/25/2026 (when the first part > 12 it is the day) */
export function toDay(v: string | undefined): Date | null {
  const s = (v ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1]!, b = +m[2]!;
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    return new Date(Date.UTC(+m[3]!, month - 1, day));
  }
  return null;
}

export interface ImportRow {
  day: Date;
  adId: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  lpv: number;
  purchases: number;
  video3s: number;
  thruplays: number;
}

export function readRows(table: string[][], mapping: Partial<Record<Field, number>>): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = [];
  for (const f of REQUIRED) if (mapping[f] === undefined) errors.push(`عمود «${FIELD_AR[f]}» مش محدد`);
  if (mapping.adId === undefined && mapping.adName === undefined) errors.push("لازم «رقم الإعلان» أو «اسم الإعلان»");
  if (errors.length) return { rows: [], errors };
  const rows: ImportRow[] = [];
  const get = (r: string[], f: Field) => (mapping[f] === undefined ? undefined : r[mapping[f]!]);
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const day = toDay(get(r, "day"));
    if (!day) return void errors.push(`سطر ${line}: التاريخ «${get(r, "day") ?? ""}» مش مفهوم`);
    const adId = get(r, "adId")?.trim() || null;
    const adName = get(r, "adName")?.trim() || null;
    // a total line: no ad at all, or a name like «Total» / «الإجمالي» without an ad id
    if (!adId && (!adName || /^(total|totals|grand total|المجموع|الإجمالي|الاجمالي)/i.test(adName))) return;
    const n = (f: Field) => toNumber(get(r, f));
    const row: ImportRow = { day, adId, adName, spend: n("spend"), impressions: n("impressions"), reach: n("reach"), linkClicks: n("linkClicks"), lpv: n("lpv"), purchases: n("purchases"), video3s: n("video3s"), thruplays: n("thruplays") };
    const bad = (Object.entries(row) as [string, unknown][]).filter(([, v]) => typeof v === "number" && !Number.isFinite(v)).map(([k]) => FIELD_AR[k as Field]);
    if (bad.length) return void errors.push(`سطر ${line}: أرقام مش مفهومة (${bad.join("، ")})`);
    rows.push(row);
  });
  // the same ad and day twice in one file: the last one wins, said out loud
  const seen = new Map<string, number>();
  rows.forEach((r, i) => seen.set(`${r.adId ?? r.adName}|${r.day.toISOString()}`, i));
  if (seen.size < rows.length) errors.push(`${rows.length - seen.size} سطر مكرر لنفس الإعلان واليوم — آخر واحد بيغلب`);
  return { rows: [...seen.values()].map((i) => rows[i]!), errors };
}
