"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Pause, Plus, Tag, TrendingUp } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/card";
import { Num, fmt } from "@/components/mb/num";
import { Panel } from "@/components/mb/section";
import { useMission } from "@/components/mb/mission";
import type { RowStatus, RowView } from "@/lib/mock/data";
import { cn } from "@/lib/utils";
import { LaunchWizard } from "./launch-wizard";
import type { ExperimentView, LaunchOptions } from "@/lib/launch-view";

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
            <span dir="ltr" className="font-mono text-xs text-fg-muted">{e.campaign}</span>
            <span className={cn("ms-auto text-xs font-medium", EXP_STATUS[e.status].c)}>
              {EXP_STATUS[e.status].l}
              {e.status === "running" ? ` · يوم ${e.day} من ${e.days}` : ""}
            </span>
          </div>
          <p className="text-xs text-fg-muted">الفرضية: {e.hypothesis}</p>
          {e.arms.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
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
                      <td dir="ltr" className="py-1 text-start font-mono">{a.key}</td>
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
          <p className="text-sm text-fg">{e.verdict}</p>
        </Panel>
      ))}
    </div>
  );
}

export interface TreeRow {
  id: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  status: RowStatus;
  note?: string;
  product: { code: string; name: string } | null;
  market: string;
  decoded: string[] | null;
  needsNaming?: boolean;
  learning?: { events: number; of: number };
  budget?: number;
  counts?: { impressions: number; clicks: number; orders: number; confirmed: number; delivered: number; conversations: number | null };
  view: RowView;
  tOrder: number | null;
  children: TreeRow[];
}

interface ProductRow {
  code: string;
  name: string;
  market: string;
  stockDays: number;
  view: RowView;
  targets: { tOrder: number; tConfirmed: number; margin: number; losing: boolean; estimated: boolean };
}

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  active: { label: "شغّال", cls: "bg-ok/10 text-ok" },
  learning: { label: "بيتعلّم", cls: "bg-info/10 text-info" },
  paused: { label: "موقوف", cls: "bg-surface-2 text-fg-muted" },
  untested: { label: "لم يُختبر", cls: "border border-dashed border-border text-fg-muted" },
  rejected: { label: "مرفوض", cls: "bg-danger/10 text-danger" },
};

