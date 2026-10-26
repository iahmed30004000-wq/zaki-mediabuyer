/**
 * Runs the whole Phase 1 pipeline against the fake Meta + fake OMS, TWICE, on the real local database, and checks:
 *   1. the second run changes no counts (spec T1.6: «إعادة السحب ما بتكرر»);
 *   2. ad CR00147 comes out as the truth example of spec 17.1 (5.51 · 6.64 · 107.77).
 * `npm run demo:pipeline`
 */
import { db } from "../src/server/db";
import { fakeFetch, fixtureDate, metaIdOf, FAKE_OMS_URL } from "../src/adapters/fixtures";
import { syncMeta } from "../src/jobs/meta-sync";
import { syncOms, computeTruthDays } from "../src/jobs/truth";

async function counts() {
  const [campaigns, ads, insights, orders, truth] = await Promise.all([db.campaign.count(), db.ad.count(), db.insightDaily.count(), db.attributedOrder.count(), db.truthDaily.count()]);
  return { campaigns, ads, insights, orders, truth };
}

async function once(now: Date) {
  process.env.META_SYSTEM_USER_TOKEN ||= "demo-token-not-real";
  const f = fakeFetch(now);
  const date = fixtureDate(now);
  const meta = await syncMeta({ since: date, until: date, fetch: f });
  const oms = await syncOms({ baseUrl: FAKE_OMS_URL, token: "demo", fetch: f }, new Date(0));
  const d = new Date(`${date}T00:00:00Z`);
  const truth = await computeTruthDays(d, d, now);
  return { meta, oms, truth };
}

(async () => {
  const now = new Date();
  console.log("run 1", JSON.stringify(await once(now)));
  const a = await counts();
  console.log("run 2", JSON.stringify(await once(now)));
  const b = await counts();
  console.log("counts after run 1", a);
  console.log("counts after run 2", b);
  const same = JSON.stringify(a) === JSON.stringify(b);
  const t = await db.truthDaily.findFirst({ where: { level: "ad", objectId: metaIdOf("a1") } });
  const ok = t && Number(t.costPerConfirmed).toFixed(2) === "5.51" && Number(t.scalingCeiling).toFixed(2) === "6.64" && Number(t.profitAfterCosts).toFixed(2) === "107.77";
  console.log("CR00147 truth:", t && { costPerConfirmed: Number(t.costPerConfirmed).toFixed(2), ceiling: Number(t.scalingCeiling).toFixed(2), profit: Number(t.profitAfterCosts).toFixed(2), roas: Number(t.trueRoas).toFixed(2) });
  console.log(same ? "✓ second pull changed nothing" : "✗ second pull changed counts");
  console.log(ok ? "✓ spec 17.1 reproduced from the pipeline" : "✗ spec 17.1 NOT reproduced");
  await db.$disconnect();
  process.exit(same && ok ? 0 : 1);
})();
