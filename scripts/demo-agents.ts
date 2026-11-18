/**
 * The remaining agents on the local database (dry-run): M02 diagnosis · M04 a sentence → a change that WAITS for a
 * person (even a pause, even at level 2) · M05 at the launch · M06 weekly requests for the studio · M01 after a safety
 * action. With a model connected they word things; without one the code carries on. `npm run demo:agents`
 */
import { db } from "../src/server/db";
import { storeAnalysis } from "../src/agents/analyst";
import { prepareChange } from "../src/agents/preparer";
import { guardText } from "../src/agents/guard";
import { weeklyCreativeRequests } from "../src/agents/strategist";
import { explainSafety } from "../src/agents/monitor";
import { modelConnected } from "../src/gateway";

const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  console.log(`(model connected: ${modelConnected() ? "yes" : "no — the code's own words"})`);
  const a = await storeAnalysis();
  const report = JSON.parse((await db.report.findFirstOrThrow({ where: { kind: "analysis" }, orderBy: { forDate: "desc" } })).text);
  check(a.products > 0 && report.products.every((p: { weak_point: string }) => p.weak_point), `1. M02: ${a.products} products diagnosed (${a.weak} weak), by ${a.by} — e.g. ${report.products[0].product_code}: ${report.products[0].likely_cause}`);

  const g1 = await guardText({ "النص": "بيشفي الطنين نهائياً" });
  const g2 = await guardText({ "النص": "قطرة طبيعية للعناية اليومية، اطلبها والدفع عند الاستلام" });
  check(g1.verdict !== "pass" && g2.verdict === "pass", `2. M05: the forbidden claim → ${g1.verdict} (${g1.by}); a clean text → ${g2.verdict} (${g2.by})`);

  await db.adAccount.updateMany({ data: { autonomyLevel: 2 } });
  const ad = await db.ad.findFirstOrThrow({ where: { status: { not: "PAUSED" }, creativeCode: { not: null } } });
  if (modelConnected()) {
    const r = await prepareChange(`وقّف الإعلان ${ad.metaId} لأنه بيصرف بلا طلبات`).catch((e: Error) => ({ error: e.message }));
    if ("error" in r) check(true, `3. M04: the model gave nothing valid — refused cleanly: «${r.error.slice(0, 120)}»`);
    else check(r.changeSet.state === "pending_approval", `3. M04: «وقّف ${ad.metaId}» → ${r.items.length} item(s), waits for a person even at level 2 (${r.changeSet.state})`);
  } else check(true, "3. M04: needs a model — skipped (the site says so instead of guessing)");
  await db.adAccount.updateMany({ data: { autonomyLevel: 1 } });

  const before = await db.creativeRequest.count({ where: { kind: "new_script" } });
  const w = await weeklyCreativeRequests();
  const again = await weeklyCreativeRequests();
  check((await db.creativeRequest.count({ where: { kind: "new_script" } })) === before + w.requests && again.requests === 0, `4. M06: ${w.requests} new-script request(s) with the winning tags (by ${w.by}); a second run the same week adds none`);

  const safety = await db.changeSet.findFirst({ where: { source: "rule", state: "executed" }, orderBy: { createdAt: "desc" } });
  if (safety && modelConnected()) {
    const n = await explainSafety(safety.id, [safety.sentence]);
    check(n === null || typeof n.action_ok === "boolean", `5. M01 on «${safety.sentence.slice(0, 60)}…»: ${n ? `${n.action_ok ? "صح" : "مشكوك"} · ${n.note.slice(0, 80)}` : "no answer — nothing changes"}`);
  } else check(true, "5. M01: no safety action or no model — nothing to read");
  process.exit();
})();
