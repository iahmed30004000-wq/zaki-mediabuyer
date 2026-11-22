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
