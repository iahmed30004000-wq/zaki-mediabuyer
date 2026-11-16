import Link from "next/link";
import { OrdersSection } from "@/components/work/orders-section";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { Stat } from "@/components/ui/stat";
import { addDays } from "@/core/dates";
import { can } from "@/core/roles";
import { productVerdict } from "@/core/verdict";
import { fmt } from "@/lib/format";
import { loadDataHealth } from "@/lib/launch-view";
import { loadNumbers } from "@/lib/numbers-view";
import { loadDataset } from "@/lib/source";
import { loadToday } from "@/lib/today-view";
import { loadBoard } from "@/lib/videos-board";
import { ammanKey } from "@/core/dates";
import { gatherScale } from "@/jobs/scale-run";
import { currentCaller } from "@/server/auth";
import { db } from "@/server/db";
import { listOrders } from "@/server/orders";
import { isDemo } from "@/core/readiness";

/** The four tiles: today's spend with the cap bar (and tomorrow's, if the night round said it), real orders, the cost of one, and the share the tests took. */
export async function AdsTiles() {
  const [view, ds, round] = await Promise.all([loadToday(), loadDataset(), lastNightRound()]);
  const cap = ds.accounts.reduce((s, a) => s + a.dailyCap, 0);
  const spent = view.today.spend;
  const tomorrow = typeof round?.metrics?.spend_tomorrow === "number" ? (round.metrics.spend_tomorrow as number) : null;
  const note = [`أمس: ${view.yesterday.spend === null ? "—" : fmt(view.yesterday.spend, "$", 2)}`, cap ? `السقف ${fmt(cap, "$", 0)}` : null, tomorrow !== null ? `المتوقع بكرا ${fmt(tomorrow, "$", 0)}` : null].filter(Boolean).join(" · ");
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="totals">
      <Stat label="الصرف اليوم" value={spent} unit="$" term="spend" note={note} {...(cap && spent !== null ? { bar: (spent / cap) * 100 } : {})} {...(cap && spent !== null && spent >= cap ? { tone: "danger" as const } : {})} />
      <Stat label="طلبات حقيقية" value={view.today.orders} term="realOrders" note={`أمس: ${view.yesterday.orders ?? "—"}`} />
      <Stat label="تكلفة الطلب الحقيقي" value={view.today.costPerOrder} unit="$" term="costPerOrder" note={`أمس: ${view.yesterday.costPerOrder === null ? "—" : fmt(view.yesterday.costPerOrder, "$", 2)}`} />
      <Stat label="حصة الاختبارات" value={view.testShare === null ? null : Math.round(view.testShare * 1000) / 10} unit="%" term="testShare" note={`الحد ${Math.round(view.testLimit * 100)}%`} {...(view.testShare !== null && view.testShare > view.testLimit ? { tone: "danger" as const } : {})} />
    </div>
  );
}

async function lastNightRound() {
  if (isDemo(process.env)) return null;
  return db.workflowRun.findFirst({ where: { workflow: { key: "night-round" } }, orderBy: { startedAt: "desc" }, include: { workflow: { select: { key: true } } } }).then((r) => (r ? { id: r.id, status: r.status, summary: r.summary, startedAt: r.startedAt, metrics: (r.metrics ?? null) as Record<string, unknown> | null } : null));
}

interface Row {
  code: string;
  name: string;
  spend: number | null;
  orders: number | null;
  cost: number | null;
  breakeven: number | null;
  verdictKey: ReturnType<typeof productVerdict>["key"];
  label: string;
  tone: ReturnType<typeof productVerdict>["tone"];
}

/** The products table with each product's verdict, over the last THREE FULL days without today (the window the night round judges on). */
export async function ProductsVerdictTable() {
  const today = ammanKey(new Date());
  const from = addDays(today, -3);
  const to = addDays(today, -1);
  const data = await loadNumbers({ d: "custom", from, to });
  const rows: Row[] = data.products
    .filter((p) => p.hasData)
    .map((p) => {
      const v = productVerdict(p.current.costPerOrder, data.target, p.breakeven);
      return { code: p.code, name: p.name, spend: p.current.spend, orders: p.current.ordersIn, cost: p.current.costPerOrder, breakeven: p.breakeven, verdictKey: v.key, label: v.label, tone: v.tone };
    });
  const cols: Column<Row>[] = [
    { key: "name", header: "المنتج", cell: (r) => <Link href={`/products/${encodeURIComponent(r.code)}`} className="font-bold text-fg hover:underline">{r.name}</Link> },
    { key: "spend", header: "الصرف", numeric: true, cell: (r) => (r.spend === null ? "—" : fmt(r.spend, "$")) },
    { key: "orders", header: "طلبات حقيقية", numeric: true, cell: (r) => (r.orders === null ? "—" : String(Math.round(r.orders))) },
    { key: "cost", header: "تكلفة الطلب", numeric: true, cell: (r) => (r.cost === null ? "—" : fmt(r.cost, "$")) },
    { key: "be", header: "نقطة التعادل", numeric: true, cell: (r) => (r.breakeven === null ? "—" : fmt(r.breakeven, "$")) },
    { key: "v", header: "الحكم", cell: (r) => <Pill tone={r.tone}>{r.label}</Pill> },
  ];
  return (
    <section className="space-y-3" data-tour="products">
      <SectionTitle hint="آخر 3 أيام كاملة بدون اليوم — نفس النافذة اللي بتحكم عليها جولة الليل. الحكم عرض، والقرار للجولة وقواعدك.">المنتجات</SectionTitle>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.code} label="المنتجات وحكمها" empty={<p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في أرقام للمنتجات بهالنافذة. الأرقام بتيجي من ميتا والـ OMS أو لما Claude يبعتها.</p>} />
    </section>
  );
}

