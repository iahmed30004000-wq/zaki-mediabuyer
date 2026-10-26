/**
 * What the launch wizard, the tests tab and the reports' health/safety sections draw: the demo data
 * (MOCK_MODE=1) or the real rows from the database, mapped to plain shapes the client can take.
 */
import { db } from "@/server/db";
import { ACCOUNTS, CREATIVES, PRODUCTS, targetsOf } from "@/lib/mock/data";
import { productTargets } from "@/server/launch";
import { judgeExperiment, KIND_AR, type ExperimentKind, type StopRules } from "@/core/experiments";
import { capiHealth } from "@/core/capi";
import { ACCOUNT_STATUS_AR, type AttributionHealth } from "@/core/account-safety";

export interface LaunchOptions {
  /** false = the demo: the wizard shows everything but nothing is proposed */
  live: boolean;
  products: { code: string; name: string; market: string; tOrder: number; estimated: boolean; stockDays: number | null }[];
  creatives: { code: string; product: string; label: string }[];
  accounts: { metaId: string; name: string; market: string }[];
  pages: { metaId: string; code: string; name: string }[];
  datasets: { metaId: string; name: string }[];
}

export async function loadLaunchOptions(): Promise<LaunchOptions> {
  if (process.env.MOCK_MODE === "1") {
    return {
      live: false,
      products: PRODUCTS.map((p) => ({ code: p.code, name: p.name, market: p.market, tOrder: targetsOf(p).tOrder, estimated: targetsOf(p).estimated, stockDays: p.stockDays })),
      creatives: CREATIVES.filter((c) => c.stage === "ready" || c.stage === "live").map((c) => ({ code: c.code, product: c.product, label: [c.hook, c.angle, `${c.duration}ث`].filter(Boolean).join(" · ") })),
      accounts: ACCOUNTS.map((a) => ({ metaId: a.id, name: a.name, market: a.market })),
      pages: [{ metaId: "demo-sp", code: "SP", name: "صحة بلس" }],
      datasets: [{ metaId: "demo-px", name: "البكسل" }],
    };
  }
  const [econ, assets, accounts, pages, datasets] = await Promise.all([
    db.productEconomics.findMany({ orderBy: { productCode: "asc" } }),
    db.creativeAsset.findMany({ where: { metaVideoId: { not: null }, status: { in: ["uploaded", "ready"] }, policyFlag: { not: "red" } }, orderBy: { crCode: "desc" }, take: 200 }),
    db.adAccount.findMany({ orderBy: { name: "asc" } }),
    db.page.findMany({ where: { code: { not: null } }, orderBy: { code: "asc" } }),
    db.dataset.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const products = await Promise.all(econ.map(async (e) => ({ code: e.productCode, name: e.name, market: e.market, tOrder: (await productTargets(e.productCode))?.tOrder ?? 0, estimated: e.source !== "actual", stockDays: e.stockDays })));
  return {
    live: true,
    products,
    creatives: assets.map((a) => ({ code: a.crCode, product: a.productCode ?? "", label: [a.hookType, a.angle, a.conceptId, a.durationS ? `${Number(a.durationS).toFixed(0)}ث` : null].filter(Boolean).join(" · ") })),
    accounts: accounts.map((a) => ({ metaId: a.metaId, name: a.name, market: a.market ?? "SY" })),
    pages: pages.map((p) => ({ metaId: p.metaId, code: p.code!, name: p.name })),
    datasets: datasets.map((d) => ({ metaId: d.metaId, name: d.name })),
  };
}

export interface ExperimentView {
  id: string;
  kind: string;
  title: string;
  hypothesis: string;
  status: "planned" | "running" | "done" | "stopped";
  campaign: string;
  day: number;
  days: number;
  verdict: string;
  winner: string | null;
  arms: { key: string; spend: number; orders: number; confirmed: number; cost: number | null }[];
}

/** Every test with its arms read from the truth: spend from Meta's archive, orders from the OMS (mature confirmed only). */
export async function loadExperiments(): Promise<ExperimentView[]> {
  if (process.env.MOCK_MODE === "1") return [];
  const rows = await db.experiment.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const now = new Date();
  return Promise.all(
    rows.map(async (e) => {
      const setup = e.setup as { campaign?: string };
      const rules = e.stopRules as unknown as StopRules;
      const ads = e.campaignMetaId ? await db.ad.findMany({ where: { adSet: { campaign: { metaId: e.campaignMetaId } } }, select: { metaId: true, adSet: { select: { conceptId: true, name: true } } } }) : [];
      const arms = new Map<string, { key: string; spend: number; orders: number; confirmed: number }>();
      if (ads.length) {
        const spend = await db.insightDaily.groupBy({ by: ["objectId"], where: { level: "ad", objectId: { in: ads.map((a) => a.metaId) } }, _sum: { spend: true } });
        const orders = await db.attributedOrder.findMany({ where: { adId: { in: ads.map((a) => a.metaId) }, isFake: false }, select: { adId: true, confirmedAt: true, matureAt: true } });
        for (const a of ads) {
          const key = a.adSet.conceptId ? `CPT${a.adSet.conceptId.replace(/^CPT/, "")}` : a.adSet.name;
          const arm = arms.get(key) ?? { key, spend: 0, orders: 0, confirmed: 0 };
          arm.spend += Number(spend.find((s) => s.objectId === a.metaId)?._sum.spend ?? 0) * 1.01;
          const mine = orders.filter((o) => o.adId === a.metaId);
          arm.orders += mine.length;
          arm.confirmed += mine.filter((o) => o.confirmedAt && o.matureAt <= now).length;
          arms.set(key, arm);
        }
      }
      const day = e.startedAt ? Math.max(0, Math.floor((now.getTime() - e.startedAt.getTime()) / 86_400_000)) : 0;
      const v = e.status === "running" || e.status === "done" ? judgeExperiment([...arms.values()], rules, day) : null;
      return {
        id: e.id,
        kind: e.kind,
        title: KIND_AR[e.kind as ExperimentKind] ?? e.kind,
        hypothesis: e.hypothesis,
        status: (v?.status === "done" ? "done" : e.status) as ExperimentView["status"],
        campaign: setup.campaign ?? "",
        day,
        days: rules.maxDays,
        verdict: v?.sentence ?? (e.status === "planned" ? "بانتظار موافقتك على الإطلاق" : e.verdict ?? ""),
        winner: v?.winner ?? null,
        arms: [...arms.values()].map((a) => ({ ...a, spend: Math.round(a.spend * 100) / 100, cost: v?.costs[a.key] ?? null })),
      };
    }),
  );
}

export interface DataHealthView {
  attributedPct: number | null;
  gapWorst: { campaign: string; gap: number; cause: string } | null;
  capiAcceptedPct: number | null;
  capi: { sent: number; rejected: number; expired: number; skipped: number; pending: number };
  health: AttributionHealth["attribution_health"] | null;
  gaps: { campaign: string; gap: number; cause: string }[];
}

export async function loadDataHealth(): Promise<DataHealthView | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const counts = Object.fromEntries((await db.capiEvent.groupBy({ by: ["state"], _count: true, where: { createdAt: { gte: since } } })).map((g) => [g.state, g._count]));
  const report = await db.report.findFirst({ where: { kind: "attribution" }, orderBy: { forDate: "desc" } });
  const h = report ? (JSON.parse(report.text) as AttributionHealth) : null;
  const gaps = (h?.gaps ?? []).map((g) => ({ campaign: g.campaign, gap: g.gap_pct, cause: g.likely_cause }));
  return {
    attributedPct: h?.attributed_pct ?? null,
    gapWorst: gaps[0] ?? null,
    capiAcceptedPct: capiHealth(counts).acceptedPct,
    capi: { sent: counts.sent ?? 0, rejected: counts.rejected ?? 0, expired: counts.expired ?? 0, skipped: counts.skipped ?? 0, pending: counts.pending ?? 0 },
    health: h?.attribution_health ?? null,
    gaps,
  };
}

export interface SafetyView {
  metaId: string;
  name: string;
  verdict: "ok" | "watch" | "restricted";
  status: string;
  notes: string[];
  frozenUntil: string | null;
  issues: { id: string; adName: string; reasons: string; draft: string | null; status: string }[];
}

export async function loadSafety(): Promise<SafetyView[] | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const accounts = await db.adAccount.findMany({ orderBy: { name: "asc" } });
  return Promise.all(
    accounts.map(async (a) => {
      const h = await db.accountHealth.findFirst({ where: { accountMetaId: a.metaId }, orderBy: { createdAt: "desc" } });
      const freeze = await db.freeze.findFirst({ where: { targetId: a.metaId, kind: "create", liftedAt: null, until: { gt: new Date() } } });
      const issues = await db.reviewIssue.findMany({ where: { accountMetaId: a.metaId, status: "open" }, orderBy: { createdAt: "desc" }, take: 10 });
      return {
        metaId: a.metaId,
        name: a.name,
        verdict: (h?.verdict ?? "ok") as SafetyView["verdict"],
        status: ACCOUNT_STATUS_AR[Number(a.status)] ?? a.status,
        notes: (h?.notes as string[] | null) ?? [],
        frozenUntil: freeze?.until ? new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(freeze.until) : null,
        issues: issues.map((i) => ({ id: i.id, adName: i.adName, reasons: Object.values(i.feedback as Record<string, string>).join(" · ") || "ما في سبب مكتوب", draft: i.appealDraft, status: i.status })),
      };
    }),
  );
}
