/**
 * Creative fatigue and the studio's queue (spec 6.5, contract §4.2 #6–7), on the local database:
 *   an ad strong in its first days and tired in its last → marked «متعب», NOT paused, and 4 new hooks requested;
 *   the studio (with its own tokens) reads the queue, claims the request, hands back a result; a second claim fails.
 * `npx tsx --env-file=.env scripts/demo-fatigue.ts`
 */
import { db } from "../src/server/db";
import { runFatigue } from "../src/jobs/fatigue";
import { hashToken, newToken } from "../src/server/api-token";
import { GET as readQueue } from "../src/app/api/vidpattern/queue/route";
import { POST as claim } from "../src/app/api/vidpattern/queue/[id]/claim/route";
import { POST as result } from "../src/app/api/vidpattern/queue/[id]/result/route";

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
  const cmp = await db.campaign.upsert({ where: { metaId: "FAT_C" }, create: { metaId: "FAT_C", accountId: account.id, name: "SY_TRF01_WEB_SCALE_261010_C03", status: "ACTIVE", productCode: "TRF01", namingOk: true }, update: { status: "ACTIVE" } });
  const as = await db.adSet.upsert({ where: { metaId: "FAT_AS" }, create: { metaId: "FAT_AS", campaignId: cmp.id, name: "BROAD_ADV_SP_CPT0050_v1", status: "ACTIVE", conceptId: "CPT0050", pageCode: "SP", dailyBudget: 40 }, update: { status: "ACTIVE" } });
  await db.ad.upsert({ where: { metaId: "FAT_AD" }, create: { metaId: "FAT_AD", adSetId: as.id, name: "CR09500_H07_HER_LP1", status: "ACTIVE", creativeCode: "CR09500", hookCode: "H07", angleCode: "HER", lpCode: "LP1" }, update: { status: "ACTIVE" } });
  await db.creativeAsset.upsert({ where: { crCode: "CR09500" }, create: { crCode: "CR09500", productCode: "TRF01", source: "studio", sourceRef: "VP-TRF01-0050-v1", status: "uploaded", policyFlag: "green", hookType: "H07", angle: "HER" }, update: { status: "uploaded", notes: null } });
  await db.creativeRequest.deleteMany({ where: { crCode: "CR09500" } });
  await db.attributedOrder.deleteMany({ where: { omsOrderId: { startsWith: "FAT-" } } });

  // 9 days: the first 4 fresh (CTR 2%, hook 35%, an order per 3$), the last 5 tired (CTR 1.3%, the same people again, 4.5$)
  for (let d = 9; d >= 1; d--) {
    const date = new Date(today.getTime() - d * DAY);
    const tired = d <= 5;
    const imp = 10000;
    const reach = tired ? 1500 : 8500;
    const spend = tired ? 40 : 30;
    const orders = tired ? 9 : 10;
    await db.insightDaily.upsert({
      where: { level_objectId_date: { level: "ad", objectId: "FAT_AD", date } },
      create: { level: "ad", objectId: "FAT_AD", date, spend, impressions: imp, reach, frequency: imp / reach, linkClicks: tired ? 130 : 200, outboundClicks: 120, lpv: 100, purchases: orders, conversations: 0, video3s: tired ? 3300 : 3500, thruplays: 900, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, attributionSetting: "7d_click" },
      update: { spend, impressions: imp, reach, linkClicks: tired ? 130 : 200, video3s: tired ? 3300 : 3500 },
    });
    for (let n = 0; n < orders; n++) {
      const at = new Date(date.getTime() + (2 + n) * 3_600_000);
      await db.attributedOrder.create({ data: { omsOrderId: `FAT-${d}-${n}`, productCode: "TRF01", market: "SY", channel: "website", adId: "FAT_AD", method: "ad_id", status: "confirmed", createdAtOms: at, confirmedAt: at, orderValue: 20, currency: "USD", matureAt: at } });
    }
  }

  const s = await runFatigue(now);
  const asset = await db.creativeAsset.findUniqueOrThrow({ where: { crCode: "CR09500" } });
  const ad = await db.ad.findUniqueOrThrow({ where: { metaId: "FAT_AD" } });
  check(asset.status === "fatigued" && ad.status === "ACTIVE", `1. tired winner → «متعب» and still running: ${asset.notes}`);
  const req = await db.creativeRequest.findFirst({ where: { crCode: "CR09500" } });
  check(req?.kind === "new_hooks" && req.vpId === "VP-TRF01-0050-v1" && req.count === 4, `2. queued for the studio: ${req?.count} new hooks on ${req?.vpId} (${s.requests} request)`);
  await runFatigue(now);
  check((await db.creativeRequest.count({ where: { crCode: "CR09500" } })) === 1, "   …a second run asks nothing more while one is open");

  // the studio's side, with its own tokens
  const read = newToken();
  const launch = newToken();
  const tRead = await db.apiToken.create({ data: { name: "demo read", scopes: ["vp:read"], tokenHash: hashToken(read), prefix: read.slice(0, 10) } });
  const tLaunch = await db.apiToken.create({ data: { name: "demo launch", scopes: ["vp:launch"], tokenHash: hashToken(launch), prefix: launch.slice(0, 10) } });
  try {
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    const q = await (await readQueue(new Request("http://x/api/vidpattern/queue?status=pending", { headers: auth(read) }))).json();
    const mine = q.items.find((i: { id: string }) => i.id === req!.id);
    check(!!mine && Array.isArray(mine.brief.forbidden), `3. the studio reads it (vp:read): ${mine?.kind} · ${mine?.brief.why}`);
    const noScope = await claim(new Request("http://x", { method: "POST", headers: auth(read) }), { params: { id: req!.id } });
    check(noScope.status === 403, "   …a read token cannot claim (403)");
    const c1 = await claim(new Request("http://x", { method: "POST", headers: auth(launch) }), { params: { id: req!.id } });
    const c2 = await claim(new Request("http://x", { method: "POST", headers: auth(launch) }), { params: { id: req!.id } });
    check(c1.status === 200 && c2.status === 409, `4. claimed for 2 hours (${c1.status}); a second claim is refused (${c2.status})`);
    const r = await result(new Request("http://x", { method: "POST", headers: { ...auth(launch), "content-type": "application/json" }, body: JSON.stringify({ result: { vp_ids: ["VP-TRF01-0050-v1-h2", "VP-TRF01-0050-v1-h3"] } }) }), { params: { id: req!.id } });
    check(r.status === 200 && (await db.creativeRequest.findUniqueOrThrow({ where: { id: req!.id } })).status === "done", "5. the result handed back → done, and the owner is told");
  } finally {
    await db.apiToken.deleteMany({ where: { id: { in: [tRead.id, tLaunch.id] } } });
  }
  process.exit();
})();
