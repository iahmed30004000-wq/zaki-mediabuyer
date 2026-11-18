/**
 * THE FULL PATH (spec 17.4, first line) on the local database, dry-run, one creative from end to end:
 *   video in inbox → check and name → upload → campaign as a ChangeSet → approval → created PAUSED → verified →
 *   switched on → an OMS order with the ad's id → the truth → the rules → the morning report → a CAPI event.
 * Where Meta would answer (a video id, the objects' ids, the day's numbers), dry-run stands in exactly what the
 * sync would store — those stand-ins are said out loud below. `npx tsx --env-file=.env scripts/full-path.ts`
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../src/server/db";
import { processVideo } from "../src/jobs/creative-intake";
import { uploadVideo } from "../src/meta/video-upload";
import { launch } from "../src/server/launch";
import { approve } from "../src/server/changes";
import { toAttributedOrder, type OmsOrder } from "../src/adapters/oms";
import { computeTruthDays } from "../src/jobs/truth";
import { gatherDecisions } from "../src/jobs/rules-run";
import { gatherScale } from "../src/jobs/scale-run";
import { buildMorningReport } from "../src/jobs/morning-report";
import { enqueueCapi, sendCapi } from "../src/jobs/capi";
import { fakeFetch, FAKE_OMS_URL } from "../src/adapters/fixtures";
import { MetaClient } from "../src/meta/client";

const owner = { id: "demo-owner", role: "OWNER" as const, demo: true };
const DAY = 86_400_000;
const step = (n: number, ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${String(n).padStart(2, " ")}. ${label}`);
  if (!ok) {
    process.exitCode = 1;
    throw new Error(`step ${n} failed`);
  }
};

(async () => {
  const now = new Date();
  const dir = mkdtempSync(path.join(os.tmpdir(), "mb-path-"));
  const file = path.join(dir, "inbox.mp4");
  spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=25:duration=6", "-f", "lavfi", "-i", `sine=frequency=${300 + (now.getTime() % 400)}:duration=6`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);

  // a clean run: what earlier runs of this path left (their orders, their ads' days) would crowd the morning report
  const oldAds = [...new Set((await db.attributedOrder.findMany({ where: { omsOrderId: { startsWith: "PATH-" } }, select: { adId: true } })).map((o) => o.adId).filter((x): x is string => !!x))];
  await db.attributedOrder.deleteMany({ where: { omsOrderId: { startsWith: "PATH-" } } });
  await db.capiEvent.deleteMany({ where: { omsOrderId: { startsWith: "PATH-" } } });
  await db.truthDaily.deleteMany({ where: { level: "ad", objectId: { in: oldAds } } });
  await db.insightDaily.deleteMany({ where: { level: "ad", objectId: { in: oldAds } } });
  await db.ad.updateMany({ where: { metaId: { in: oldAds } }, data: { status: "PAUSED" } });

  // 1–2: the inbox: probe, MD5, number, name, policy, thumbnails
  const intake = await processVideo(file, { productCode: "TRF01", source: "drive", originalName: "كمأة من الدرايف.mp4", texts: { adText: "ماء الكمأة — اطلبه واستلمه وادفع عند الباب" }, tags: { conceptId: "CPT0077", hookType: "H07", angle: "HER" } });
  step(1, intake.status === "ready" && "crCode" in intake, `video in 01_inbox → ${intake.status} as ${"fileName" in intake ? intake.fileName : "?"}`);
  const cr = "crCode" in intake ? intake.crCode : "";
  const asset = await db.creativeAsset.findUniqueOrThrow({ where: { crCode: cr }, include: { thumbnails: true } });
  step(2, asset.policyFlag === "green" && asset.thumbnails.length === 6, `checked and named: policy ${asset.policyFlag}, ${asset.thumbnails.length} thumbnails`);

  // 3: the upload — dry-run sends nothing; Meta's video id is stood in
  const up = await uploadVideo({ token: "none" }, "dry_run", "act_1029", file, asset.fileName!);
  await db.creativeAsset.update({ where: { id: asset.id }, data: { metaVideoId: `dry_v_${cr}`, status: "uploaded", conceptId: "CPT0077", hookType: "H07", angle: "HER" } });
  step(3, up.status === "dry_run", `upload → ${up.status} (stand-in video id dry_v_${cr})`);

  // 4–7: the launch: one ChangeSet, approval, created PAUSED, verified, switched on
  await db.page.upsert({ where: { metaId: "PAGE_SP" }, create: { metaId: "PAGE_SP", name: "صحة بلس", code: "SP" }, update: { code: "SP" } });
  await db.dataset.upsert({ where: { metaId: "PX_DEMO" }, create: { metaId: "PX_DEMO", name: "بكسل تجريبي" }, update: {} });
  await db.freeze.updateMany({ where: { targetId: "act_1029", kind: "create", liftedAt: null }, data: { liftedAt: now } });
  const out = await launch({ template: "CRT", productCode: "TRF01", market: "SY", accountMetaId: "act_1029", pageMetaId: "PAGE_SP", datasetMetaId: "PX_DEMO", landingUrl: "https://crm.zakiai.io/lp/kamaa", lpCode: "LP1", crCodes: [cr], message: "ماء الكمأة — اطلبه وادفع عند الاستلام", title: "اطلب هلأ" }, owner);
  step(4, out.changeSet.state === "pending_approval", `campaign ${out.name} as one ChangeSet → waits for approval (+${out.perDay}$/day)`);
  const done = await approve(out.changeSet.id, owner);
  const items = await db.changeItem.findMany({ where: { changeSetId: out.changeSet.id }, orderBy: { seq: "asc" } });
  step(5, done.state === "executed", `approved on the site → ${done.state}`);
  step(6, items.filter((i) => i.op === "create").every((i) => (i.verifyResult as { verified?: boolean }).verified) && items.filter((i) => i.op === "create" && i.objectType !== "creative").every((i) => JSON.stringify(i.apiResponse).includes("PAUSED")), "created PAUSED and verified against the template");
  step(7, items.slice(-3).every((i) => i.op === "resume"), "switched on only after the check");

  // what meta.sync would store for the new objects (their ids are the dry-run stand-ins)
  const ids = Object.fromEntries(items.filter((i) => i.op === "create").map((i) => [(i.after as { ref: string }).ref, i.objectId]));
  const account = await db.adAccount.findUniqueOrThrow({ where: { metaId: "act_1029" } });
  const cmp = await db.campaign.upsert({ where: { metaId: ids.campaign! }, create: { metaId: ids.campaign!, accountId: account.id, name: out.name, status: "ACTIVE", productCode: "TRF01", namingOk: true }, update: { status: "ACTIVE", name: out.name } });
  const as = await db.adSet.upsert({ where: { metaId: ids.adset1! }, create: { metaId: ids.adset1!, campaignId: cmp.id, name: "BROAD_ADV_SP_CPT0077_v1", status: "ACTIVE", conceptId: "CPT0077", pageCode: "SP", dailyBudget: 15 }, update: { status: "ACTIVE" } });
  const adId = ids[`ad_${cr}`]!;
  const adName = `${cr}_H07_HER_LP1`;
  await db.ad.upsert({ where: { metaId: adId }, create: { metaId: adId, adSetId: as.id, name: adName, status: "ACTIVE", creativeCode: cr, hookCode: "H07", angleCode: "HER", lpCode: "LP1" }, update: { status: "ACTIVE" } });
  const yesterday = new Date(now);
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setTime(yesterday.getTime() - DAY);
  await db.insightDaily.upsert({
    where: { level_objectId_date: { level: "ad", objectId: adId, date: yesterday } },
    create: { level: "ad", objectId: adId, date: yesterday, spend: 14.8, impressions: 5200, reach: 4300, frequency: 1.2, linkClicks: 96, outboundClicks: 90, lpv: 70, purchases: 6, conversations: 0, video3s: 1800, thruplays: 500, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, attributionSetting: "7d_click" },
    update: { spend: 14.8 },
  });

  // 8: orders in the OMS carrying the ad's id (from the URL parameters)
  const created = new Date(yesterday.getTime() + 1 * 3_600_000);
  const omsOrders: OmsOrder[] = [0, 1, 2, 3, 4, 5].map((n) => ({
    order_id: `PATH-${cr}-${n}`, product_code: "TRF01", country: "SY", channel: "website", ad_id: adId, adset_id: ids.adset1!, campaign_id: ids.campaign!, ad_name: adName,
    landing_page: "https://crm.zakiai.io/lp/kamaa", status: n < 4 ? "confirmed" : "canceled", created_at: created.toISOString(),
    confirmed_at: n < 4 ? new Date(created.getTime() + 2 * 3_600_000).toISOString() : null, canceled_at: n < 4 ? null : new Date(created.getTime() + 3 * 3_600_000).toISOString(),
    order_value: "20.00", currency: "USD", is_fake: false, capi_ref: `enc:path${n}`,
  }));
  for (const o of omsOrders) {
    const row = toAttributedOrder(o, 24);
    await db.attributedOrder.upsert({ where: { omsOrderId: row.omsOrderId }, create: row, update: row });
  }
  step(8, (await db.attributedOrder.count({ where: { adId, method: "ad_id" } })) === 6, `6 OMS orders tied to ${adName} by its ad id`);

  // 9: the truth
  await computeTruthDays(yesterday, new Date(yesterday.getTime() + DAY), now);
  const truth = await db.truthDaily.findUnique({ where: { level_objectId_date: { level: "ad", objectId: adId, date: yesterday } } });
  step(9, truth?.confirmed === 4 && Number(truth.costPerConfirmed) > 0, `the truth: ${truth?.confirmed} confirmed, ${Number(truth?.costPerConfirmed).toFixed(2)}$ per confirmed (spend × 1.01 ÷ mature confirmed)`);

  // 10: the rules see it (a new batch, under the ceiling: no pause) and the ladder explains it
  const decisions = await gatherDecisions(now);
  const ladder = (await gatherScale(now)).find((r) => r.adSetId === ids.adset1);
  step(10, !decisions.some((d) => d.d.targetId === adId && d.d.action === "pause") && !!ladder, `the rules: not a loser · the ladder: ${ladder?.decision.raise ? "ready" : ladder?.decision.blockers[0]}`);

  // 11: the morning report names it among the best
  const report = await buildMorningReport(yesterday);
  step(11, report.includes(cr), `the morning report lists ${cr} among the best ads`);

  // 12: the conversion event back to Meta
  await enqueueCapi(now);
  const f = fakeFetch(now);
  await sendCapi({ meta: new MetaClient({ token: "demo", fetch: f, sleep: async () => {} }), oms: { baseUrl: FAKE_OMS_URL, token: "demo", fetch: f }, datasetId: "PX_DEMO", now });
  const ev = await db.capiEvent.findUnique({ where: { eventId: `oms-PATH-${cr}-0-confirmed` } });
  step(12, ev?.state === "sent" && ev.eventName === "Purchase", `CAPI: Purchase for order PATH-${cr}-0 → ${ev?.state} (against the pretend Meta)`);
  console.log("\nthe full path held, end to end.");
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
