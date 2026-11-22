/**
 * «ابعتلي ملخص اليوم» (docs/rebuild-v6/01-model.md §9): the day's numbers the way the numbers screen computes them, written as a short report for the results page and one notice. The report
 * has no profit and no margin (those belong to `money.view`, and a report is read by roles that may not hold it). A day with no number at all fails the step with the reason.
 */
import { evalDailySummary, parseRecipeParams, stoppedAt, type RecipeOutcome } from "@/core/recipes";
import type { RecipeDeps, RecipeRunCtx } from "./types";

export async function runDailySummary(ctx: RecipeRunCtx, deps: RecipeDeps): Promise<RecipeOutcome> {
  const p = parseRecipeParams("daily_summary", ctx.params);
  if (!p.ok) return stoppedAt("s1", `إعدادات الوصفة ناقصة: ${p.message}`);
  const n = await deps.numbers(p.params.period, ctx.now);
  return evalDailySummary(p.params, { jobKey: ctx.jobKey, now: ctx.now, label: n.label, totals: n.totals, prev: n.prev, products: n.products.map((x) => ({ name: x.name, set: x.current })), runHref: ctx.runHref });
}
