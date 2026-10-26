/**
 * The Phase 2 acceptance run (spec 14 T2.1 / T2.2), in dry-run, on the local database filled by the demo pipeline:
 *   1. a loser ad (spent > 2 × T, no order, > 48 h) is paused by the rule at level 1, with its reason;
 *   2. a budget raise at level 1 waits for approval;
 *   3. the kill switch pauses every active campaign;
 *   4. «رجّع» undoes a change, and a third flip on the same object in 48 h freezes it for the owner.
 * `npx tsx --env-file=.env scripts/demo-guard.ts` (run `npm run demo:pipeline` first)
 */
import { db } from "../src/server/db";
import { runRules } from "../src/jobs/rules-run";
import { killSwitch, propose, rollback } from "../src/server/changes";

const owner = { id: "demo-owner", role: "OWNER" as const, demo: true };
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  // clean slate for the guard tables, keep the archive
  await db.changeItem.deleteMany();
  await db.changeSet.deleteMany();
  await db.ruleRun.deleteMany();
  await db.freeze.deleteMany();
  await db.killSwitchEvent.deleteMany();
  await db.alert.deleteMany();
  await db.adAccount.updateMany({ data: { dailyCap: 260, autonomyLevel: 1 } });

  // a loser: spent 12$ three days ago, no order at all
  const adset = await db.adSet.findFirstOrThrow({ where: { status: { not: "PAUSED" }, campaign: { productCode: "TRF01" } } });
  const loser = await db.ad.upsert({ where: { metaId: "120211999999999" }, create: { metaId: "120211999999999", adSetId: adset.id, name: "CR00199_H09_PRB_LP1", status: "ACTIVE" }, update: { status: "ACTIVE" } });
  const day = new Date(Date.now() - 3 * 86_400_000);
  day.setUTCHours(0, 0, 0, 0);
  await db.insightDaily.upsert({
    where: { level_objectId_date: { level: "ad", objectId: loser.metaId, date: day } },
    create: { level: "ad", objectId: loser.metaId, date: day, spend: 12, impressions: 4000, reach: 3200, frequency: 1.2, linkClicks: 30, outboundClicks: 28, lpv: 20, purchases: 0, conversations: 0, video3s: 900, thruplays: 120, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, attributionSetting: "7d_click" },
    update: { spend: 12 },
  });

  const stats = await runRules();
  console.log("rules:", stats);
  const paused = await db.changeSet.findFirst({ where: { items: { some: { objectId: loser.metaId } } }, include: { items: true } });
  check(paused?.state === "executed" && paused.reasonCode === "S01", `1. the loser was paused by the rule (state ${paused?.state}, ${paused?.reasonCode}) — «${paused?.sentence}»`);
  check(paused?.writeMode === "dry_run" && JSON.stringify(paused.items[0]?.apiResponse).includes("PAUSED"), "   …in dry-run: recorded what it would send, sent nothing");
  check((await db.ruleRun.count({ where: { targetId: loser.metaId } })) === 1, "   …and the rule run is logged once");
  await runRules();
  check((await db.changeSet.count({ where: { items: { some: { objectId: loser.metaId } } } })) === 1, "   …a second run inside the cooldown does nothing again");

  const raise = await propose({ source: "rule", sourceRef: "scale", reasonCode: "S12", sentence: "تكبير 20%", kind: "raise_step", accountMetaId: (await db.adAccount.findFirstOrThrow()).metaId, items: [{ op: "set_budget", objectType: "adset", objectId: adset.metaId, before: { dailyBudget: 40 }, after: { dailyBudget: 48 } }] }, { type: "rule", id: "scale" });
  check(raise.state === "pending_approval", `2. a raise at level 1 waits for approval (state ${raise.state}, +${raise.spendDeltaDaily}$/day)`);

  const back = await rollback(paused!.id, owner);
  const original = await db.changeSet.findUniqueOrThrow({ where: { id: paused!.id } });
  check(back.state === "executed" && original.state === "rolled_back", "4a. «رجّع» resumed the ad with a new change and marked the original rolled_back");
  const again = await propose({ source: "user", sourceRef: "demo-owner", reasonCode: "S11", sentence: "وقف يدوي", kind: "safety_pause", items: [{ op: "pause", objectType: "ad", objectId: loser.metaId, before: { status: "ACTIVE" }, after: { status: "PAUSED" } }] }, { type: "user", id: "demo-owner" });
  const frozen = await db.freeze.findFirst({ where: { targetId: loser.metaId } });
  check(again.state === "pending_approval" && !!frozen, "4b. pause → resume → pause in 48 h: frozen and sent to the owner (loop guard)");

  const ks = await killSwitch("all", owner);
  const ksSet = ks.changeSetId ? await db.changeSet.findUniqueOrThrow({ where: { id: ks.changeSetId }, include: { items: true } }) : null;
  check(!!ksSet && ksSet.state === "executed" && ksSet.items.every((i) => i.op === "pause"), `3. the kill switch paused ${ks.objects} campaigns at once (state ${ksSet?.state})`);
  check((await db.auditLog.count({ where: { action: { startsWith: "change." } } })) > 0, "   …every step is in the audit log");

  await db.$disconnect();
})();
