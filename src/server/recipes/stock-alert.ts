/**
 * «نبّهني لما منتج يقرب يخلص» (docs/rebuild-v6/01-model.md §9): the newest stock reading of each product against the owner's limits. A product with no reading, or a reading that is too old,
 * is not a zero — the step says so. The notice key is the one a push of the stock writes (`stockAlertKey`), so a product Claude already told about today is not told about twice.
 */
import { evalStockAlert, parseRecipeParams, stoppedAt, type RecipeOutcome } from "@/core/recipes";
import type { RecipeDeps, RecipeRunCtx } from "./types";

export async function runStockAlert(ctx: RecipeRunCtx, deps: RecipeDeps): Promise<RecipeOutcome> {
  const p = parseRecipeParams("stock_alert", ctx.params);
  if (!p.ok) return stoppedAt("s1", `إعدادات الوصفة ناقصة: ${p.message}`);
  const [products, readings, rules] = await Promise.all([deps.products(), deps.stockReadings(), deps.stockRules()]);
  return evalStockAlert(p.params, { now: ctx.now, products, readings, limits: rules.limits, audience: rules.audience });
}
