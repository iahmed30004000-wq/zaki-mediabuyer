/**
 * ONE MARK OF SOURCE (v6 · P6, docs/rebuild-v6/04-numbers.md §6, R-23) — pure. Every tile, every report and every export asks THIS file whether a figure is «حقيقي» or «تقدير»: the
 * rule is written once. A figure that stands on the OMS is «حقيقي» while the last REAL pull of the OMS is under three hours old (`OMS_FRESH_H`, the limit the health rule uses too);
 * past it, or when the OMS was never pulled, EVERY figure from it is «تقدير» — not just a line of the morning report. A figure that stands on Meta is «ميتا»; a «real» word is never
 * written over a number whose source is not there.
 *
 * The clock is `facts.now`; nothing here reads a table or a time of its own.
 */
import { agoWords } from "./bell";
import { OMS_FRESH_H, omsFresh, omsPullAgeHours, type SourceFacts } from "./numbers-readiness";

/** The word beside a number. */
export type SourceWord = "حقيقي" | "تقدير" | "ميتا";

export interface SourceMark {
  /** the source of the number's family: the OMS (orders, confirmation, shipping) or Meta (the spend) */
  key: "oms" | "meta";
  /** `real`: «حقيقي» (the OMS answered within three hours) · `meta`: Meta's own figure · `estimate`: «تقدير» (the OMS is silent) */
  kind: "real" | "meta" | "estimate";
  word: SourceWord;
  /** hours since the last real pull (the OMS) or sync (Meta); null when there never was one or it is not known */
  ageHours: number | null;
  /** «قبل 9 ساعات», or null when there is no age to say */
  ageText: string | null;
  /** one sentence about this source, for a tile's hint and for a report's footer */
  note: string;
}

export interface Freshness {
  oms: SourceMark;
  meta: SourceMark;
  /** the OMS answered within three hours: the figures that stand on it are «حقيقي» */
  allReal: boolean;
  /** «آخر تحديث قبل 12 دقيقة · الطلبات من نظام الطلبات، الصرف من ميتا» — the line under the period switcher */
  line: string;
}

const ageOf = (hours: number | null): string | null => (hours === null ? null : agoWords(hours * 60));

/** Hours since an instant, null when there is none (or it is in the future by a clock slip: that is «هلق»). */
const hoursSince = (nowIso: string, at: string | null | undefined): number | null => {
  if (!at) return null;
  const ms = Date.parse(nowIso) - Date.parse(at);
  return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : null;
};

/** The source of the OMS's figures and of Meta's, from the facts the numbers stand on. */
export function freshness(f: SourceFacts): Freshness {
  const omsAge = omsPullAgeHours(f);
  const fresh = omsFresh(f);
  const oms: SourceMark = {
    key: "oms",
    kind: fresh ? "real" : "estimate",
    word: fresh ? "حقيقي" : "تقدير",
    ageHours: omsAge,
    ageText: ageOf(omsAge),
    note: fresh
      ? `من نظام الطلبات، آخر سحب ${ageOf(omsAge)}`
      : !f.omsLinked
        ? "نظام الطلبات مش مربوط: الأرقام تقدير"
        : omsAge === null
          ? "ما سحبنا من نظام الطلبات لسا: الأرقام تقدير"
          : `نظام الطلبات ما ردّ من ${ageOf(omsAge)?.replace("قبل ", "")} (أكتر من ${OMS_FRESH_H} ساعات): الأرقام تقدير`,
  };
  const metaAge = hoursSince(f.now, f.metaLastSyncAt);
  const meta: SourceMark = {
    key: "meta",
    kind: "meta",
    word: "ميتا",
    ageHours: metaAge,
    ageText: ageOf(metaAge),
    note: !f.metaLinked && !f.spendYesterday ? "ميتا مش مربوطة" : metaAge === null ? "الصرف من ميتا" : `الصرف من ميتا، آخر سحب ${ageOf(metaAge)}`,
  };
  // the line under the switcher: when the numbers last moved (the newest of the two pulls), and where each side comes from
  const ages = [omsAge, metaAge].filter((h): h is number => h !== null);
  const last = ages.length ? ageOf(Math.min(...ages)) : null;
  const where = fresh ? "الطلبات من نظام الطلبات، الصرف من ميتا" : "الطلبات تقدير (نظام الطلبات واقف)، الصرف من ميتا";
  return { oms, meta, allReal: fresh, line: last ? `آخر تحديث ${last} · ${where}` : `ما في تحديث لسا · ${where}` };
}

/** What a number that stands on `base` is called right now: Meta's figures stay «ميتا»; the OMS's become «تقدير» when it is silent. */
export function sourceAfter(base: "real" | "meta", f: SourceFacts): "real" | "meta" | "estimate" {
  return base === "meta" ? "meta" : omsFresh(f) ? "real" : "estimate";
}

/** The badge of a glossary number («حقيقي» is `truth` there): `truth` becomes `estimate` while the OMS is silent; the others stay as the glossary says. */
export function badgeAfter<S extends string | undefined>(source: S, f: SourceFacts): S | "estimate" {
  return source === "truth" && !omsFresh(f) ? "estimate" : source;
}

/** The word of a product's line in a report: «حقيقي» only when its own economics are real (50 shipments) AND the OMS answers; either one missing makes it «تقدير». */
export const badgeOf = (economicsReal: boolean, f: SourceFacts): "حقيقي" | "تقدير" => (economicsReal && omsFresh(f) ? "حقيقي" : "تقدير");

/** The word of a figure from the OMS: «حقيقي» or «تقدير» — for a line of a report or an export. */
export const omsWord = (f: SourceFacts): "حقيقي" | "تقدير" => (omsFresh(f) ? "حقيقي" : "تقدير");

/**
 * The line a report or an export carries at its foot: the source word and, when it is «تقدير», why. One sentence, no tool names.
 * «حقيقي — من نظام الطلبات، آخر سحب قبل ساعة» · «تقدير — نظام الطلبات ما ردّ من 9 ساعات».
 */
export function stampOf(f: SourceFacts): string {
  const m = freshness(f).oms;
  return m.kind === "real" ? `حقيقي — ${m.note}` : `تقدير — ${m.note.replace(/: الأرقام تقدير$/, "")}`;
}
