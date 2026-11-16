/**
 * WHERE CLAUDE'S PUSHES LAND (v4 · A). The numbers go into the very tables the Meta and OMS jobs fill — structure
 * (Campaign · AdSet · Ad), the daily archive (InsightDaily), and the orders (AttributedOrder) — so every screen, rule,
 * report and ladder reads them exactly as if the APIs had brought them. Idempotent end to end: the same push twice
 * changes nothing; a later push for the same object and day replaces it; a real source (the Meta sync, the OMS sync)
 * writes the same keys later and wins.
 *
 * The orders are the one place that needed care. A tally («4 real orders, 3 confirmed, 1 delivered») becomes 4 plain
 * order rows with a stable id (`mcp:ad:<id>:<day>:<n>`) and method «mcp»: every consumer counts them like OMS orders,
 * CAPI never sends them (it skips method «mcp»), and the moment the OMS is linked they step aside (the OMS sync removes
 * the pushed rows of the window it reads, and pushing a tally while the OMS is linked is refused with a word).
 */
import type { Prisma } from "@prisma/client";
import { parseAdName, parseAdSetName, parseCampaignName, productFromLegacyName, type ProductAlias } from "@/core/naming";
import { PUSH_LEVELS, StockRow, VideoRow, checkRows, insightPatch, normalizeStatus, parseStart, planOrders, productDayPatch, pushedOrderId, type MetricRowT, type ProductDayPatch, type PushLevel, type RowProblem } from "@/core/push-rows";
import { stockAlertKey, stockAlertText, stockUrgency } from "@/core/stock-alerts";
import { readRules } from "@/core/rules-v2";
import { db } from "./db";
import { directoryKeys } from "./directory";
import { audit, type Actor } from "./audit";
import { omsLinked } from "./env";
import { createNotification } from "./notify";
import { getSetting } from "./settings";

const DAY = 86_400_000;
const RANK: Record<PushLevel, number> = { account: 0, campaign: 1, adset: 2, ad: 3, product: 4, person: 5 };

export interface PushReport {
  received: number;
  applied: number;
  structure: number;
  insights: number;
  orderRows: number;
  tallies: number;
  /** product-days written (v4.1) */
  productDays: number;
  /** team members' days written (v5 · P9) */
  personDays: number;
  rejected: RowProblem[];
  warnings: string[];
}

async function upsertAccount(metaId: string, name?: string) {
  // an account that arrives by a push starts as an advisor (level 0): it suggests, it does not act
  return db.adAccount.upsert({
    where: { metaId },
    update: name ? { name } : {},
    create: { metaId, name: name ?? metaId, currency: "USD", timezone: "Asia/Amman", status: "1", autonomyLevel: 0 },
  });
}

async function accountFor(explicit?: string, fallback?: string) {
  const id = explicit ?? fallback;
  if (id) return upsertAccount(id);
  return (await db.adAccount.findFirst({ orderBy: { createdAt: "asc" } })) ?? upsertAccount("act_claude", "الحساب (من Claude)");
}

async function productAliases(): Promise<ProductAlias[]> {
  const [rows, products] = await Promise.all([db.productAlias.findMany(), db.productEconomics.findMany()]);
  return products.map((p) => ({ code: p.productCode, name: p.name, aliases: rows.filter((r) => r.productCode === p.productCode).map((r) => r.alias) }));
}

