/**
 * AN EMPTY REPORT (v6 · P0-2, U-07 · R-15, docs/rebuild-v6/04-numbers.md §10), pure.
 *
 * The jobs wrote a report every day even when there was nothing in it: three JSON reports of the code (plan · attribution · analysis) made of empty lists (the words of the code — «good», «by code» — are not content), and a
 * morning report of «صرف 0.00$ · طلبات 0». They covered the real reports and the morning one went to Telegram. An empty report is still saved (with the mark `empty`),
 * but it is not sent and it is not listed.
 */

/** The morning report is empty when it has no spend, no orders and no product line (the counts, not the words). */
export function isEmptyMorning(text: string): boolean {
  const account = /1\) الحساب: صرف (—|0\.00\$) · طلبات 0 · مؤكد 0/.test(text);
  const products = /2\) لكل منتج:\n\s*3\)/.test(text) || !/2\) لكل منتج:\n\s+\S/.test(text);
  return account && products;
}

/**
 * Is a report AS A VALUE empty — every figure in it zero, every text blank, every list and object empty or made of such? (docs/rebuild-v6/02-screens.md §3.4.)
 * The words of the code («good», «by: code») are texts and would make a report «not empty» — so a string counts only when it is not one of the code's own markers
 * (`by`, `attribution_health`). A boolean `false` is empty, `true` is content. Pure: it reads nothing, decides nothing about a number.
 */
export function isEmptyReportObject(report: unknown, key = ""): boolean {
  if (report === null || report === undefined) return true;
  if (typeof report === "number") return report === 0 || !Number.isFinite(report);
  if (typeof report === "boolean") return report === false;
  if (typeof report === "string") return report.trim() === "" || CODE_MARKERS.has(key);
  if (Array.isArray(report)) return report.every((v) => isEmptyReportObject(v));
  if (typeof report === "object") return Object.entries(report as Record<string, unknown>).every(([k, v]) => isEmptyReportObject(v, k));
  return false;
}
const CODE_MARKERS = new Set(["by", "attribution_health", "source", "kind", "version", "day", "date", "for_date"]);

/** `kind`: morning · weekly · monthly (text) or plan · attribution · analysis (JSON). Anything else is never called empty. */
export function isEmptyReport(kind: string, text: string): boolean {
  if (!text.trim()) return true;
  if (kind === "morning") return isEmptyMorning(text);
  if (kind === "plan" || kind === "attribution" || kind === "analysis") {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return false;
    }
    const none = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    // the words of the code («good», «by: code») are not content: only the lists and the figures are
    if (kind === "plan") return none(j.daily_allocation) && !j.total_usd;
    if (kind === "analysis") return none(j.products);
    return none(j.gaps) && none(j.capi_issues) && none(j.attributed_pct) && none(j.capi_accepted_pct);
  }
  return false;
}
