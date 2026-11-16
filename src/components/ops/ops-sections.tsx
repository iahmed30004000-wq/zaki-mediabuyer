import Link from "next/link";
import { OrdersSection } from "@/components/work/orders-section";
import { JobCard } from "@/components/work/job-card";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { Stat } from "@/components/ui/stat";
import { funnel, type PersonFlag } from "@/core/ops";
import { can } from "@/core/roles";
import { fmt } from "@/lib/format";
import { loadJobs } from "@/lib/jobs-view";
import { loadNumbers } from "@/lib/numbers-view";
import { currentCaller } from "@/server/auth";
import { lastStockAlert, latestMetric, loadOpsRules, loadTeam, metricSeries, type TeamRow } from "@/server/ops";
import { listOrders } from "@/server/orders";
import { OpsRulesForm } from "./ops-rules-form";

const pctText = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number | null) => (v === null ? "—" : String(Math.round(v)));

/** The funnel: دخل ← مؤكد ← نزل على الشحن ← انشحن ← تسلّم, each with its share of the step before. The «landed» step shows only when the shipments check said it. */
export async function FunnelSection() {
  const [data, landed] = await Promise.all([loadNumbers({ d: "7d" }), latestMetric("shipments-check", "landed")]);
  const c = data.totals.current;
  const steps = funnel({ ordersIn: c.ordersIn, confirmed: c.confirmed, landed: landed?.value ?? null, shippedOrders: c.shippedOrders, delivered: c.delivered });
  return (
    <section className="space-y-3" data-tour="funnel">
      <SectionTitle hint="آخر 7 أيام — كل مرحلة وتحتها نسبتها من اللي قبلها">رحلة الطلب</SectionTitle>
      <div className={`grid grid-cols-2 gap-3 ${steps.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {steps.map((s) => (
          <Stat key={s.key} label={s.label} value={s.value} note={s.pctOfPrev === null ? undefined : `${s.pctOfPrev}% من اللي قبله`} />
        ))}
      </div>
    </section>
  );
}

/** The leak: orders open over 24 hours, the last 7 days. Hidden when the plan never said it (no tile, no guess). */
export async function LeakSection() {
  const series = await metricSeries("leak-plan", "open_over_24h", 7);
  if (series.every((p) => p.value === null)) return null;
  const max = Math.max(1, ...series.map((p) => p.value ?? 0));
  return (
    <section className="space-y-3">
      <SectionTitle hint="طلبات مفتوحة أكتر من 24 ساعة، كل يوم">التسريب</SectionTitle>
      <Card>
        <CardBody>
          <ul className="flex items-end gap-2" aria-label="التسريب آخر 7 أيام">
            {series.map((p) => (
              <li key={p.day} className="flex flex-1 flex-col items-center gap-1">
                <span dir="ltr" className="text-xs font-bold tabular-nums text-fg">{p.value === null ? "—" : p.value}</span>
                <span aria-hidden className="block w-full rounded-t-md bg-warn/60" style={{ height: `${p.value === null ? 2 : Math.max(4, (p.value / max) * 64)}px` }} />
                <span dir="ltr" className="text-xs text-fg-muted">{p.day.slice(5)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

const flagPill = (f: PersonFlag | null) => (f ? <Pill tone={f.tone}>{f.label}</Pill> : <span className="text-fg-muted">—</span>);

/** The team table (names and numbers — the owner's until the permissions of P10). */
export function TeamTable({ rows }: { rows: TeamRow[] }) {
  const cols: Column<TeamRow>[] = [
    { key: "name", header: "الموظف", cell: (r) => <span className="font-bold text-fg">{r.name}</span> },
    { key: "claims", header: "مسكات", numeric: true, cell: (r) => num(r.claims) },
    { key: "confirmed", header: "مؤكد", numeric: true, cell: (r) => num(r.confirmed) },
    { key: "noAnswer", header: "ما ردّ", numeric: true, cell: (r) => (r.noAnswer === null ? "—" : `${r.noAnswer} (${pctText(r.noAnswerRate)})`) },
    { key: "stuck", header: "عالق +48", numeric: true, cell: (r) => num(r.stuck48h) },
    { key: "flag", header: "الوضع", cell: (r) => flagPill(r.flag) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} label="فريق التأكيد" />;
}

/** The confirmation team on the dashboard: the totals and a row each. */
export async function TeamSummary() {
  const team = await loadTeam(7);
  return (
    <section className="space-y-3">
      <SectionTitle href="/ops/confirm" linkLabel="تفاصيل الفريق" hint="آخر 7 أيام">
        فريق التأكيد
      </SectionTitle>
      {team.rows.length ? (
        <TeamTable rows={team.rows} />
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">Claude لسا ما بعت أرقام الفريق (بصف push_metrics مستواه person). لما يبعتها بتظهر هون.</p>
      )}
    </section>
  );
}

interface StockRow {
  code: string;
  name: string;
  units: number | null;
  daily: number | null;
  cover: number | null;
  urgency: "red" | "orange" | "yellow" | null;
}

async function stockRows(): Promise<StockRow[]> {
  const data = await loadNumbers({ d: "7d" });
  return data.products
    .filter((p) => p.current.stockUnits !== null || p.current.stockCover !== null)
    .map((p) => ({ code: p.code, name: p.name, units: p.current.stockUnits, daily: p.current.shippedPieces === null ? null : p.current.shippedPieces / 7, cover: p.current.stockCover, urgency: p.stockUrgency }));
}

const URG: Record<string, { label: string; tone: "danger" | "warn" | "info" }> = { red: { label: "أقل من أسبوع", tone: "danger" }, orange: { label: "قريب", tone: "warn" }, yellow: { label: "انتبه", tone: "info" } };

export function StockTable({ rows }: { rows: StockRow[] }) {
  const cols: Column<StockRow>[] = [
    { key: "name", header: "المنتج", cell: (r) => <Link href={`/products/${encodeURIComponent(r.code)}`} className="font-bold text-fg hover:underline">{r.name}</Link> },
    { key: "units", header: "القطع", numeric: true, cell: (r) => num(r.units) },
    { key: "daily", header: "البيع اليومي", numeric: true, cell: (r) => (r.daily === null ? "—" : fmt(r.daily, "", 1)) },
    { key: "cover", header: "بيكفي (يوم)", numeric: true, cell: (r) => (r.cover === null ? "—" : fmt(r.cover, "", 1)) },
    { key: "u", header: "الحالة", cell: (r) => (r.urgency ? <Pill tone={URG[r.urgency]!.tone}>{URG[r.urgency]!.label}</Pill> : <span className="text-fg-muted">—</span>) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.code} label="المخزون" empty={<p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في مخزون مسجّل. لما Claude يبعت المخزون (push_stock) بيظهر هون.</p>} />;
}

export async function StockSummary() {
  const rows = await stockRows();
  return (
    <section className="space-y-3">
      <SectionTitle href="/ops/stock" linkLabel="كل المخزون">
        تغطية المخزون
      </SectionTitle>
      <StockTable rows={rows.sort((a, b) => (a.cover ?? 9e9) - (b.cover ?? 9e9)).slice(0, 5)} />
    </section>
  );
}

export async function StockPage() {
  const [rows, alert] = await Promise.all([stockRows(), lastStockAlert()]);
  return (
    <div className="space-y-4">
      <StockTable rows={rows.sort((a, b) => (a.cover ?? 9e9) - (b.cover ?? 9e9))} />
      {alert ? <p className="text-sm text-fg-muted">آخر تنبيه مخزون: <span className="font-semibold text-fg">{alert.title}</span></p> : null}
    </div>
  );
}

/** The operations jobs (domain ops): their last result and the next run. */
export async function OpsJobs() {
  const { jobs } = await loadJobs();
  const mine = jobs.filter((j) => j.domain === "ops");
  return (
    <section className="space-y-3">
      <SectionTitle href="/work" linkLabel="الخريطة">
        مهام التشغيل
      </SectionTitle>
      {mine.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {mine.map((j) => (
            <JobCard key={j.key} job={j} />
          ))}
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في مهام تشغيل بالخريطة.</p>
      )}
    </section>
  );
}

export async function OpsOrders() {
  const [orders, me] = await Promise.all([listOrders({ domain: "ops" }), currentCaller()]);
  return <OrdersSection orders={orders} scope={{ domain: "ops" }} canCreate={!!me && !me.demo && can(me.role, "propose_change")} canEnd={!!me && !me.demo && can(me.role, "owner_only")} />;
}

/** The confirmation page: the team, the reasons for rejection, the manager's comment, and the owner's limits for the flags. */
export async function ConfirmPage() {
  const [team, rules, comment, me] = await Promise.all([loadTeam(7), loadOpsRules(), latestComment(), currentCaller()]);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle hint="آخر 7 أيام">فريق التأكيد</SectionTitle>
        {team.rows.length ? <TeamTable rows={team.rows} /> : <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">Claude لسا ما بعت أرقام الفريق.</p>}
      </section>
      {team.reasons.length ? (
        <section className="space-y-3">
          <SectionTitle>أسباب الرفض</SectionTitle>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
            {team.reasons.map((r) => (
              <li key={r.reason} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-fg">{r.reason}</span>
                <span dir="ltr" className="font-bold tabular-nums text-fg">{r.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {comment ? (
        <section className="space-y-3">
          <SectionTitle hint={comment.at}>تعليق المدير</SectionTitle>
          <Card>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{comment.text}</p>
            </CardBody>
          </Card>
        </section>
      ) : null}
      {me && !me.demo && can(me.role, "owner_only") ? (
        <section className="space-y-3">
          <SectionTitle>حدود الشارات</SectionTitle>
          <OpsRulesForm initial={rules} />
        </section>
      ) : null}
    </div>
  );
}

async function latestComment(): Promise<{ text: string; at: string } | null> {
  const { db } = await import("@/server/db");
  const { isDemo } = await import("@/core/readiness");
  if (isDemo(process.env)) return null;
  const r = await db.workflowRun.findFirst({ where: { workflow: { key: "manager-comment" }, report: { not: null } }, orderBy: { startedAt: "desc" }, select: { report: true, startedAt: true } });
  return r?.report ? { text: r.report, at: new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(r.startedAt) } : null;
}

/** The shipping page: what the shipments check said last (not landed · ready · postponed) and each product's stuck and returned. */
export async function ShippingPage() {
  const [data, notLanded, ready, postponed] = await Promise.all([loadNumbers({ d: "7d" }), latestMetric("shipments-check", "not_landed"), latestMetric("shipments-check", "ready"), latestMetric("shipments-check", "postponed")]);
  const rows = data.products.filter((p) => p.hasData);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", header: "المنتج", cell: (r) => <Link href={`/products/${encodeURIComponent(r.code)}`} className="font-bold text-fg hover:underline">{r.name}</Link> },
    { key: "shipped", header: "انشحن", numeric: true, cell: (r) => num(r.current.shippedOrders) },
    { key: "out", header: "عند المندوب", numeric: true, cell: (r) => num(r.current.outForDelivery) },
    { key: "stuck", header: "عالق +7 أيام", numeric: true, cell: (r) => num(r.current.stuck) },
    { key: "returned", header: "مرتجع", numeric: true, cell: (r) => num(r.current.returned) },
  ];
  return (
    <div className="space-y-6">
      {notLanded || ready || postponed ? (
        <section className="space-y-3">
          <SectionTitle hint="من آخر تشغيل لفحص نزول الشحنات">ما نزل على الشحن</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="ما نزلوا" value={notLanded?.value ?? null} />
            <Stat label="جاهزين" value={ready?.value ?? null} />
            <Stat label="مأجّلين" value={postponed?.value ?? null} />
          </div>
        </section>
      ) : null}
      <section className="space-y-3">
        <SectionTitle hint="آخر 7 أيام">العالق والمرتجع</SectionTitle>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.code} label="الشحن" empty={<p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في أرقام شحن لسا — بتيجي من الـ OMS أو لما Claude يبعتها.</p>} />
      </section>
    </div>
  );
}