/** Pushes rows of numbers (any mix of levels, days and fields). Returns what was applied and what was refused, and why. */
export async function applyMetrics(raw: unknown[], opts: { actor: Actor; source: "mcp" | "manual"; accountId?: string; now?: Date }): Promise<PushReport> {
  const now = opts.now ?? new Date();
  const { rows, problems } = checkRows(raw, await directoryKeys());
  const report: PushReport = { received: raw.length, applied: 0, structure: 0, insights: 0, orderRows: 0, tallies: 0, productDays: 0, personDays: 0, rejected: problems, warnings: [] };
  const warn = (w: string) => !report.warnings.includes(w) && report.warnings.push(w);

  const [aliases, econ, window, confirmH] = await Promise.all([
    productAliases(),
    db.productEconomics.findMany().then((l) => new Map(l.map((p) => [p.productCode, p]))),
    getSetting("attribution.window"),
    getSetting("truth.confirm_window_h"),
  ]);
  const oms = omsLinked();
  // parents before children, so a campaign and its ads can arrive in one call
  const ordered = [...rows].sort((a, b) => RANK[a.row.level] - RANK[b.row.level]);

  for (const { index, row } of ordered) {
    try {
      if (row.level === "person") {
        await upsertPersonDay(row, opts.source);
        report.personDays++;
        report.applied++;
        continue;
      }
      if (await structureOf(row, opts.accountId, aliases)) report.structure++;
      const patch = row.level === "product" ? null : insightPatch(row);
      if (patch) {
        const key = { level: row.level, objectId: row.id, date: new Date(`${row.date}T00:00:00Z`) };
        const zero = { spend: 0, impressions: 0, reach: 0, frequency: 0, linkClicks: 0, outboundClicks: 0, lpv: 0, purchases: 0, conversations: 0, video3s: 0, thruplays: 0, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0 };
        await db.insightDaily.upsert({
          where: { level_objectId_date: key },
          create: { ...key, ...zero, ...patch, attributionSetting: String(window), source: opts.source },
          update: { ...patch, source: opts.source },
        });
        report.insights++;
      }
      // a product's whole day (v4.1): the numbers of the «الأرقام» view. Its orders are ALL the product's real orders
      // — not made into order rows, those stand for the orders tied to an ad (ad level) and would be counted twice
      const day = productDayPatch(row);
      if (day) {
        await upsertProductDay(row.id, row.date, day, opts.source);
        report.productDays++;
      }
      if (row.real_orders !== undefined && row.level !== "product") {
        if (oms) warn("الـ OMS مربوط — طلباته هي المصدر، فتجاهلنا أعداد الطلبات المبعوتة");
        else {
          report.orderRows += await replaceTally(row, now, econ, Number(confirmH));
          report.tallies++;
        }
      }
      report.applied++;
    } catch (e) {
      console.error("push row failed:", e instanceof Error ? e.message : e);
      problems.push({ index, error: e instanceof ParentMissing ? e.message : "ما انحفظ هالصف — جرّب كمان مرة" });
    }
  }
  await audit(opts.actor, `${opts.source}.push_metrics`, { type: "push", id: now.toISOString() }, { after: { received: report.received, applied: report.applied, rejected: problems.length, tallies: report.tallies } });
  return report;
}

class ParentMissing extends Error {}

/** One team member's day. What the push did not say stays as it was. Employees only: there is no customer column on this table. */
async function upsertPersonDay(row: MetricRowT, source: string): Promise<void> {
  const data = {
    ...(row.claims !== undefined ? { claims: row.claims } : {}),
    ...(row.confirmed !== undefined ? { confirmed: row.confirmed } : {}),
    ...(row.rejected !== undefined ? { rejected: row.rejected } : {}),
    ...(row.no_answer !== undefined ? { noAnswer: row.no_answer } : {}),
    ...(row.no_answer_fast !== undefined ? { noAnswerFast: row.no_answer_fast } : {}),
    ...(row.first_claim_sec !== undefined ? { firstClaimSec: row.first_claim_sec } : {}),
    ...(row.stuck_48h !== undefined ? { stuck48h: row.stuck_48h } : {}),
    ...(row.reactivated !== undefined ? { reactivated: row.reactivated } : {}),
    ...(row.delivered !== undefined ? { delivered: row.delivered } : {}),
    ...(row.reject_reasons !== undefined ? { rejectReasons: row.reject_reasons as Prisma.InputJsonValue } : {}),
    source,
  };
  const key = { actorKey: row.id, date: new Date(`${row.date}T00:00:00Z`) };
  await db.personDay.upsert({ where: { actorKey_date: key }, create: { ...key, ...data }, update: data });
}

