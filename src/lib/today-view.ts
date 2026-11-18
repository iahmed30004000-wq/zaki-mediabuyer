/**
 * «اليوم» as the home screen reads it (v3 · B): the four numbers (today · yesterday · the 7-day average), the alerts that
 * must not be missed, what is stalled, today's tasks and the morning card — all from the database (MOCK_MODE=0), or one
 * clearly demo set. Never a mix: a screen is real or it is demo.
 *
 * Days are the business days of Amman: an order belongs to the Amman date it was made on (one at 01:30 Amman is today's, not
 * yesterday's as the UTC clock would say), and a spend row to its own date (InsightDaily keeps the plain date). Spend is the best level there is for that day: the account's own
 * total if it was pushed, else the ads, else the ad sets, else the campaigns — so a partial push still adds up.
 */
import { ammanKey, keyMs } from "@/core/dates";
import { dayBounds } from "@/core/day";
import { lastNight } from "@/core/mode";
import { readRules, type CampaignRules } from "@/core/rules-v2";
import { averageDays, buildAlerts, costPerOrder, isTestStage, testShare, type DayNumbers, type TodayAlert } from "@/core/today";
import { targetsOf } from "@/lib/mock/data";
import { toProduct } from "@/lib/source";
import { db } from "@/server/db";
import { listApprovals, type ApprovalView } from "@/server/approvals";
import { currentMode, readMode } from "@/server/mode";
import { getSetting } from "@/server/settings";
import { listTasks, type TaskView } from "@/server/tasks";
import { forViewer } from "@/server/redact";

const DAY = 86_400_000;
/** The Amman day of an instant, as the UTC midnight of its date (the same number a spend row's date has). */
const ammanDay = (d: Date) => keyMs(ammanKey(d));
const LEVELS_BY_DETAIL = ["ad", "adset", "campaign"] as const;

export interface MorningCard {
  from: string;
  to: string;
  runs: { ok: number; failed: number; waiting: number; list: { name: string; status: string; summary: string | null }[] };
  approvalsQueued: number;
  notifications: { title: string; urgency: string }[];
  executed: number;
}

export interface TodayView {
  demo: boolean;
  today: DayNumbers;
  yesterday: DayNumbers;
  avg7: DayNumbers;
  testShare: number | null;
  testLimit: number;
  alerts: TodayAlert[];
  approvals: ApprovalView[];
  stalled: { key: string; title: string; detail: string; href: string }[];
  tasks: TaskView[];
  morning: MorningCard | null;
  missingRules: number;
  name: string | null;
}

const DEMO: TodayView = {
  demo: true,
  today: { spend: 191.5, orders: 52, costPerOrder: 3.68, profit: 84.2 },
  yesterday: { spend: 203.1, orders: 58, costPerOrder: 3.5, profit: 112.4 },
  avg7: { spend: 196.4, orders: 55, costPerOrder: 3.57, profit: 98.7 },
  testShare: 0.31,
  testLimit: 0.2,
  alerts: [
    { key: "demo-test", tone: "danger", text: "الاختبارات أخدت 31% من صرف اليوم (الحد 20%) — الأرقام الكبيرة بتنحرق على اختبارات", href: "/ads" },
    { key: "demo-stock", tone: "warn", text: "مخزون TIN01: بيكفي 4 يوم", href: "/ads?product=TIN01" },
  ],
  approvals: [],
  stalled: [],
  tasks: [],
  morning: null,
  missingRules: 0,
  name: null,
};

