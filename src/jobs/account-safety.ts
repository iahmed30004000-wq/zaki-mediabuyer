/**
 * account.safety (every hour after the sync) and attribution.health (M09, 8:00) — spec S10 / S11, T4.4 / T4.5.
 * Reads what meta.sync and oms.sync stored; never calls Meta itself and never appeals or edits anything by itself.
 */
import { db } from "@/server/db";
import { appealDraft, attributionHealth, judgeAccount } from "@/core/account-safety";
import { capiHealth } from "@/core/capi";

const HOUR = 3_600_000;

export async function checkAccounts(now = new Date()) {
  const stats = { accounts: 0, restricted: 0, frozen: 0, drafts: 0 };
  for (const a of await db.adAccount.findMany()) {
    stats.accounts++;
    const status = Number(a.status);
    const rejected24h = await db.reviewIssue.count({ where: { accountMetaId: a.metaId, createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } } });
    const v = judgeAccount({ accountStatus: Number.isFinite(status) ? status : 1, rejected24h, paymentOk: !a.paymentStatus || a.paymentStatus === "ok" });
    const last = await db.accountHealth.findFirst({ where: { accountMetaId: a.metaId }, orderBy: { createdAt: "desc" } });
    await db.accountHealth.create({ data: { accountMetaId: a.metaId, status: a.status, paymentOk: !a.paymentStatus || a.paymentStatus === "ok", rejectedAds: rejected24h, verdict: v.verdict, notes: v.notes } });
    if (v.downgrade) {
      stats.restricted++;
      if (last?.verdict !== "restricted") await db.alert.create({ data: { kind: "account_restricted", tone: "danger", text: `${a.name}: ${v.notes.join(" · ")}`, href: "/reports?tab=safety" } });
    }
    if (v.freezeCreate && !(await db.freeze.findFirst({ where: { targetId: a.metaId, kind: "create", liftedAt: null, until: { gt: now } } }))) {
      await db.freeze.create({ data: { scope: "account", targetId: a.metaId, kind: "create", reason: v.notes.join(" · "), until: new Date(now.getTime() + 24 * HOUR) } });
      await db.alert.create({ data: { kind: "rejections", tone: "warn", text: `${a.name}: ${v.notes.join(" · ")}`, href: "/reports?tab=safety" } });
      stats.frozen++;
    }
  }
  // an appeal draft for every new rejection — the ad's own text comes from the launch that made it
  for (const issue of await db.reviewIssue.findMany({ where: { status: "open", appealDraft: null } })) {
    const made = await db.changeItem.findFirst({ where: { op: "create", objectType: "creative", after: { path: ["name"], equals: issue.adName } }, select: { after: true } });
    const story = (made?.after as { payload?: { object_story_spec?: { video_data?: { message?: string } } } } | undefined)?.payload?.object_story_spec?.video_data;
    const d = appealDraft({ name: issue.adName, text: story?.message ?? null }, issue.feedback as Record<string, string>);
    await db.reviewIssue.update({ where: { id: issue.id }, data: { appealDraft: d.draft, policyKey: d.policyKey } });
    stats.drafts++;
  }
  return stats;
}

/** The level an account really runs at: a restricted account runs at 0 whatever was chosen (spec 10.1). */
export async function accountRestricted(accountMetaId: string): Promise<boolean> {
  const last = await db.accountHealth.findFirst({ where: { accountMetaId }, orderBy: { createdAt: "desc" } });
  return last?.verdict === "restricted";
}

/** M09 by code: the gap per campaign over the last 7 days, how orders reach their ad, and CAPI acceptance. */
export async function buildAttributionHealth(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 24 * HOUR);
  since.setUTCHours(0, 0, 0, 0);
  const insights = await db.insightDaily.findMany({ where: { level: "ad", date: { gte: since } }, select: { objectId: true, purchases: true } });
  const ads = await db.ad.findMany({ where: { metaId: { in: [...new Set(insights.map((i) => i.objectId))] } }, select: { metaId: true, adSet: { select: { campaign: { select: { metaId: true, name: true, parsedObjective: true } } } } } });
  const campaignOf = new Map(ads.map((a) => [a.metaId, a.adSet.campaign]));
  const purchases = new Map<string, { name: string; n: number }>();
  for (const i of insights) {
    const c = campaignOf.get(i.objectId);
    if (!c || c.parsedObjective === "MSG") continue; // messaging campaigns have no pixel purchase to compare
    const row = purchases.get(c.metaId) ?? { name: c.name, n: 0 };
    row.n += i.purchases;
    purchases.set(c.metaId, row);
  }
  const orders = await db.attributedOrder.findMany({ where: { createdAtOms: { gte: since }, isFake: false }, select: { campaignId: true, channel: true, method: true } });
  const web = new Map<string, number>();
  const byMethod: Record<string, number> = {};
  for (const o of orders) {
    byMethod[o.method] = (byMethod[o.method] ?? 0) + 1;
    if (o.channel === "website" && o.campaignId) web.set(o.campaignId, (web.get(o.campaignId) ?? 0) + 1);
  }
  const counts = Object.fromEntries((await db.capiEvent.groupBy({ by: ["state"], _count: true, where: { createdAt: { gte: since } } })).map((g) => [g.state, g._count]));
  const errors = (await db.capiEvent.findMany({ where: { state: { in: ["rejected", "skipped"] }, createdAt: { gte: since } }, select: { error: true }, take: 50 })).map((e) => e.error ?? "");
  return attributionHealth({
    campaigns: [...purchases.entries()].map(([id, p]) => ({ campaign: p.name, metaPurchases: p.n, webOrders: web.get(id) ?? 0 })),
    ordersByMethod: byMethod,
    capiAcceptedPct: capiHealth(counts).acceptedPct,
    capiErrors: errors.filter(Boolean),
  });
}

export async function storeAttributionHealth(now = new Date()) {
  const h = await buildAttributionHealth(now);
  const forDate = new Date(now);
  forDate.setUTCHours(0, 0, 0, 0);
  const text = JSON.stringify(h);
  await db.report.upsert({ where: { kind_forDate: { kind: "attribution", forDate } }, create: { kind: "attribution", forDate, text }, update: { text } });
  if (h.attribution_health === "broken") await db.alert.create({ data: { kind: "attribution", tone: "danger", text: `صحة الإسناد مكسورة: ${h.attributed_pct ?? "—"}% بس من الطلبات واصلة لإعلانها · CAPI ${h.capi_accepted_pct ?? "—"}% مقبول`, href: "/reports?tab=data" } });
  return { health: h.attribution_health, gaps: h.gaps.length };
}