/** Writes (or fills in) one product's day. What the push did not say stays as it was. */
async function upsertProductDay(productCode: string, date: string, p: ProductDayPatch, source: string): Promise<void> {
  const data = { ...p, rejectReasons: p.rejectReasons as Prisma.InputJsonValue | undefined, offerBreakdown: p.offerBreakdown as Prisma.InputJsonValue | undefined, source };
  const key = { productCode, date: new Date(`${date}T00:00:00Z`) };
  await db.productDay.upsert({ where: { productCode_date: key }, create: { ...key, ...data }, update: data });
}

/** Upserts Campaign / AdSet / Ad (or the account) from a row. True when it touched the structure. */
async function structureOf(row: MetricRowT, defaultAccount: string | undefined, aliases: ProductAlias[]): Promise<boolean> {
  const status = normalizeStatus(row.status);
  const start = parseStart(row.start_time);
  const budget = row.budget_daily;
  const carries = row.name !== undefined || status !== undefined || budget !== undefined || start !== null || row.product !== undefined || row.parent_id !== undefined;

  if (row.level === "account") {
    if (row.name || !(await db.adAccount.findUnique({ where: { metaId: row.id } }))) await upsertAccount(row.id, row.name);
    return false;
  }
  if (row.level === "product") return false;

  if (row.level === "campaign") {
    const existing = await db.campaign.findUnique({ where: { metaId: row.id } });
    if (existing && !carries) return false;
    const parentIsAccount = row.parent_id?.startsWith("act_") ? row.parent_id : undefined;
    const account = existing && !row.account_id && !parentIsAccount ? null : await accountFor(row.account_id ?? parentIsAccount, defaultAccount);
    const name = row.name ?? existing?.name ?? row.id;
    const named = row.name !== undefined;
    const parsed = named ? parseCampaignName(name) : null;
    const legacy = named && !parsed ? productFromLegacyName(name, aliases) : null;
    const data = {
      ...(account ? { accountId: account.id } : {}),
      ...(named ? { name, parsedMarket: parsed?.market ?? null, parsedObjective: parsed?.objective ?? null, stage: parsed?.stage ?? null, namingOk: !!parsed, productVia: parsed ? "name" : legacy ? "alias" : "none" } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(budget !== undefined ? { dailyBudget: budget, budgetType: budget > 0 ? "CBO" : null } : {}),
      ...(start ? { startTime: start } : {}),
      ...(row.product ? { productCode: row.product } : named ? { productCode: parsed?.productCode ?? legacy?.code ?? existing?.productCode ?? null } : {}),
    };
    if (existing) await db.campaign.update({ where: { metaId: row.id }, data });
    else {
      const acct = account ?? (await accountFor(undefined, defaultAccount));
      await db.campaign.create({ data: { metaId: row.id, accountId: acct.id, name, status: status ?? "ACTIVE", ...data } });
    }
    return true;
  }

  if (row.level === "adset") {
    const existing = await db.adSet.findUnique({ where: { metaId: row.id } });
    if (existing && !carries) return false;
    const parent = row.parent_id ? await db.campaign.findUnique({ where: { metaId: row.parent_id } }) : null;
    if (!existing && !parent) throw new ParentMissing(`parent_id: الحملة ${row.parent_id ?? "(مش مكتوبة)"} مش معروفة — ابعتها أول`);
    const name = row.name ?? existing?.name ?? row.id;
    const p = row.name !== undefined ? parseAdSetName(name) : null;
    const data = {
      ...(parent ? { campaignId: parent.id } : {}),
      ...(row.name !== undefined ? { name, audienceCode: p?.audience ?? null, pageCode: p?.pageCode ?? null, conceptId: p?.conceptId ?? null } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(budget !== undefined ? { dailyBudget: budget } : {}),
      ...(start ? { startTime: start } : {}),
    };
    if (existing) await db.adSet.update({ where: { metaId: row.id }, data });
    else await db.adSet.create({ data: { metaId: row.id, campaignId: parent!.id, name, status: status ?? "ACTIVE", ...data } });
    return true;
  }

  const existing = await db.ad.findUnique({ where: { metaId: row.id } });
  if (existing && !carries) return false;
  const parent = row.parent_id ? await db.adSet.findUnique({ where: { metaId: row.parent_id } }) : null;
  if (!existing && !parent) throw new ParentMissing(`parent_id: المجموعة ${row.parent_id ?? "(مش مكتوبة)"} مش معروفة — ابعتها أول`);
  const name = row.name ?? existing?.name ?? row.id;
  const p = row.name !== undefined ? parseAdName(name) : null;
  const data = {
    ...(parent ? { adSetId: parent.id } : {}),
    ...(row.name !== undefined ? { name, creativeCode: p?.creativeCode ?? null, hookCode: p?.hookCode ?? null, angleCode: p?.angleCode ?? null, lpCode: p?.lpCode ?? null } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(start ? { startTime: start } : {}),
  };
  if (existing) await db.ad.update({ where: { metaId: row.id }, data });
  else await db.ad.create({ data: { metaId: row.id, adSetId: parent!.id, name, status: status ?? "ACTIVE", ...data } });
  return true;
}

/** Replaces the pushed order rows of one object and day with the tally; returns how many rows it now has. */
async function replaceTally(row: MetricRowT, now: Date, econ: Map<string, { price: Prisma.Decimal; market: string }>, confirmWindowH: number): Promise<number> {
  const dayStart = new Date(`${row.date}T00:00:00Z`).getTime();
  const dayIsOver = dayStart + DAY <= now.getTime();
  const plan = planOrders({ orders: row.real_orders ?? 0, confirmed: row.confirmed, mature: row.mature_orders, shipped: row.shipped, delivered: row.delivered, returned: row.returned, collected: row.collected }, dayIsOver);

  let productCode = row.level === "product" ? row.id : (row.product ?? null);
  let market: string | null = null;
  let adId: string | null = null;
  let adSetId: string | null = null;
  let campaignId: string | null = null;
  let adName: string | null = null;
  if (row.level === "ad") {
    const ad = await db.ad.findUnique({ where: { metaId: row.id }, include: { adSet: { include: { campaign: { include: { account: true } } } } } });
    if (ad) {
      adId = ad.metaId;
      adSetId = ad.adSet.metaId;
      campaignId = ad.adSet.campaign.metaId;
      adName = ad.name;
      productCode = productCode ?? ad.adSet.campaign.productCode;
      market = ad.adSet.campaign.account.market ?? null;
    } else adId = row.id; // an ad we have no structure for yet: the orders still count against its id
  }
  const code = productCode ?? "UNKNOWN";
  const e = econ.get(code);
  market = e?.market ?? market ?? "SY";
  const value = e ? Number(e.price) : 0;

  const prefix = `mcp:${row.level}:${row.id}:${row.date}:`;
  const wanted = new Set(plan.map((p) => pushedOrderId(row.level, row.id, row.date, p.index)));
  const existing = await db.attributedOrder.findMany({ where: { omsOrderId: { startsWith: prefix } }, select: { omsOrderId: true } });
  const stale = existing.map((x) => x.omsOrderId).filter((id) => !wanted.has(id));

  const noon = dayStart + 12 * 3_600_000;
  const at = (index: number) => new Date(Math.min(noon + index * 1000, now.getTime() - 60_000));
  const ops = plan.map((p) => {
    const created = at(p.index);
    const hour = (h: number) => new Date(created.getTime() + h * 3_600_000);
    const data = {
      productCode: code,
      market: market!,
      channel: row.channel ?? "website",
      adId,
      adSetId,
      campaignId,
      adName,
      method: "mcp",
      status: p.status,
      createdAtOms: created,
      confirmedAt: p.status === "new" ? null : hour(1),
      shippedAt: p.status === "shipped" || p.status === "delivered" || p.status === "returned" ? hour(24) : null,
      deliveredAt: p.status === "delivered" ? hour(72) : null,
      returnedAt: p.status === "returned" ? hour(96) : null,
      orderValue: value,
      collected: p.collected,
      currency: "USD",
      isFake: false,
      matureAt: p.mature ? created : hour(confirmWindowH),
    };
    const omsOrderId = pushedOrderId(row.level, row.id, row.date, p.index);
    return db.attributedOrder.upsert({ where: { omsOrderId }, create: { omsOrderId, ...data }, update: data });
  });
  await db.$transaction([...ops, ...(stale.length ? [db.attributedOrder.deleteMany({ where: { omsOrderId: { in: stale } } })] : [])]);
  return plan.length;
}

// ───────────────────────────── stock ─────────────────────────────

export interface StockReport {
  applied: number;
  alerts: number;
  rejected: RowProblem[];
}

export async function applyStock(raw: unknown[], opts: { actor: Actor; source: "mcp" | "manual"; now?: Date }): Promise<StockReport> {
  const now = opts.now ?? new Date();
  const rejected: RowProblem[] = [];
  const rules = readRules(await getSetting("campaign.rules"));
  const dayKey = now.toISOString().slice(0, 10);
  let applied = 0;
  let alerts = 0;
  for (const [index, r] of raw.entries()) {
    const p = StockRow.safeParse(r);
    if (!p.success) {
      rejected.push({ index, error: p.error.issues.map((i) => `${i.path.join(".") || "الصف"}: ${i.message}`).join(" · ").slice(0, 300) });
      continue;
    }
    const at = p.data.as_of ? new Date(p.data.as_of) : now;
    if (Number.isNaN(at.getTime())) {
      rejected.push({ index, error: "as_of: وقت مش صحيح" });
      continue;
    }
    await db.stockSnapshot.create({ data: { productCode: p.data.product, units: p.data.units ?? null, daysCover: p.data.days_cover, source: opts.source, at } });
    // the product's own row keeps the whole days of cover the rules read (a product that is not there is never created)
    await db.productEconomics.updateMany({ where: { productCode: p.data.product }, data: { stockDays: Math.round(p.data.days_cover) } });
    applied++;
    const urgency = stockUrgency(p.data.days_cover, rules.stock);
    if (urgency) {
      const text = stockAlertText(p.data.product, p.data.days_cover, urgency, p.data.units);
      for (const audience of rules.stock.audience) {
        const n = await createNotification({ urgency, audience, title: text.title, body: text.body, href: "/products/" + encodeURIComponent(p.data.product), source: "stock", key: stockAlertKey(p.data.product, urgency, dayKey) });
        if (n.created) alerts++;
      }
    }
  }
  await audit(opts.actor, `${opts.source}.push_stock`, { type: "push", id: now.toISOString() }, { after: { applied, rejected: rejected.length, alerts } });
  return { applied, alerts, rejected };
}

// ───────────────────────────── the video bank ─────────────────────────────

export interface VideosReport {
  applied: number;
  rejected: RowProblem[];
}

export async function applyVideos(raw: unknown[], opts: { actor: Actor; source: "mcp" | "manual"; now?: Date }): Promise<VideosReport> {
  const rejected: RowProblem[] = [];
  let applied = 0;
  for (const [index, r] of raw.entries()) {
    const p = VideoRow.safeParse(r);
    if (!p.success) {
      rejected.push({ index, error: p.error.issues.map((i) => `${i.path.join(".") || "الصف"}: ${i.message}`).join(" · ").slice(0, 300) });
      continue;
    }
    const v = p.data;
    const data = {
      productCode: v.product,
      ...(v.drive_file_id ? { driveFileId: v.drive_file_id } : {}),
      ...(v.scenario_file_id ? { scenarioFileId: v.scenario_file_id } : {}),
      ...(v.meta_video_id ? { metaVideoId: v.meta_video_id } : {}),
      ...(v.status ? { status: v.status } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
      source: opts.source,
    };
    await db.videoBankItem.upsert({ where: { job_vName: { job: v.job, vName: v.v_name } }, create: { job: v.job, vName: v.v_name, ...data }, update: data });
    applied++;
  }
  await audit(opts.actor, `${opts.source}.push_videos`, { type: "push", id: (opts.now ?? new Date()).toISOString() }, { after: { applied, rejected: rejected.length } });
  return { applied, rejected };
}

export { PUSH_LEVELS };
