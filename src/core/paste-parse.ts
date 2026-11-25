/**
 * PASTING NUMBERS (v3 · quick entry), pure. The owner pastes what he copied — a table from Ads Manager, a CSV export, a sheet — and
 * this turns the text into metric rows the way `push_metrics` takes them. It reads the header line, matches each column to a field
 * by its name (English or Arabic; the match is a plain table, not a guess), reads numbers the way people write them (٣٬٤٥٠.٥ · $1,234.50 ·
 * 12,5% · 1 234), and says per line what it could not read. It never invents an id, a date or a number: a column it does not know is
 * listed and left out; a missing id is a problem to fix, not something to make up. The rows then go through the same `checkRows` as every
 * push, and the same `applyMetrics` stores them.
 */
import { foreignCurrencyIn, UNKNOWN_CURRENCY } from "./currency";
import type { PushLevel } from "./push-rows";

export interface PasteContext {
  /** the business day to use for lines that carry no date column (YYYY-MM-DD) */
  day: string;
  /** what the lines are about; a header like «Ad ID» overrides it */
  level: PushLevel;
}

export interface PasteIssue {
  /** 1-based line of the pasted text (the header is line 1) */
  line: number;
  error: string;
}

export interface PasteResult {
  delimiter: "tab" | "comma" | "semicolon" | "pipe" | "none";
  /** header → the field it feeds */
  mapped: { header: string; field: string }[];
  /** headers left out because they are not known */
  unmapped: string[];
  /** one row per readable line, keyed like a pushed metric row */
  rows: { line: number; row: Record<string, unknown> }[];
  issues: PasteIssue[];
}

// ───────────────────────────── reading text ─────────────────────────────

const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const latin = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d]!).replace(/٬/g, ",").replace(/٫/g, ".");

/** A number as people write it, or null. `5` · `1,234.50` · `1.234,50` · `12,5` · `٣٬٤٥٠` · `$12` · `12%` · `1 234` · `—`. */
export function readNumber(raw: string): number | null {
  let s = latin(raw).replace(/[\s $€£]|USD|JOD|دولار|دينار/gi, "").replace(/%$/, "");
  if (!s || s === "-" || s === "—" || /^n\/?a$/i.test(s)) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // both: the later one is the decimal mark, the other groups thousands
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // «1,234» or «1,234,567» groups thousands; «12,5» is a decimal comma
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && (s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ""); // «1.234.567»
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A date as YYYY-MM-DD: `2026-11-14`, `14/11/2026`, `14-11-2026`, `14.11.2026` (day first — the way it is written here), Arabic digits too. */
export function readDate(raw: string): string | null {
  const s = latin(raw).trim();
  let y: number, m: number, d: number;
  let hit = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])] as [number, number, number];
  else if ((hit = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])] as [number, number, number];
  else return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Splits one line into cells, honouring «quotes» (a comma inside quotes stays). */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === delimiter && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const DELIMS = [
  ["tab", "\t"],
  ["semicolon", ";"],
  ["pipe", "|"],
  ["comma", ","],
] as const;

/** The delimiter that splits the header line into the most cells (tab wins a tie, then ; | ,). */
export function detectDelimiter(headerLine: string): { name: PasteResult["delimiter"]; char: string } {
  let best: { name: PasteResult["delimiter"]; char: string; n: number } = { name: "none", char: "\t", n: 1 };
  for (const [name, char] of DELIMS) {
    const n = splitLine(headerLine, char).length;
    if (n > best.n) best = { name, char, n };
  }
  return { name: best.name, char: best.char };
}

// ───────────────────────────── the columns ─────────────────────────────

