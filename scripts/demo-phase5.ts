/**
 * The Phase 5 acceptance run (spec 14 T5.1–T5.3), in dry-run, on the local database:
 *   1. a proven winner (3 days under the ceiling, enough confirmed) waits for approval at level 1, and is raised by
 *      one 20% step on its own at level 2 — then not again for 48 h;
 *   2. level 2 needs two weeks of decisions, level 3 is off;
 *   3. the weekly plan stays inside the cap; the weekly and monthly reports are built by code, lessons kept;
 *   4. the consultant answers from the code's facts when no model is connected.
 * `npx tsx --env-file=.env scripts/demo-phase5.ts` (run `npm run demo:pipeline` first)
 */
import { db } from "../src/server/db";
import { runScale, gatherScale } from "../src/jobs/scale-run";
import { storePlan } from "../src/agents/planner";
import { storePeriodReport } from "../src/jobs/weekly-report";
import { consult } from "../src/agents/consultant";
import { levelChange } from "../src/core/autonomy";

const DAY = 86_400_000;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const account = await db.adAccount.findUniqueOrThrow({ where: { metaId: "act_1029" } });
  await db.adAccount.update({ where: { id: account.id }, data: { autonomyLevel: 1, dailyCap: 400 } });

  // a winner of our own: 3 days at ~3.16$ per confirmed (ceiling ~6.23$), 8 confirmed a day (as good as the product
  // or better, whatever the other demos left), no edit for 10 days
  const old = new Date(now.getTime() - 10 * DAY);
  await db.changeItem.deleteMany({ where: { objectId: "DEMO5_AS" } });
  await db.ruleRun.deleteMany({ where: { targetId: "DEMO5_AS" } });
  const cmp = await db.campaign.upsert({ where: { metaId: "DEMO5_C" }, create: { metaId: "DEMO5_C", accountId: account.id, name: "SY_TRF01_WEB_SCALE_261016_C02", status: "ACTIVE", productCode: "TRF01", namingOk: true }, update: { status: "ACTIVE" } });
  const as = await db.adSet.upsert({ where: { metaId: "DEMO5_AS" }, create: { metaId: "DEMO5_AS", campaignId: cmp.id, name: "BROAD_ADV_SP_CPT0040_v1", status: "ACTIVE", conceptId: "CPT0040", pageCode: "SP", dailyBudget: 30, lastSignificantEditAt: old }, update: { status: "ACTIVE", dailyBudget: 30, lastSignificantEditAt: old } });
  await db.ad.upsert({ where: { metaId: "DEMO5_AD" }, create: { metaId: "DEMO5_AD", adSetId: as.id, name: "CR00240_H07_HER_LP1", status: "ACTIVE", creativeCode: "CR00240", hookCode: "H07", angleCode: "HER", lpCode: "LP1" }, update: { status: "ACTIVE" } });
  await db.attributedOrder.deleteMany({ where: { omsOrderId: { startsWith: "DEMO5-" } } });
  for (let d = 1; d <= 3; d++) {
    const date = new Date(today.getTime() - d * DAY);
    await db.insightDaily.upsert({
      where: { level_objectId_date: { level: "ad", objectId: "DEMO5_AD", date } },
      create: { level: "ad", objectId: "DEMO5_AD", date, spend: 25, impressions: 9000, reach: 7000, frequency: 1.3, linkClicks: 160, outboundClicks: 150, lpv: 120, purchases: 8, conversations: 0, video3s: 3000, thruplays: 900, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, attributionSetting: "7d_click" },
      update: { spend: 25 },
    });
    for (let n = 0; n < 8; n++) {
      const created = new Date(date.getTime() + (8 + n) * 3_600_000);
      await db.attributedOrder.create({ data: { omsOrderId: `DEMO5-${d}-${n}`, productCode: "TRF01", market: "SY", channel: "website", adId: "DEMO5_AD", adSetId: "DEMO5_AS", campaignId: "DEMO5_C", adName: "CR00240_H07_HER_LP1", method: "ad_id", status: "confirmed", createdAtOms: created, confirmedAt: created, orderValue: 20, currency: "USD", matureAt: new Date(created.getTime() - DAY) } });
    }
  }

  const row = (await gatherScale(now)).find((r) => r.adSetId === "DEMO5_AS")!;
  check(row.decision.raise, `0. the ladder: ${row.decision.raise ? row.decision.sentence : row.decision.blockers.join(" | ")}`);

  const s1 = await runScale(now);
  const waiting = await db.changeSet.findFirst({ where: { kind: "raise_step", items: { some: { objectId: "DEMO5_AS" } } }, orderBy: { createdAt: "desc" } });
  check(s1.waiting >= 1 && waiting?.state === "pending_approval", `1a. level 1: the raise waits for you (${waiting?.state}, +${waiting?.spendDeltaDaily}$/day)`);

  await db.changeSet.update({ where: { id: waiting!.id }, data: { state: "rejected" } });
  await db.ruleRun.deleteMany({ where: { targetId: "DEMO5_AS" } });
  await db.adAccount.update({ where: { id: account.id }, data: { autonomyLevel: 2 } });
  await runScale(now);
  const auto = await db.changeSet.findFirst({ where: { kind: "raise_step", items: { some: { objectId: "DEMO5_AS" } } }, orderBy: { createdAt: "desc" }, include: { items: true } });
  check(auto?.state === "executed" && (auto.items[0]!.after as { dailyBudget: number }).dailyBudget === 36, `1b. level 2: raised on its own 30$ → ${(auto?.items[0]?.after as { dailyBudget?: number })?.dailyBudget}$ (${auto?.state}, dry-run)`);
  await db.adSet.update({ where: { id: as.id }, data: { dailyBudget: 36 } });
  await db.ruleRun.deleteMany({ where: { targetId: "DEMO5_AS" } });
  const again = (await gatherScale(now)).find((r) => r.adSetId === "DEMO5_AS")!;
  check(!again.decision.raise, `   …and not again today: ${again.decision.blockers.join(" | ")}`);

  check(!levelChange(1, 2, { daysOfDecisions: 3, restricted: false }).ok && !levelChange(2, 3, { daysOfDecisions: 99, restricted: false }).ok, "2. level 2 needs two weeks of decisions; level 3 is off");

  const plan = await storePlan(now);
  check(plan.total <= 400 + 260, `3a. the week's plan: ${plan.total}$ a day in ${plan.lines} lines, inside the caps (written by ${plan.by})`);
  const weekly = await storePeriodReport("weekly", now);
  const text = (await db.report.findUniqueOrThrow({ where: { kind_forDate: { kind: "weekly", forDate: weekly.forDate } } })).text;
  check(text.includes("الترتيب على تكلفة المؤكد") && text.includes("المطابقة"), `3b. weekly report built by code (${weekly.chars} chars, ${weekly.lessons} lesson(s) kept)`);
  console.log(text.split("\n").slice(0, 12).map((l) => `      ${l}`).join("\n"));
  const monthly = await storePeriodReport("monthly", now);
  check(monthly.chars > 0, `   …and the monthly one with the system's accuracy (${monthly.chars} chars)`);

  const c = await consult("أي منتج رابح فعلاً هالأسبوع؟", "الإعلانات");
  check(c.facts.length > 0 && c.facts.every((f) => !/\+?9639\d{7}/.test(f)), `4. the consultant (${c.by}): ${c.facts.length} facts, every number tagged, no customer data`);

  await db.adAccount.update({ where: { id: account.id }, data: { autonomyLevel: 1, dailyCap: account.dailyCap } });
  process.exit();
})();
