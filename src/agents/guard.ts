/**
 * M05 — the guard on a model (spec 11.2 / 11.4 / 8). The dictionary (src/core/policy.ts) always runs first and its
 * «red» is final; the model reads the text a second time for what a word list cannot see (an implied cure, a
 * before/after, speaking to the viewer's condition) and may only ADD issues. Runs once, at the launch itself — not on
 * every keystroke. Without a model, the dictionary alone decides.
 */
import { z } from "zod";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";
import { checkPolicy } from "@/core/policy";

const Verdict = z.object({
  verdict: z.enum(["pass", "edit", "block"]),
  issues: z.array(z.object({ text: z.string().max(200), rule: z.string().max(160), alternative: z.string().max(200) })).max(8),
  appeal_draft: z.string().nullable().optional(),
});

export interface GuardResult {
  verdict: "pass" | "edit" | "block";
  issues: { text: string; rule: string; alternative: string | null }[];
  by: "dictionary" | "dictionary+agent";
}

export async function guardText(texts: Record<string, string>): Promise<GuardResult> {
  const dict = checkPolicy(texts);
  const base: GuardResult = {
    verdict: dict.flag === "red" ? (dict.hits.filter((h) => h.level === "red").every((h) => h.alternative) ? "edit" : "block") : "pass",
    issues: dict.hits.filter((h) => h.level === "red").map((h) => ({ text: h.text, rule: h.rule, alternative: h.alternative })),
    by: "dictionary",
  };
  if (base.verdict !== "pass") return base;
  try {
    const v = await ask("M05", [
      { role: "user", content: ["افحص نص إعلان لمنتج دفع عند الاستلام حسب سياسات ميتا (صحة · وعد بنتيجة · قبل/بعد · مخاطبة حالة الشخص · نص ديني كعلاج). القاموس ما لقى شي ممنوع، دورك تلاقي اللي القاموس ما بيشوفه. ما تبالغ: إذا سليم قول pass.", `رجّع JSON: {"verdict":"pass|edit|block","issues":[{"text":"…","rule":"…","alternative":"…"}],"appeal_draft":null}`, ...Object.entries(texts).map(([k, t]) => `${k}: «${t}»`)].join("\n") },
    ], Verdict);
    // the model may only add: an issue must quote words that are really in the text
    const all = Object.values(texts).join(" ");
    const issues = v.issues.filter((i) => i.text && all.includes(i.text.slice(0, 12)));
    if (v.verdict === "pass" || !issues.length) return { ...base, by: "dictionary+agent" };
    return { verdict: v.verdict, issues, by: "dictionary+agent" };
  } catch (e) {
    if (e instanceof AgentUnavailable || e instanceof PrivacyRefusal) return base;
    throw e;
  }
}
