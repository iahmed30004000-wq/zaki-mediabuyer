/**
 * M06 — the creative strategist (spec 11.2 / 11.4 / 7.6), Saturdays. The code finds the winning tags of each product
 * over 14 days (angle and hook, on cost per mature confirmed, enough sample only) and puts ONE «new script» request
 * per product into the studio's queue — production that never waits for fatigue. The agent writes the first-frame
 * and the notes in words; tags and counts are the code's. Tired winners get their own request from the fatigue job.
 * (Choosing a thumbnail needs a model that sees images — later, on the server.)
 */
import { z } from "zod";
import { db } from "@/server/db";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";
import { rankBy } from "@/core/weekly";
import { RULES } from "@/core/policy";

const DAY = 86_400_000;
const Words = z.object({ notes: z.array(z.object({ product_code: z.string(), first_frame: z.string().max(200), note: z.string().max(300) })).max(20) });

export async function weeklyCreativeRequests(now = new Date()) {
  const since = new Date(now.getTime() - 14 * DAY);
  const week = new Date(now.getTime() - 6 * DAY);
  const plans: { productCode: string; angle: string; hook: string; evidence: string }[] = [];
  for (const p of await db.productEconomics.findMany()) {
    if (p.stockDays !== null && p.stockDays < 5) continue;
    if (await db.creativeRequest.findFirst({ where: { productCode: p.productCode, kind: "new_script", createdAt: { gte: week } } })) continue;
    const ads = await db.ad.findMany({ where: { adSet: { campaign: { productCode: p.productCode } } }, select: { metaId: true, angleCode: true, hookCode: true } });
    const truth = await db.truthDaily.findMany({ where: { level: "ad", objectId: { in: ads.map((a) => a.metaId) }, date: { gte: since } }, select: { objectId: true, spendWithFee: true, confirmed: true } });
    const by = (k: "angleCode" | "hookCode") => rankBy(truth.map((t) => ({ key: ads.find((a) => a.metaId === t.objectId)?.[k] ?? "", spend: Number(t.spendWithFee), confirmed: t.confirmed })).filter((r) => r.key)).filter((r) => !r.smallSample);
    const angle = by("angleCode")[0];
    const hook = by("hookCode")[0];
    if (!angle || !hook) continue;
    plans.push({ productCode: p.productCode, angle: angle.key, hook: hook.key, evidence: `الزاوية ${angle.key} بـ ${angle.cost?.toFixed(2)}$ للمؤكد (${angle.confirmed}) · الخطّاف ${hook.key} بـ ${hook.cost?.toFixed(2)}$ (${hook.confirmed})` });
  }
  let words: z.infer<typeof Words>["notes"] = [];
  if (plans.length) {
    try {
      words = (await ask("M06", [{ role: "user", content: ["لكل منتج: الزاوية والخطّاف الرابحين (من الكود). اكتب فكرة إطار أول قصيرة وملاحظة للاستديو بالأردني، بلا أرقام وبلا ادعاء علاجي.", `رجّع JSON: {"notes":[{"product_code":"…","first_frame":"…","note":"…"}]}`, JSON.stringify(plans)].join("\n") }], Words)).notes;
    } catch (e) {
      if (!(e instanceof AgentUnavailable || e instanceof PrivacyRefusal)) throw e;
    }
  }
  const forbidden = RULES.filter((r) => r.level === "red").map((r) => ({ rule: r.rule, instead: r.alternative ?? null }));
  for (const p of plans) {
    const w = words.find((x) => x.product_code === p.productCode);
    await db.creativeRequest.create({
      data: {
        kind: "new_script",
        productCode: p.productCode,
        count: 3,
        brief: { why: "إنتاج مستمر قبل ما يتعب الرابح (7.6)", winning: { angle: p.angle, hook_type: p.hook }, evidence: p.evidence, first_frame: w && !/\d/.test(w.first_frame) ? w.first_frame : "أول إطار بيبيّن المنتج بإيد حدا، بلا كتابة كبيرة", note: w && !/\d/.test(w.note) ? w.note : null, forbidden },
      },
    });
  }
  return { requests: plans.length, by: words.length ? "agent" : "code" };
}
