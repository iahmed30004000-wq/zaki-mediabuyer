/**
 * «ذكّر شخص» (docs/rebuild-v6/01-model.md §9): a text the owner wrote, to one person of the team directory. The person must be there and switched on; the notice is theirs (their Telegram when the
 * owner linked one for them, the site otherwise). The text went through the privacy check when the job was made — it carries no phone, e-mail or key.
 */
import { evalRemind, parseRecipeParams, stoppedAt, type RecipeOutcome } from "@/core/recipes";
import type { RecipeDeps, RecipeRunCtx } from "./types";

export async function runRemind(ctx: RecipeRunCtx, deps: RecipeDeps): Promise<RecipeOutcome> {
  const p = parseRecipeParams("remind", ctx.params);
  if (!p.ok) return stoppedAt("s1", `إعدادات الوصفة ناقصة: ${p.message}`);
  return evalRemind(p.params, { jobKey: ctx.jobKey, ref: ctx.ref, person: await deps.person(p.params.person) });
}
