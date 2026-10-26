/**
 * creatives.fatigue (spec 6.5, daily 07:30) — every active ad that has run ≥ 7 days is measured against its own
 * first 3 days; a tired winner is marked «متعب» (never paused) and a request for new hooks on the same body goes
 * into the studio's queue (CreativeRequest), once per creative while one is still open.
 */
import { db } from "@/server/db";
import { judgeFatigue, type FatigueWindow } from "@/core/fatigue";
import { RULES } from "@/core/policy";

const DAY = 86_400_000;

export async function runFatigue(now = new Date()) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const ads = await db.ad.findMany({ where: { status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] }, creativeCode: { not: null } }, include: { adSet: { include: { campaign: { include: { account: true } } } } } });
  const stats = { ads: ads.length, measured: 0, watch: 0, tired: 0, requests: 0 };
  for (const ad of ads) {
    const rows = await db.insightDaily.findMany({ where: { level: "ad", objectId: ad.metaId, date: { lt: today } }, orderBy: { date: "asc" } });
    if (rows.length < 7) continue;
    stats.measured++;
    const orders = await db.attributedOrder.findMany({ where: { adId: ad.metaId, isFake: false }, select: { createdAtOms: true } });
    const win = (list: typeof rows): FatigueWindow => {
      const from = list[0]!.date.getTime();
      const to = list[list.length - 1]!.date.getTime() + DAY;
      return {
        impressions: list.reduce((n, r) => n + r.impressions, 0),
        reach: list.reduce((n, r) => n + r.reach, 0),
        clicks: list.reduce((n, r) => n + r.linkClicks, 0),
        hooks: list.reduce((n, r) => n + r.video3s, 0),
        spend: list.reduce((n, r) => n + Number(r.spend), 0),
        orders: orders.filter((o) => o.createdAtOms.getTime() >= from && o.createdAtOms.getTime() < to).length,
      };
    };
    const v = judgeFatigue(win(rows.slice(0, 3)), win(rows.slice(-3)), win(rows.slice(-7)), ad.adSet.campaign.account.market ?? "SY");
    if (v.state === "watch") stats.watch++;
    if (v.state !== "tired") continue;
    stats.tired++;

    const asset = await db.creativeAsset.findUnique({ where: { crCode: ad.creativeCode! } });
    if (asset && asset.status !== "fatigued") await db.creativeAsset.update({ where: { id: asset.id }, data: { status: "fatigued", notes: `${asset.notes ? `${asset.notes} · ` : ""}متعب: ${v.reasons.join(" · ")}` } });
    const open = await db.creativeRequest.findFirst({ where: { crCode: ad.creativeCode!, status: { in: ["pending", "claimed"] } } });
    if (open) continue;
    const product = ad.adSet.campaign.productCode ?? asset?.productCode ?? "";
    await db.creativeRequest.create({
      data: {
        kind: asset?.sourceRef ? "new_hooks" : "new_script",
        productCode: product,
        vpId: asset?.sourceRef ?? null,
        crCode: ad.creativeCode,
        count: 4,
        brief: {
          why: `${ad.creativeCode} رابح بس تعب: ${v.reasons.join(" · ")}`,
          keep: { angle: ad.angleCode, hook_type: asset?.hookType ?? ad.hookCode, concept: ad.adSet.conceptId, dialect: asset?.dialect ?? null },
          first_frame: "إطار أول مختلف عن الأصلي، بلا كتابة كبيرة",
          // the words the dictionary refuses, so the studio never writes them
          forbidden: RULES.filter((r) => r.level === "red").map((r) => ({ rule: r.rule, instead: r.alternative ?? null })),
        },
      },
    });
    await db.alert.create({ data: { kind: "creative.fatigue", tone: "warn", text: `${ad.creativeCode} تعب (${v.reasons.join(" · ")}) — ما وقف، وطلبت 4 هوكات جديدة على نفس الجسم من الاستديو`, href: "/creatives" } });
    stats.requests++;
  }
  return stats;
}
