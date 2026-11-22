/**
 * A REPORT OF THE CODE, READ AS SENTENCES AND A TABLE (docs/rebuild-v6/03-look.md §7 `ReportBody`): never JSON on a screen. The code hands over an
 * object (a night round's result, a day's numbers); this turns it into `facts` (label · value lines), `tables` (a list of objects) and `sections`
 * (an object inside the object), in the owner's words where `labels` knows the key. Pure: it reads nothing and decides nothing — every number is
 * already computed; here it is only WRITTEN.
 */

export interface ReportFact {
  label: string;
  value: string;
}

export interface ReportTable {
  title: string;
  columns: string[];
  /** a row is the cells in the order of `columns`; a missing cell is «—» */
  rows: string[][];
  /** how many rows were left out (the table is cut at `maxRows`) */
  more: number;
}

export interface ReportDoc {
  facts: ReportFact[];
  tables: ReportTable[];
  sections: { title: string; doc: ReportDoc }[];
}

export interface DescribeOptions {
  /** the owner's word for a key: `{ scaled: "كبّرنا" }`. A key with no word is written as it is, with `_` as a space. */
  labels?: Readonly<Record<string, string>>;
  /** a table is cut here (default 25) */
  maxRows?: number;
  /** how deep an object inside an object is followed (default 3); deeper than that is written as «…» */
  maxDepth?: number;
}

const DASH = "—";

/** How a single value is written: English digits (`1,234.5`), «أيوه / لأ», «—» for nothing, a short list joined by «، ». */
export function writeValue(v: unknown): string {
  if (v === null || v === undefined) return DASH;
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : DASH;
  if (typeof v === "boolean") return v ? "أيوه" : "لأ";
  if (typeof v === "string") return v.trim() === "" ? DASH : v;
  if (Array.isArray(v)) return v.length ? v.map(writeValue).join("، ") : DASH;
  return "…";
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
const isScalar = (v: unknown): boolean => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v) || v instanceof Date;

const labelOf = (key: string, labels: Readonly<Record<string, string>>): string => labels[key] ?? key.replace(/[_-]+/g, " ").trim();

/** Turn a report into a document. A value that is not an object (a number, a string, a list of numbers) becomes one line with an empty label. */
export function describeReport(report: unknown, opts: DescribeOptions = {}): ReportDoc {
  const labels = opts.labels ?? {};
  const maxRows = opts.maxRows ?? 25;
  const maxDepth = opts.maxDepth ?? 3;

  const build = (value: unknown, depth: number): ReportDoc => {
    const doc: ReportDoc = { facts: [], tables: [], sections: [] };
    if (!isPlainObject(value)) {
      doc.facts.push({ label: "", value: writeValue(value instanceof Date ? value.toISOString() : value) });
      return doc;
    }
    for (const [key, v] of Object.entries(value)) {
      const label = labelOf(key, labels);
      if (v instanceof Date) doc.facts.push({ label, value: v.toISOString() });
      else if (isScalar(v)) doc.facts.push({ label, value: writeValue(v) });
      else if (Array.isArray(v)) {
        if (v.length > 0 && v.every(isPlainObject)) {
          const rows = v as Record<string, unknown>[];
          const columnKeys: string[] = [];
          for (const r of rows) for (const k of Object.keys(r)) if (!columnKeys.includes(k) && isScalar(r[k])) columnKeys.push(k);
          doc.tables.push({
            title: label,
            columns: columnKeys.map((k) => labelOf(k, labels)),
            rows: rows.slice(0, maxRows).map((r) => columnKeys.map((k) => writeValue(r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k]))),
            more: Math.max(0, rows.length - maxRows),
          });
        } else doc.facts.push({ label, value: writeValue(v) });
      } else if (depth >= maxDepth) doc.facts.push({ label, value: "…" });
      else doc.sections.push({ title: label, doc: build(v, depth + 1) });
    }
    return doc;
  };

  return build(report, 1);
}

/** Does the document say nothing at all? (the screen then says «ما في تفاصيل» instead of an empty box) */
export const isEmptyDoc = (d: ReportDoc): boolean => !d.facts.length && !d.tables.length && d.sections.every((s) => isEmptyDoc(s.doc));
