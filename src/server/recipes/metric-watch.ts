/**
 * «نبّهني لما رقم يعدّي حد» (docs/rebuild-v6/01-model.md §9): one number of the short list of 04-numbers.md §3, for one product or all, over a period — the number the screens show, computed by the code
 * (`loadNumbers`) — against the limit the owner wrote. A number that is not known (no spend row, no orders) fails the step with the reason; it is never read as zero.
 */
import { ALL_PRODUCTS, evalMetricWatch, parseRecipeParams, stoppedAt, watchMetric, type RecipeOutcome } from "@/core/recipes";
import type { RecipeDeps, RecipeRunCtx } from "./types";

export async function runMetricWatch(ctx: RecipeRunCtx, deps: RecipeDeps): Promise<RecipeOutcome> {
  const p = parseRecipeParams("metric_watch", ctx.params);
  if (!p.ok) return stoppedAt("s1", `إعدادات الوصفة ناقصة: ${p.message}`);
  const m = watchMetric(p.params.metric);
  if (!m) return stoppedAt("s1", "رقم مش معروف");
  const n = await deps.numbers(p.params.period, ctx.now);
  let value: number | null;
  let productName = "كل المنتجات";
  if (p.params.product === ALL_PRODUCTS) value = n.totals[m.set];
  else {
    const row = n.products.find((x) => x.code === p.params.product);
    productName = row?.name ?? (await deps.products()).find((x) => x.code === p.params.product)?.name ?? p.params.product;
    // a product with no numbers at all in the period has no row: that is «not known», not zero
    value = row ? row.current[m.set] : null;
  }
  return evalMetricWatch(p.params, { jobKey: ctx.jobKey, now: ctx.now, value, productName });
}