async function loadTodayRaw(now = new Date()): Promise<TodayView> {
  if (process.env.MOCK_MODE === "1") return DEMO;

  const rules = readRules(await getSetting("campaign.rules"));
  const fx = Number(await getSetting("economics.fx_fee"));
  const split = (await getSetting("budget.split")) as { test: number };
  const d0 = ammanDay(now);
  const start = d0 - 7 * DAY;
  // the orders of the eight Amman days up to the end of today (Amman midnight is not UTC midnight)
  const ordersFrom = dayBounds(ammanKey(new Date(start))).from;
  const ordersTo = dayBounds(ammanKey(now)).to;

  const [spendRows, orderRows, econRows, campaigns, adsets, ads] = await Promise.all([
    db.insightDaily.groupBy({ by: ["level", "date", "objectId"], where: { date: { gte: new Date(start), lte: new Date(d0) } }, _sum: { spend: true } }),
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: ordersFrom, lt: ordersTo }, isFake: false }, select: { createdAtOms: true, productCode: true, campaignId: true } }),
    db.productEconomics.findMany(),
    db.campaign.findMany({ select: { metaId: true, name: true, stage: true, productCode: true } }),
    db.adSet.findMany({ select: { metaId: true, campaign: { select: { metaId: true } } } }),
    db.ad.findMany({ select: { metaId: true, adSet: { select: { campaign: { select: { metaId: true } } } } } }),
  ]);

  // which campaign (and so which stage and product) an object of any level belongs to
  const campaignOf = new Map<string, string>(campaigns.map((c) => [c.metaId, c.metaId]));
  for (const s of adsets) campaignOf.set(s.metaId, s.campaign.metaId);
  for (const a of ads) campaignOf.set(a.metaId, a.adSet.campaign.metaId);
  const campaign = new Map(campaigns.map((c) => [c.metaId, c]));

  // the spend of each day at the best level it has: the account's total, else ads, else ad sets, else campaigns
  type Spend = { date: number; level: string; objectId: string; spend: number };
  const rows: Spend[] = spendRows.map((r) => ({ date: r.date.getTime(), level: r.level, objectId: r.objectId, spend: Number(r._sum.spend ?? 0) }));
  const byDate = new Map<number, Spend[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const bestOf = (list: Spend[]): { total: number; detail: Spend[] } => {
    const acct = list.filter((r) => r.level === "account");
    const detail = LEVELS_BY_DETAIL.map((l) => list.filter((r) => r.level === l)).find((l) => l.length) ?? [];
    return { total: (acct.length ? acct : detail).reduce((s, r) => s + r.spend, 0), detail };
  };

  const products = new Map(econRows.map((p) => [p.productCode, toProduct(p)]));
  const margin = (code: string) => (products.has(code) ? targetsOf(products.get(code)!).margin : null);

  const ordersOn = (ms: number) => orderRows.filter((o) => ammanDay(o.createdAtOms) === ms);
  const dayNumbers = (ms: number): DayNumbers => {
    const list = byDate.get(ms);
    const orders = ordersOn(ms);
    if (!list?.length) return { spend: null, orders: orders.length || null, costPerOrder: null, profit: null };
    const spend = Math.round(bestOf(list).total * (1 + fx) * 100) / 100;
    const known = orders.filter((o) => margin(o.productCode) !== null);
    const profit = orders.length && !known.length ? null : Math.round((known.reduce((s, o) => s + margin(o.productCode)!, 0) - spend) * 100) / 100;
    return { spend, orders: orders.length, costPerOrder: costPerOrder(spend, orders.length), profit };
  };
  const today = dayNumbers(d0);
  const yesterday = dayNumbers(d0 - DAY);
  const avg7 = averageDays(Array.from({ length: 7 }, (_, i) => dayNumbers(d0 - (i + 1) * DAY)));

  // tests against the plan: today's spend by the stage of its campaign
  const todayDetail = bestOf(byDate.get(d0) ?? []).detail;
  const detailTotal = todayDetail.reduce((s, r) => s + r.spend, 0);
  const testSpend = todayDetail.filter((r) => isTestStage(campaign.get(campaignOf.get(r.objectId) ?? "")?.stage)).reduce((s, r) => s + r.spend, 0);
  const share = testShare(testSpend, detailTotal);

  // the judged days (not today): real cost per product, and campaigns that spend with no order
  const judged = Array.from({ length: Math.max(1, rules.judgeDays) }, (_, i) => d0 - (i + 1) * DAY);
  const judgedSpend = judged.flatMap((d) => bestOf(byDate.get(d) ?? []).detail);
  const spendOfProduct = new Map<string, number>();
  const spendOfCampaign = new Map<string, number>();
  for (const r of judgedSpend) {
    const c = campaign.get(campaignOf.get(r.objectId) ?? "");
    if (!c) continue;
    spendOfCampaign.set(c.metaId, (spendOfCampaign.get(c.metaId) ?? 0) + r.spend);
    if (c.productCode) spendOfProduct.set(c.productCode, (spendOfProduct.get(c.productCode) ?? 0) + r.spend);
  }
  const judgedOrders = judged.flatMap(ordersOn);
  const ordersOfProduct = new Map<string, number>();
  const ordersOfCampaign = new Map<string, number>();
  for (const o of judgedOrders) {
    ordersOfProduct.set(o.productCode, (ordersOfProduct.get(o.productCode) ?? 0) + 1);
    if (o.campaignId) ordersOfCampaign.set(o.campaignId, (ordersOfCampaign.get(o.campaignId) ?? 0) + 1);
  }
  const attributed = ordersOfCampaign.size > 0; // without any order tied to a campaign, «no orders» would be a guess
  const zeroLine = rules.ad.spendZeroSales;
  const zeroOrders = attributed && zeroLine !== null ? [...spendOfCampaign].filter(([id, spend]) => spend * (1 + fx) >= zeroLine && !ordersOfCampaign.get(id)).map(([id, spend]) => ({ name: campaign.get(id)?.name ?? id, spend: spend * (1 + fx) })) : [];

  const snaps = await db.stockSnapshot.findMany({ orderBy: { at: "desc" }, take: 300 });
  const newest = new Map<string, number>();
  for (const s of snaps) if (!newest.has(s.productCode)) newest.set(s.productCode, Number(s.daysCover));

  const alerts: TodayAlert[] = buildAlerts({
    testShare: share,
    testLimit: split.test,
    products: [...new Set([...spendOfProduct.keys(), ...ordersOfProduct.keys()])].map((code) => {
      const orders = ordersOfProduct.get(code) ?? 0;
      return { code, name: products.get(code)?.name, orders, cost: costPerOrder((spendOfProduct.get(code) ?? 0) * (1 + fx), orders) };
    }),
    zeroOrders,
    stock: [...newest].map(([code, days]) => ({ code, days })),
    rules,
  });
  // what the jobs raised on their own (the real alerts table — it used to be shown nowhere)
  const stored = await db.alert.findMany({ where: { readAt: null, tone: { in: ["danger", "warn"] }, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const a of stored) alerts.push({ key: `stored:${a.id}`, tone: a.tone === "danger" ? "danger" : "warn", text: a.text, href: a.href ?? "/ads" });

  const [approvals, stalledRuns, stalledTasks, tasks, mode] = await Promise.all([
    listApprovals({ status: ["pending", "postponed"] }, now),
    db.workflowRun.findMany({ where: { status: { in: ["failed", "waiting"] }, startedAt: { gte: new Date(now.getTime() - DAY) } }, include: { workflow: { select: { name: true } } }, orderBy: { startedAt: "desc" }, take: 6 }),
    listTasks({ status: ["stalled"], limit: 6 }),
    listTasks({ status: ["new", "doing", "waiting_approval"], limit: 40 }),
    currentMode(now),
  ]);
  const stalled = [
    ...stalledRuns.map((r) => ({ key: `run:${r.id}`, title: r.workflow.name, detail: `${r.status === "failed" ? "فشل" : "متوقف"}${r.summary ? ` — ${r.summary}` : ""}`, href: "/workflow" })),
    ...stalledTasks.map((t) => ({ key: `task:${t.id}`, title: t.title, detail: t.assignee ? `عند ${t.assignee}` : "بلا مسؤول", href: "/tasks" })),
  ];
  const endOfToday = ordersTo.getTime();
  const todays = tasks.filter((t) => t.status === "doing" || (t.dueAt && new Date(t.dueAt).getTime() < endOfToday)).slice(0, 8);

  return {
    demo: false,
    today,
    yesterday,
    avg7,
    testShare: share,
    testLimit: split.test,
    alerts,
    approvals,
    stalled,
    tasks: todays,
    morning: await morningOf(now, mode.mode === "awake"),
    missingRules: rulesMissing(rules),
    name: null,
  };
}

function rulesMissing(r: CampaignRules): number {
  return [r.targetCost, r.ad.spendZeroSales, r.scale.maxCost, r.scale.capRunning].filter((v) => v === null).length + (Object.keys(r.breakeven).length ? 0 : 1);
}

/** «صباح الخير»: what ran, what waited and what went out of the way while he slept — for twelve hours after he wakes. */
async function morningOf(now: Date, awake: boolean): Promise<MorningCard | null> {
  if (!awake) return null;
  const night = lastNight(readMode(await getSetting("owner.mode")), now);
  if (!night || now.getTime() - night.to.getTime() > 12 * 3_600_000) return null;
  const between = { gte: night.from, lte: night.to };
  const [runs, queued, notifications, executed] = await Promise.all([
    db.workflowRun.findMany({ where: { startedAt: between }, include: { workflow: { select: { name: true } } }, orderBy: { startedAt: "asc" }, take: 40 }),
    db.approval.count({ where: { createdAt: between, status: { in: ["pending", "postponed"] } } }),
    db.notification.findMany({ where: { createdAt: between, urgency: { not: "yellow" } }, orderBy: { createdAt: "desc" }, take: 8, select: { title: true, urgency: true } }),
    db.changeSet.count({ where: { executedAt: between, source: "rule" } }),
  ]);
  const n = (s: string) => runs.filter((r) => r.status === s).length;
  return {
    from: night.from.toISOString(),
    to: night.to.toISOString(),
    runs: { ok: n("ok"), failed: n("failed"), waiting: n("waiting"), list: runs.slice(-6).map((r) => ({ name: r.workflow.name, status: r.status, summary: r.summary })) },
    approvalsQueued: queued,
    notifications,
    executed,
  };
}

/** Just the «صباح الخير» card — for the page's header, whichever tab is open. */
async function loadMorningRaw(now = new Date()): Promise<MorningCard | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const mode = await currentMode(now);
  return morningOf(now, mode.mode === "awake");
}

/** loadToday for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const loadToday = async (...a: Parameters<typeof loadTodayRaw>) => forViewer(await loadTodayRaw(...a));

/** loadMorning for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const loadMorning = async (...a: Parameters<typeof loadMorningRaw>) => forViewer(await loadMorningRaw(...a));
