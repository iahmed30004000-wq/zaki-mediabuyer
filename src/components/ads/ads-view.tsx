"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pause, Plus, TrendingUp } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/card";
import { Num, fmt } from "@/components/mb/num";
import { Panel } from "@/components/mb/section";
import { useMission } from "@/components/mb/mission";
import { DateSwitcher } from "@/components/shell/date-switcher";
import type { ColumnKey, Filters } from "@/core/ads-table";
import type { AdsTableData, TreeRow } from "@/lib/ads-table";
import type { RowView } from "@/lib/mock/data";
import { cn } from "@/lib/utils";
import { AdsTable } from "./ads-table";
import { LaunchWizard } from "./launch-wizard";
import { StatusChip } from "./status-chip";
import type { ExperimentView, LaunchOptions } from "@/lib/launch-view";
import { safeFetch } from "@/lib/call";

const EXP_STATUS: Record<ExperimentView["status"], { l: string; c: string }> = {
  planned: { l: "بانتظار موافقتك", c: "text-warn" },
  running: { l: "شغّال", c: "text-accent" },
  done: { l: "خلص", c: "text-ok" },
  stopped: { l: "وقف", c: "text-fg-muted" },
};

/** The tests (S08): what we believe, how far it got, and the verdict from the truth — arm by arm. */
function Experiments({ list }: { list: ExperimentView[] }) {
  return (
    <div className="space-y-3">
      {list.map((e) => (
        <Panel key={e.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-fg">{e.title}</span>
            <span dir="ltr" className="tabular-nums text-xs text-fg-muted">{e.campaign}</span>
            <span className={cn("ms-auto text-sm font-medium", EXP_STATUS[e.status].c)}>
              {EXP_STATUS[e.status].l}
              {e.status === "running" ? ` · يوم ${e.day} من ${e.days}` : ""}
            </span>
          </div>
          <p className="text-sm text-fg-muted">الفرضية: {e.hypothesis}</p>
          {e.arms.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-fg-muted">
                  <tr>
                    <th className="py-1 text-start font-medium">المفهوم</th>
                    <th className="py-1 text-start font-medium">الصرف</th>
                    <th className="py-1 text-start font-medium">طلبات</th>
                    <th className="py-1 text-start font-medium">مؤكد ناضج</th>
                    <th className="py-1 text-start font-medium">تكلفة المؤكد</th>
                  </tr>
                </thead>
                <tbody>
                  {e.arms.map((a) => (
                    <tr key={a.key} className={cn("border-t border-border", e.winner === a.key && "text-ok")}>
                      <td dir="ltr" className="py-1 text-start tabular-nums">{a.key}</td>
                      <td className="py-1">{fmt(a.spend, "$")}</td>
                      <td className="py-1">{a.orders}</td>
                      <td className="py-1">{a.confirmed}</td>
                      <td className="py-1">{a.cost === null ? "—" : fmt(a.cost, "$")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-base text-fg">{e.verdict}</p>
        </Panel>
      ))}
    </div>
  );
}

export type { TreeRow };

export interface ProductRow {
  code: string;
  name: string;
  market: string;
  stockDays: number;
  view: RowView;
  targets: { tOrder: number; tConfirmed: number; margin: number; losing: boolean; estimated: boolean };
}

const TABS = [
  { key: "campaigns", label: "الجدول" },
  { key: "products", label: "حسب المنتج" },
  { key: "tests", label: "الاختبارات" },
] as const;

/** The tabs that are pages of their own (server-rendered): reached by link, not by client state. */

export function AdsView({
  table,
  columns,
  filters,
  products,
  initialTab,
  openId,
  launchOptions,
  experiments,
}: {
  table: AdsTableData;
  columns: ColumnKey[];
  filters: Filters;
  products: ProductRow[];
  initialTab: string;
  openId?: string;
  launchOptions: LaunchOptions;
  experiments: ExperimentView[];
}) {
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab : "campaigns");
  const flat = useMemo(() => table.rows.flatMap((c) => [c, ...c.children, ...c.children.flatMap((s) => s.children)]), [table.rows]);
  const [open, setOpen] = useState<TreeRow | null>(() => flat.find((r) => r.id === openId) ?? null);
  const [launch, setLaunch] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setLaunch(true)} data-tour="launch" className="ms-auto">
          <Plus className="size-4" />
          إطلاق
        </Button>
      </div>

      {tab === "campaigns" ? (
        <>
          <DateSwitcher range={table.range} />
          <AdsTable data={table} initialColumns={columns} initialFilters={filters} onOpen={setOpen} />
        </>
      ) : tab === "products" ? (
        <ProductsTruth products={products} />
      ) : experiments.length ? (
        <Experiments list={experiments} />
      ) : (
        <EmptyState title="ما في اختبارات شغّالة" hint="كل اختبار إلو فرضية وميزانية وشروط وقف ونتيجة. ابدأ واحد من «＋ إطلاق» ← اختبار." art="empty-ads" />
      )}

      <ItemSheet row={open} onClose={() => setOpen(null)} />
      <LaunchWizard open={launch} onOpenChange={setLaunch} options={launchOptions} />
    </div>
  );
}

/** «حسب المنتج» — the truth (S05): spend, confirmed, delivered, cost, profit and the gap per product. */
function ProductsTruth({ products }: { products: ProductRow[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {products.map((p) => {
        const winner = p.view.profitPerDelivered !== null && p.view.profitPerDelivered > 0;
        return (
          <Panel key={p.code} className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-fg">{p.name}</p>
              <span dir="ltr" className="tabular-nums text-xs text-fg-muted">{p.code}</span>
              <span className="text-sm text-fg-muted">· {p.market === "SY" ? "سوريا" : "الأردن"}</span>
              <span className={cn("ms-auto rounded-md px-1.5 py-0.5 text-xs font-semibold", winner ? "bg-ok/10 text-ok" : p.view.delivered ? "bg-warn/10 text-warn" : "bg-surface-2 text-fg-muted")}>
                {winner ? "رابح" : p.view.delivered ? "خاسر لهلأ" : "بيانات غير كافية"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-fg-muted">الصرف</dt><dd><Num value={p.view.spend} unit="$" term="spend" /></dd></div>
              <div><dt className="text-fg-muted">تكلفة المؤكد</dt><dd><Num value={p.view.costPerConfirmed} unit="$" term="costPerConfirmed" /></dd></div>
              <div><dt className="text-fg-muted">السقف</dt><dd><Num value={p.view.ceiling} unit="$" term="ceiling" /></dd></div>
              <div><dt className="text-fg-muted">التأكيد</dt><dd><Num value={p.view.confirmRate} unit="%" term="confirmRate" /></dd></div>
              <div><dt className="text-fg-muted">التوصيل</dt><dd><Num value={p.view.deliveryRate} unit="%" term="deliveryRate" /></dd></div>
              <div><dt className="text-fg-muted">ربح المُسلَّم</dt><dd><Num value={p.view.profitPerDelivered} unit="$" term="profitDelivered" tone={winner ? "ok" : undefined} /></dd></div>
            </dl>
            <p className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm text-fg-muted">
              هدف الطلب <Num value={p.targets.tOrder} unit="$" term="tOrder" source={p.targets.estimated ? "estimate" : "truth"} />
              <span>· المخزون {p.stockDays} يوم{p.stockDays < 5 ? " (التكبير مجمّد)" : ""}</span>
            </p>
          </Panel>
        );
      })}
    </div>
  );
}

/** The item card (S04) as a side panel: decoded name, learning, funnel, profit, and the two actions allowed here. */
function ItemSheet({ row, onClose }: { row: TreeRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const mission = useMission();
  const v = row?.view;
  const funnel = row?.counts
    ? [
        { l: "ظهور", n: row.counts.impressions },
        { l: "نقرات", n: row.counts.clicks },
        ...(row.counts.conversations !== null ? [{ l: "محادثات", n: row.counts.conversations }] : []),
        { l: "طلبات", n: row.counts.orders },
        { l: "مؤكد", n: row.counts.confirmed },
        { l: "مُسلَّم", n: row.counts.delivered },
      ]
    : null;

  async function proposeRaise(r: TreeRow) {
    const res = await safeFetch("/api/objects/scale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objectType: r.level, objectId: r.id }) });
    const d = (await res.json().catch(() => ({}))) as { error?: string; demo?: boolean; state?: string; before?: number; after?: number };
    onClose();
    if (!res.ok) toast(d.error ?? "صار خطأ", "error");
    else if (d.demo) toast("بالوضع التجريبي ما انعمل اقتراح فعلي.", "info");
    else if (d.state === "pending_approval") toast(`انضاف اقتراح: ${d.before}$ ← ${d.after}$ باليوم. بيستنى موافقتك بـ «المهام».`, "success");
    else toast(`انسجّل اقتراح: ${d.before}$ ← ${d.after}$ باليوم. الحساب «مستشار» فما بيتنفّذ ولا بيستنى موافقة.`, "info");
  }

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {row && v ? (
          <>
            <SheetHeader>
              <SheetTitle dir="ltr" className="text-start tabular-nums text-sm">{row.name}</SheetTitle>
              <SheetDescription>{row.decoded ? row.decoded.join(" · ") : "الاسم ما انفهم — بدها تسمية من الإعدادات أو من هون."}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={row.status} />
                {row.learning ? (
                  <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-xs font-semibold text-info">
                    تعلّم {row.learning.events} من {row.learning.of}
                  </span>
                ) : null}
                {row.budget ? <span className="text-sm text-fg-muted">الميزانية {fmt(row.budget, "$", 0)} / يوم</span> : null}
              </div>
              {row.note ? <p className="rounded-lg bg-warn/10 p-2 text-sm text-warn">{row.note}</p> : null}

              {funnel ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-fg-muted">القمع</h3>
                  <ol className="space-y-1.5">
                    {funnel.map((f, i) => {
                      const max = funnel[0]!.n || 1;
                      return (
                        <li key={f.l} className="flex items-center gap-2 text-sm">
                          <span className="w-14 shrink-0 text-fg-muted">{f.l}</span>
                          <span className="h-2 flex-1 rounded-full bg-surface-2">
                            <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, i === 0 ? 100 : Math.sqrt(f.n / max) * 100)}%` }} />
                          </span>
                          <span dir="ltr" className="w-14 shrink-0 text-end tabular-nums text-fg">{f.n.toLocaleString("en-US")}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}

              <section className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-fg-muted">Hook</p><Num value={v.hook} unit="%" term="hook" /></div>
                <div><p className="text-fg-muted">Hold</p><Num value={v.hold} unit="%" term="hold" /></div>
                <div><p className="text-fg-muted">CTR</p><Num value={v.ctr} unit="%" term="ctr" /></div>
                <div><p className="text-fg-muted">CPA بكسل</p><Num value={v.cpaPixel} unit="$" term="cpaPixel" /></div>
                <div><p className="text-fg-muted">تكلفة المؤكد</p><Num value={v.costPerConfirmed} unit="$" term="costPerConfirmed" /></div>
                <div><p className="text-fg-muted">سقف التكبير</p><Num value={v.ceiling} unit="$" term="ceiling" /></div>
                <div><p className="text-fg-muted">الربح بعد المصاريف</p><Num value={v.profit} unit="$" term="profitDelivered" /></div>
                <div><p className="text-fg-muted">العائد الحقيقي</p><Num value={v.roas} unit="x" term="roas" /></div>
              </section>

              {!v.enoughData ? <p className="rounded-lg border border-dashed border-border p-2 text-sm text-fg-muted">بيانات غير كافية للحكم: بدها 3,000 ظهور وصرف ضعف هدف الطلب ({fmt(row.tOrder !== null ? row.tOrder * 2 : null, "$")}).</p> : null}
            </SheetBody>
            <SheetFooter>
              {row.status !== "paused" ? (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const r = await safeFetch("/api/objects/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objectType: row.level, objectId: row.id }) });
                    const d = (await r.json().catch(() => ({}))) as { error?: string; state?: string; demo?: boolean };
                    onClose();
                    if (!r.ok) toast(d.error ?? "صار خطأ", "error");
                    else if (d.demo) toast("بالوضع التجريبي ما انوقف شي فعلياً.", "info");
                    else mission({ title: "وقف ✓", detail: "انعمل قرار منفّذ بالسجل، وبترجعه من «المهام»" });
                  }}
                >
                  <Pause className="size-4" />
                  اوقف
                </Button>
              ) : null}
              {row.level !== "ad" && row.canScale ? (
                <Button onClick={() => void proposeRaise(row)}>
                  <TrendingUp className="size-4" />
                  اقترح زيادة
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
