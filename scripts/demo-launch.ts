/**
 * The Phase 4 acceptance run (spec 14 T4.1 / T4.2), in dry-run, on the local database:
 *   1. a launch from the wizard becomes ONE change of kind test_campaign that waits for the owner, with its test;
 *   2. approved: campaign → ad sets → creatives → ads created PAUSED, every payload explicit, then switched on;
 *   3. the test starts counting days; «رجّع» pauses everything the launch made (nothing deleted);
 *   4. ad text with a forbidden claim, or a creative not on Meta yet, is refused before anything is proposed;
 *   5. a restricted account runs at level 0, and 3 rejections in 24 h freeze creation (with appeal drafts);
 *   6. the attribution health per campaign.
 * `npx tsx --env-file=.env scripts/demo-launch.ts`
 */
import { db } from "../src/server/db";
import { launch, prepareLaunch, type LaunchInput } from "../src/server/launch";
import { approve, propose, rollback } from "../src/server/changes";
import { buildAttributionHealth, checkAccounts } from "../src/jobs/account-safety";
import { CREATIVE_FEATURES_OFF } from "../src/core/templates";

const owner = { id: "demo-owner", role: "OWNER" as const, demo: true };
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  await db.experiment.deleteMany();
  await db.changeItem.deleteMany({ where: { changeSet: { kind: "test_campaign" } } });
  await db.changeSet.deleteMany({ where: { kind: "test_campaign" } });
  await db.freeze.deleteMany();
  await db.page.upsert({ where: { metaId: "PAGE_SP" }, create: { metaId: "PAGE_SP", name: "صحة بلس", code: "SP" }, update: { code: "SP" } });
  await db.dataset.upsert({ where: { metaId: "PX_DEMO" }, create: { metaId: "PX_DEMO", name: "بكسل تجريبي" }, update: {} });
  for (const [cr, concept, hook, angle] of [["CR09147", "CPT0012", "H07", "HER"], ["CR09152", "CPT0012", "H03", "ING"], ["CR09160", "CPT0015", "H01", "PRB"]] as const) {
    await db.creativeAsset.upsert({
      where: { crCode: cr },
      create: { crCode: cr, productCode: "TRF01", source: "manual", status: "uploaded", policyFlag: "green", metaVideoId: `dry_v_${cr}`, conceptId: concept, hookType: hook, angle },
      update: { status: "uploaded", policyFlag: "green", metaVideoId: `dry_v_${cr}`, conceptId: concept, hookType: hook, angle },
    });
  }
  const input: LaunchInput = {
    template: "CRT", productCode: "TRF01", market: "SY", accountMetaId: "act_1029", pageMetaId: "PAGE_SP", datasetMetaId: "PX_DEMO",
    landingUrl: "https://crm.zakiai.io/lp/kamaa", lpCode: "LP1", crCodes: ["CR09147", "CR09152", "CR09160"],
    message: "قطرة العين الطبيعية — اطلبها والدفع عند الاستلام", title: "اطلب هلأ",
  };

  const out = await launch(input, owner);
  check(out.changeSet.state === "pending_approval" && out.changeSet.kind === "test_campaign", `1. «${out.name}» waits for the owner (${out.changeSet.state}) · ${out.perDay}$/day`);
  const exp = await db.experiment.findUniqueOrThrow({ where: { id: out.experimentId } });
  check(exp.status === "planned" && !!exp.hypothesis, `   …with its test: «${exp.hypothesis}»`);

  const done = await approve(out.changeSet.id, owner);
  const items = await db.changeItem.findMany({ where: { changeSetId: out.changeSet.id }, orderBy: { seq: "asc" } });
  check(done.state === "executed", `2. approved → ${done.state} (${items.length} items, dry-run)`);
  const sent = items.map((i) => i.apiResponse as { wouldPost?: Record<string, any> });
  check(items.slice(0, 9).every((i) => i.op === "create") && sent.slice(0, 9).every((s) => s.wouldPost?.status === undefined || s.wouldPost.status === "PAUSED"), "   …everything created PAUSED, in order");
  const creative = sent.find((s, n) => items[n]!.objectType === "creative")!.wouldPost!;
  check(Object.keys(creative.degrees_of_freedom_spec.creative_features_spec).length === CREATIVE_FEATURES_OFF.length, `   …each creative opts out of all ${CREATIVE_FEATURES_OFF.length} enhancements by name`);
  const ad = items.find((i) => i.objectType === "ad" && i.op === "create")!;
  check(JSON.stringify(ad.apiResponse).includes("dry_adset1") && ad.objectId === "dry_ad_CR09147", "   …the ad points at the ad set and creative made just before it");
  check(items.slice(9).every((i) => i.op === "resume"), "   …and switched on last: ads → ad sets → campaign");

  const running = await db.experiment.findUniqueOrThrow({ where: { id: out.experimentId } });
  check(running.status === "running" && running.campaignMetaId === "dry_campaign" && !!running.endsAt, `3. the test is running until ${running.endsAt?.toISOString().slice(0, 10)}`);
  const back = await rollback(out.changeSet.id, owner);
  const backItems = await db.changeItem.findMany({ where: { changeSetId: back.id } });
  check(back.state === "executed" && backItems.every((i) => i.op === "pause") && backItems.length === 6, `   …«رجّع» paused the ${backItems.length} objects it switched on (creatives stay, nothing deleted)`);
  check((await db.experiment.findUniqueOrThrow({ where: { id: out.experimentId } })).status === "stopped", "   …and its test stopped with it");

  const bad = await prepareLaunch({ ...input, message: "بيشفي المي الزرقا نهائياً" });
  check(!bad.ok && bad.problems.some((p) => p.includes("ممنوع")), `4. forbidden claim refused: ${!bad.ok ? bad.problems.join(" · ") : ""}`);
  const notUp = await prepareLaunch({ ...input, crCodes: ["CR00001"] });
  check(!notUp.ok && notUp.problems.some((p) => p.includes("ما انرفع")), `   …a video not on Meta yet refused: ${!notUp.ok ? notUp.problems.join(" · ") : ""}`);

  // 5. account safety (T4.5): a restricted account runs at level 0; three rejections freeze creation
  await db.accountHealth.deleteMany();
  await db.reviewIssue.deleteMany();
  await db.adAccount.update({ where: { metaId: "act_2207" }, data: { status: "2" } });
  await checkAccounts();
  const pause = await propose({ source: "rule", sourceRef: "loser_no_orders", reasonCode: "S01", sentence: "خاسر", kind: "safety_pause", accountMetaId: "act_2207", items: [{ op: "pause", objectType: "ad", objectId: "AD_ON_RESTRICTED", before: { status: "ACTIVE" }, after: { status: "PAUSED" } }] }, { type: "rule", id: "loser_no_orders" });
  check(pause.state === "simulated", `5a. restricted account → level 0: even a safety pause is only suggested (${pause.state})`);
  await db.adAccount.update({ where: { metaId: "act_2207" }, data: { status: "1" } });
  for (const n of [1, 2, 3]) await db.reviewIssue.create({ data: { adMetaId: `REJ${n}`, adName: `CR0910${n}_H01_PRB_LP1`, accountMetaId: "act_1029", feedback: { Health: "Personal health" } } });
  const s = await checkAccounts();
  const drafts = await db.reviewIssue.count({ where: { appealDraft: { not: null } } });
  check(s.frozen === 1 && drafts === 3, `5b. 3 rejections in 24 h: creation frozen, ${drafts} appeal drafts written (sent by a person only)`);
  const frozen = await prepareLaunch(input);
  check(!frozen.ok && frozen.problems.some((p) => p.includes("مجمّد")), `   …and the next launch is refused: ${!frozen.ok ? frozen.problems[0] : ""}`);
  await db.freeze.deleteMany({ where: { kind: "create" } });
  await db.reviewIssue.deleteMany();
  await db.accountHealth.deleteMany();
  await db.changeSet.deleteMany({ where: { id: pause.id } });

  // 6. attribution health (M09 by code, T4.4)
  const h = await buildAttributionHealth();
  check(["good", "weak", "broken"].includes(h.attribution_health), `6. attribution: ${h.attribution_health} · ${h.attributed_pct}% tied by ad id · ${h.gaps.length} campaign gap(s)${h.gaps[0] ? ` — worst ${h.gaps[0].campaign} ${h.gaps[0].gap_pct}%` : ""}`);
  process.exit();
})();