type Field = string;
/** header (lower case, no punctuation) → field. Level-bearing id headers carry the level they mean. */
const HEADERS: Record<string, Field> = {};
const add = (field: Field, names: string[]) => names.forEach((n) => (HEADERS[norm(n)] = field));
function norm(h: string): string {
  return latin(h)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[_\-–—:.،,؛;/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

add("date", ["day", "date", "reporting starts", "reporting date", "التاريخ", "اليوم", "بداية التقارير", "تاريخ"]);
add("id:ad", ["ad id", "ad number", "معرف الإعلان", "رقم الإعلان", "ادي الإعلان"]);
add("id:adset", ["ad set id", "adset id", "معرف المجموعة", "رقم المجموعة", "معرف المجموعة الإعلانية"]);
add("id:campaign", ["campaign id", "معرف الحملة", "رقم الحملة"]);
add("id:account", ["account id", "ad account id", "معرف الحساب", "رقم الحساب"]);
add("id:product", ["product code", "product id", "رمز المنتج", "كود المنتج"]);
add("id", ["id", "المعرف", "معرف", "الرقم"]);
add("name", ["ad name", "ad set name", "adset name", "campaign name", "name", "الاسم", "اسم الإعلان", "اسم الحملة", "اسم المجموعة", "اسم المجموعة الإعلانية"]);
add("product", ["product", "المنتج"]);
add("status", ["delivery", "status", "الحالة", "التسليم", "حالة التسليم"]);
add("budget_daily", ["daily budget", "budget", "الميزانية اليومية", "الميزانية"]);
add("spend", ["amount spent", "spend", "cost", "spent", "الصرف", "المبلغ المنفق", "المصروف", "المبلغ المصروف", "التكلفة"]);
add("impressions", ["impressions", "مرات الظهور", "الانطباعات", "الظهور"]);
add("reach", ["reach", "الوصول", "الأشخاص الذين تم الوصول إليهم"]);
add("link_clicks", ["link clicks", "clicks link", "النقرات على الرابط", "نقرات الرابط"]);
add("outbound_clicks", ["outbound clicks", "النقرات الصادرة"]);
add("lpv", ["landing page views", "lpv", "مشاهدات صفحة الهبوط", "مشاهدات صفحة الوجهة"]);
add("pixel_purchases", ["purchases", "website purchases", "pixel purchases", "المشتريات", "عمليات الشراء"]);
add("conversations", ["messaging conversations started", "conversations", "محادثات", "المحادثات", "المحادثات المبدوءة"]);
add("video_3s", ["3 second video plays", "video 3s", "مشاهدات 3 ثوان"]);
add("thruplays", ["thruplays", "thru plays", "thruplay"]);
add("frequency", ["frequency", "التكرار"]);
add("cpm", ["cpm", "cost per 1000 impressions", "تكلفة الألف ظهور"]);
add("ctr", ["ctr", "link click through rate", "ctr link click through rate", "نسبة النقر إلى الظهور"]);
add("real_orders", ["orders", "real orders", "الطلبات", "الطلبات الحقيقية"]);
add("confirmed", ["confirmed", "المؤكد", "المؤكدة"]);
add("shipped", ["shipped", "المشحون", "المشحونة"]);
add("delivered", ["delivered", "المسلم", "المسلّم", "المسلمة"]);
add("returned", ["returned", "المرتجع", "المرتجعة"]);
add("collected", ["collected", "المحصل", "المحصّل"]);
add("stock_units", ["stock", "stock units", "المخزون", "القطع الباقية"]);

/** Integer-valued fields (a count); the rest are amounts (money · ratios). */
const COUNTS = new Set(["impressions", "reach", "link_clicks", "outbound_clicks", "lpv", "pixel_purchases", "conversations", "video_3s", "thruplays", "real_orders", "confirmed", "shipped", "delivered", "returned", "stock_units"]);
const AMOUNTS = new Set(["spend", "budget_daily", "frequency", "cpm", "ctr", "collected"]);
const TEXTS = new Set(["name", "product", "status"]);
/** The columns that are money: pasted figures are dollars (the push's contract), so another currency is refused, never read as dollars (v6 · P11). */
const MONEY = new Set(["spend", "budget_daily", "cpm", "collected"]);
const wrongCurrency = (column: string, code: string) => `${column}: بعملة ${code === UNKNOWN_CURRENCY ? "تانية" : code} — اللصق بالدولار بس. حوّل الأرقام لدولار، أو استورد ملف ميتا من «الاستيراد»`;

/** most specific first */
const ID_ORDER = ["id:ad", "id:adset", "id:campaign", "id:account", "id:product"];
const LEVEL_OF: Record<string, PushLevel> = { "id:ad": "ad", "id:adset": "adset", "id:campaign": "campaign", "id:account": "account", "id:product": "product" };

/** What a header means, or null. */
export const fieldOf = (header: string): string | null => HEADERS[norm(header)] ?? null;

// ───────────────────────────── the whole paste ─────────────────────────────

export const MAX_PASTE_LINES = 500;
export const MAX_PASTE_CHARS = 200_000;

export function parsePaste(text: string, ctx: PasteContext): PasteResult {
  const empty: PasteResult = { delimiter: "none", mapped: [], unmapped: [], rows: [], issues: [] };
  const clean = text.replace(/^﻿/, "");
  if (clean.length > MAX_PASTE_CHARS) return { ...empty, issues: [{ line: 0, error: `النص طويل (${clean.length} حرف) — الحد ${MAX_PASTE_CHARS}` }] };
  const lines = clean.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.trim());
  if (lines.length < 2) return { ...empty, issues: [{ line: 0, error: "الصق سطر العناوين وتحته سطر أرقام على الأقل" }] };
  if (lines.length - 1 > MAX_PASTE_LINES) return { ...empty, issues: [{ line: 0, error: `${lines.length - 1} سطر — الحد ${MAX_PASTE_LINES} بالمرة` }] };

  const head = lines[0]!;
  const d = detectDelimiter(head.l);
  if (d.name === "none") return { ...empty, issues: [{ line: head.n, error: "ما انفهم السطر الأول كعناوين — لازم تكون مفصولة بـ Tab أو فاصلة أو ;" }] };
  const headers = splitLine(head.l, d.char);
  const cols = headers.map((h) => ({ header: h, field: fieldOf(h) }));
  // which level the lines are: the MOST SPECIFIC id column present says so (Ad ID beats Ad set ID beats Campaign ID); a plain «ID» uses the chosen level
  const idHeaders = cols.map((c) => c.field).filter((f): f is string => !!f && f.startsWith("id:"));
  const own = ID_ORDER.find((f) => idHeaders.includes(f));
  const level: PushLevel = (own && LEVEL_OF[own]) || ctx.level;
  // each column → the field it feeds: the level's own id → id; the level above → parent_id; the account → account_id; any other id column is not needed
  const PARENT: Partial<Record<PushLevel, string>> = { ad: "id:adset", adset: "id:campaign", campaign: "id:account" };
  const target = (field: string | null): string | null => {
    if (!field) return null;
    if (!field.startsWith("id:")) return field;
    if (field === own) return "id";
    if (field === PARENT[level]) return "parent_id";
    if (field === "id:account" && level !== "account") return "account_id";
    return null;
  };
  const mapped = cols.map((c) => ({ header: c.header, field: target(c.field) })).filter((c): c is { header: string; field: string } => !!c.field);
  const unmapped = cols.filter((c) => (!c.field || !target(c.field)) && c.header).map((c) => c.header);
  const idCol = cols.findIndex((c) => target(c.field) === "id");
  const issues: PasteIssue[] = [];
  if (idCol < 0) issues.push({ line: head.n, error: "ما في عمود معرّف (Ad ID · Campaign ID …) — ضيفه بتصدير Ads Manager؛ الموقع ما بيخمّن معرّف" });

  const rows: PasteResult["rows"] = [];
  const foreign = cols.flatMap((c) => {
    const code = c.field && MONEY.has(c.field) ? foreignCurrencyIn(c.header) : null;
    return code ? [wrongCurrency(c.header, code)] : [];
  });
  if (foreign.length) return { delimiter: d.name, mapped, unmapped, rows, issues: [...issues, { line: head.n, error: foreign.join(" · ") }] };
  for (const { l, n } of lines.slice(1)) {
    const cells = splitLine(l, d.char);
    const row: Record<string, unknown> = { date: ctx.day, level };
    const bad: string[] = [];
    cols.forEach((c, i) => {
      const raw = (cells[i] ?? "").trim();
      if (!c.field || !raw) return;
      const f = target(c.field);
      if (!f) return;
      if (f === "date") {
        const dt = readDate(raw);
        if (dt) row.date = dt;
        else bad.push(`${c.header}: تاريخ مش مفهوم («${raw.slice(0, 20)}»)`);
      } else if (f === "id" || f === "parent_id" || f === "account_id") row[f] = latin(raw).trim();
      else if (TEXTS.has(f)) row[f] = raw.slice(0, 200);
      else if (MONEY.has(f) && foreignCurrencyIn(raw)) bad.push(wrongCurrency(c.header, foreignCurrencyIn(raw)!));
      else if (COUNTS.has(f) || AMOUNTS.has(f)) {
        const v = readNumber(raw);
        if (v === null) bad.push(`${c.header}: رقم مش مفهوم («${raw.slice(0, 20)}»)`);
        else if (v < 0) bad.push(`${c.header}: سالب`);
        else if (COUNTS.has(f) && !Number.isInteger(v)) bad.push(`${c.header}: لازم عدد صحيح («${raw.slice(0, 20)}»)`);
        else row[f] = v;
      }
    });
    if (bad.length) {
      issues.push({ line: n, error: bad.join(" · ") });
      continue;
    }
    if (idCol >= 0 && row.id === undefined) {
      issues.push({ line: n, error: "السطر بلا معرّف" });
      continue;
    }
    if (row.id !== undefined) rows.push({ line: n, row });
  }
  return { delimiter: d.name, mapped, unmapped, rows, issues };
}