export function StatusChip({ status }: { status: RowStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", s.cls)}>{s.label}</span>;
}

/** The double cell (spec 18.3): Meta's CPA beside the true cost per confirmed, and the gap as an arrow. */
function DoubleCell({ v }: { v: RowView }) {
  const over = v.costPerConfirmed !== null && v.ceiling !== null && v.costPerConfirmed > v.ceiling;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Num value={v.cpaPixel} unit="$" term="cpaPixel" />
      <Num value={v.costPerConfirmed} unit="$" term="costPerConfirmed" tone={v.costPerConfirmed === null ? undefined : over ? "warn" : "ok"} />
      {v.gap !== null ? (
        <span className={cn("inline-flex items-center text-[11px] tabular-nums", Math.abs(v.gap) > 20 ? "text-warn" : "text-fg-muted")} title="فرق ميتا/حقيقي" dir="ltr">
          {v.gap > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          {Math.abs(v.gap)}%
        </span>
      ) : null}
    </span>
  );
}

const TABS = [
  { key: "campaigns", label: "حسب الحملة" },
  { key: "products", label: "حسب المنتج" },
  { key: "tests", label: "الاختبارات" },
] as const;

export function AdsView({ rows, products, initialTab, openId, productFilter, launchOptions, experiments }: { rows: TreeRow[]; products: ProductRow[]; initialTab: string; openId?: string; productFilter?: string; launchOptions: LaunchOptions; experiments: ExperimentView[] }) {
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab : "campaigns");
  const [market, setMarket] = useState<string>("all");
  const [onlyNaming, setOnlyNaming] = useState(initialTab === "naming");
  const flat = useMemo(() => rows.flatMap((c) => [c, ...c.children, ...c.children.flatMap((s) => s.children)]), [rows]);
  const [open, setOpen] = useState<TreeRow | null>(() => flat.find((r) => r.id === openId) ?? null);
  const [launch, setLaunch] = useState(false);

  const shown = rows.filter((r) => (market === "all" || r.market === market) && (!onlyNaming || r.needsNaming) && (!productFilter || r.product?.code === productFilter));
  const namingCount = rows.filter((r) => r.needsNaming).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" data-tour="tabs" className="inline-flex rounded-lg border border-border bg-surface-1 p-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn("min-h-9 rounded-md px-3 text-sm font-medium", tab === t.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
              {t.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setLaunch(true)} data-tour="launch" className="ms-auto min-h-10">
          <Plus className="size-4" />
          إطلاق
        </Button>
      </div>

      {tab === "campaigns" ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {[{ k: "all", l: "كل الأسواق" }, { k: "SY", l: "سوريا" }, { k: "JO", l: "الأردن" }].map((m) => (
              <button key={m.k} onClick={() => setMarket(m.k)} className={cn("min-h-8 rounded-full border px-3", market === m.k ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
                {m.l}
              </button>
            ))}
            {namingCount ? (
              <button onClick={() => setOnlyNaming((v) => !v)} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-3", onlyNaming ? "border-warn bg-warn/10 text-warn" : "border-border text-fg-muted")}>
                <Tag className="size-3.5" />
                بدها تسمية ({namingCount})
              </button>
            ) : null}
          </div>
          <div data-tour="tree" className="space-y-3">
            {shown.length ? shown.map((c) => <CampaignBlock key={c.id} row={c} onOpen={setOpen} />) : <EmptyState title="ما في حملات بهالفلتر" hint="غيّر السوق أو شيل فلتر التسمية." art="empty-ads" />}
          </div>
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

function CampaignBlock({ row, onOpen }: { row: TreeRow; onOpen: (r: TreeRow) => void }) {
  const [expanded, setExpanded] = useState(row.status !== "paused");
  return (
    <Panel className="p-0">
      <div className="flex items-start gap-2 p-3 sm:p-4">
        <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} aria-label="افتح/سكّر" className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2">
          <ChevronDown className={cn("size-4 transition-transform", !expanded && "-rotate-90 rtl:rotate-90")} />
        </button>
        <RowBody row={row} onOpen={onOpen} big />
      </div>
      {expanded ? (
        <div className="border-t border-border">
          {row.children.map((s) => (
            <div key={s.id} className="border-b border-border last:border-b-0">
              <div className="flex items-start gap-2 bg-surface-2/40 px-3 py-2.5 ps-10 sm:px-4 sm:ps-12">
                <RowBody row={s} onOpen={onOpen} />
              </div>
              {s.children.map((a) => (
                <div key={a.id} className="flex items-start gap-2 border-t border-border/60 px-3 py-2.5 ps-14 sm:px-4 sm:ps-20">
                  <RowBody row={a} onOpen={onOpen} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function RowBody({ row, onOpen, big = false }: { row: TreeRow; onOpen: (r: TreeRow) => void; big?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-4">
      <button onClick={() => onOpen(row)} className="min-w-0 flex-1 text-start">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip status={row.status} />
          {row.needsNaming ? <span className="rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn">بدها تسمية</span> : null}
          <span dir="ltr" className={cn("truncate font-mono text-fg hover:text-accent", big ? "text-sm font-semibold" : "text-xs")}>{row.name}</span>
        </span>
        {row.decoded ? <span className="mt-0.5 block truncate text-xs text-fg-muted">{row.decoded.join(" · ")}</span> : null}
        {row.note ? <span className="mt-0.5 block text-xs text-warn">{row.note}</span> : null}
      </button>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Num value={row.view.spend} unit="$" term="spend" />
        <DoubleCell v={row.view} />
        <span className="text-fg-muted">
          مؤكد <span className="font-semibold tabular-nums text-fg">{row.view.confirmed}</span>
          {row.view.open > 0 ? <span className="text-fg-muted"> · {row.view.open} مفتوح</span> : null}
        </span>
      </div>
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
              <span dir="ltr" className="font-mono text-xs text-fg-muted">{p.code}</span>
              <span className="text-xs text-fg-muted">· {p.market === "SY" ? "سوريا" : "الأردن"}</span>
              <span className={cn("ms-auto rounded-md px-1.5 py-0.5 text-[11px] font-semibold", winner ? "bg-ok/10 text-ok" : p.view.delivered ? "bg-warn/10 text-warn" : "bg-surface-2 text-fg-muted")}>
                {winner ? "رابح" : p.view.delivered ? "خاسر لهلأ" : "بيانات غير كافية"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <div><dt className="text-fg-muted">الصرف</dt><dd><Num value={p.view.spend} unit="$" term="spend" /></dd></div>
              <div><dt className="text-fg-muted">تكلفة المؤكد</dt><dd><Num value={p.view.costPerConfirmed} unit="$" term="costPerConfirmed" /></dd></div>
              <div><dt className="text-fg-muted">السقف</dt><dd><Num value={p.view.ceiling} unit="$" term="ceiling" /></dd></div>
              <div><dt className="text-fg-muted">التأكيد</dt><dd><Num value={p.view.confirmRate} unit="%" term="confirmRate" /></dd></div>
              <div><dt className="text-fg-muted">التسليم</dt><dd><Num value={p.view.deliveryRate} unit="%" term="deliveryRate" /></dd></div>
              <div><dt className="text-fg-muted">ربح المُسلَّم</dt><dd><Num value={p.view.profitPerDelivered} unit="$" term="profitDelivered" tone={winner ? "ok" : undefined} /></dd></div>
            </dl>
            <p className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-fg-muted">
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
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {row && v ? (
          <>
            <SheetHeader>
              <SheetTitle dir="ltr" className="text-start font-mono text-sm">{row.name}</SheetTitle>
              <SheetDescription>{row.decoded ? row.decoded.join(" · ") : "الاسم ما انفهم — بدها تسمية من الإعدادات أو من هون."}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={row.status} />
                {row.learning ? (
                  <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-[11px] font-semibold text-info">
                    تعلّم {row.learning.events} من {row.learning.of}
                  </span>
                ) : null}
                {row.budget ? <span className="text-xs text-fg-muted">الميزانية {fmt(row.budget, "$", 0)} / يوم</span> : null}
              </div>
              {row.note ? <p className="rounded-lg bg-warn/10 p-2 text-sm text-warn">{row.note}</p> : null}

              {funnel ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-fg-muted">القمع</h3>
                  <ol className="space-y-1.5">
                    {funnel.map((f, i) => {
                      const max = funnel[0]!.n || 1;
                      return (
                        <li key={f.l} className="flex items-center gap-2 text-xs">
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

              <section className="grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-fg-muted">Hook</p><Num value={v.hook} unit="%" term="hook" /></div>
                <div><p className="text-fg-muted">Hold</p><Num value={v.hold} unit="%" term="hold" /></div>
                <div><p className="text-fg-muted">CTR</p><Num value={v.ctr} unit="%" term="ctr" /></div>
                <div><p className="text-fg-muted">CPA بكسل</p><Num value={v.cpaPixel} unit="$" term="cpaPixel" /></div>
                <div><p className="text-fg-muted">تكلفة المؤكد</p><Num value={v.costPerConfirmed} unit="$" term="costPerConfirmed" /></div>
                <div><p className="text-fg-muted">سقف التكبير</p><Num value={v.ceiling} unit="$" term="ceiling" /></div>
                <div><p className="text-fg-muted">الربح بعد المصاريف</p><Num value={v.profit} unit="$" term="profitDelivered" /></div>
                <div><p className="text-fg-muted">العائد الحقيقي</p><Num value={v.roas} unit="x" term="roas" /></div>
              </section>

              {!v.enoughData ? <p className="rounded-lg border border-dashed border-border p-2 text-xs text-fg-muted">بيانات غير كافية للحكم: بدها 3,000 ظهور وصرف ضعف هدف الطلب ({fmt(row.tOrder !== null ? row.tOrder * 2 : null, "$")}).</p> : null}
            </SheetBody>
            <SheetFooter>
              {row.status !== "paused" ? (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const r = await fetch("/api/objects/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objectType: row.level, objectId: row.id }) });
                    const d = (await r.json().catch(() => ({}))) as { error?: string; state?: string };
                    onClose();
                    if (!r.ok) toast(d.error ?? "صار خطأ", "error");
                    else mission({ title: "وقف ✓", detail: "انعمل قرار منفّذ بالسجل، وبترجعه من «القرارات»" });
                  }}
                >
                  <Pause className="size-4" />
                  اوقف
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  onClose();
                  toast("انضاف اقتراح زيادة لـ «القرارات ← بانتظارك» مع أثره المالي.", "success");
                }}
              >
                <TrendingUp className="size-4" />
                اقترح زيادة
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