/** The last night round: what it scaled and paused, with a link to its report. */
export async function NightRoundCard() {
  const r = await lastNightRound();
  const m = r?.metrics ?? {};
  const n = (k: string) => (typeof m[k] === "number" ? String(m[k]) : "—");
  return (
    <section className="space-y-3">
      <SectionTitle>آخر جولة ليل</SectionTitle>
      <Card>
        <CardBody className="space-y-2">
          {r ? (
            <>
              <p className="text-sm text-fg">{r.summary ?? "ما انكتب لها سطر."}</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                <span>كبّر <b dir="ltr" className="tabular-nums text-fg">{n("scaled")}</b></span>
                <span>وقّف <b dir="ltr" className="tabular-nums text-fg">{n("paused")}</b></span>
                <span>إعلانات موقوفة <b dir="ltr" className="tabular-nums text-fg">{n("ads_paused")}</b></span>
                <span>تنبيهات مخزون <b dir="ltr" className="tabular-nums text-fg">{n("stock_alerts")}</b></span>
              </p>
              <Link href={`/work/reports/${encodeURIComponent(`run:${r.id}`)}`} className="text-sm font-semibold text-info hover:underline">
                افتح التقرير
              </Link>
            </>
          ) : (
            <p className="text-sm text-fg-muted">جولة الليل لسا ما اشتغلت (أو ما سجّلت). لما Claude يسجّلها بـ log_run بتظهر هون.</p>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

/** The standing orders that touch ads. */
export async function AdsOrders() {
  const [orders, me] = await Promise.all([listOrders({ domain: "ads" }), currentCaller()]);
  return <OrdersSection orders={orders} scope={{ domain: "ads" }} canCreate={!!me && !me.demo && can(me.role, "orders.restrict")} canEnd={!!me && !me.demo && can(me.role, "owner_only")} />;
}

/** The video bank of each product: how many of 50, how many winners, how many tired. */
export async function BankCard() {
  const board = await loadBoard();
  return (
    <section className="space-y-3">
      <SectionTitle href="/ads/videos" linkLabel="الفيديوهات">
        بنك الفيديو
      </SectionTitle>
      <Card>
        <ul className="divide-y divide-border">
          {board.products.map((p) => (
            <li key={p.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <Link href={`/products/${encodeURIComponent(p.code)}`} className="font-bold text-fg hover:underline">
                {p.name}
              </Link>
              <span dir="ltr" className="tabular-nums text-fg-muted">
                {p.bank.count} / {p.bank.target}
              </span>
              {p.bank.short > 0 ? <Pill tone="warn">ناقص {p.bank.short}</Pill> : <Pill tone="ok">كامل</Pill>}
              <span className="ms-auto text-xs text-fg-muted">رابحين {p.winners.length} · تعبانين {p.tiredCount}</span>
            </li>
          ))}
          {!board.products.length ? <li className="px-4 py-3 text-sm text-fg-muted">ما في منتجات بالبنك لسا.</li> : null}
        </ul>
      </Card>
    </section>
  );
}

/** The ad sets that may be raised (three at most), or why none can. «الكل» opens the ladder. */
export async function ScaleCandidates() {
  const rows = isDemo(process.env) ? [] : await gatherScale().catch(() => []);
  const ok = rows.filter((r) => r.decision.raise).slice(0, 3);
  return (
    <section className="space-y-3">
      <SectionTitle href="/ads/scale" linkLabel="سلّم التكبير كامل">
        مرشّحين للتكبير
      </SectionTitle>
      <Card>
        <CardBody className="space-y-2">
          {ok.length ? (
            ok.map((r) => (
              <p key={r.adSetId} className="text-sm text-fg">
                <span className="font-bold">{r.name}</span> — {r.decision.sentence}
              </p>
            ))
          ) : (
            <p className="text-sm text-fg-muted">{rows.length ? "ما في مجموعة مؤهّلة للتكبير هلأ — «سلّم التكبير» بيقول ليش." : "السلّم بيشتغل على أرقام حقيقية (مش التجريبية)."}</p>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

/** The data health in one card: the attributed share, the share of conversion events Meta accepted, and the worst gap. The page /ads/health has the rest. */
export async function HealthCard() {
  const h = isDemo(process.env) ? null : await loadDataHealth().catch(() => null);
  const rejected = h?.capi.rejected ?? 0;
  return (
    <section className="space-y-3">
      <SectionTitle href="/ads/health" linkLabel="صحة البيانات كاملة">
        صحة البيانات
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="الطلبات المنسوبة" value={h?.attributedPct ?? null} unit="%" />
        <Stat label="طلبات انرسلت لميتا بنجاح" value={h?.capiAcceptedPct ?? null} unit="%" {...(rejected ? { note: `${rejected} مرفوض` } : {})} />
        <Stat label="أكبر فرق ميتا/حقيقي" value={h?.gapWorst ? h.gapWorst.gap : null} unit="%" {...(h?.gapWorst ? { note: h.gapWorst.campaign } : {})} />
      </div>
    </section>
  );
}
