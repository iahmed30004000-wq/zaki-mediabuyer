"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Delta } from "@/components/home/number-card";
import { SourceBadge } from "@/components/mb/num";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { COLUMNS, DEFAULT_COLUMNS, filterTree, filtersActive, type ColumnDef, type ColumnKey, type Filters } from "@/core/ads-table";
import { costTone } from "@/core/numbers";
import { fmt } from "@/lib/format";
import { GLOSSARY, SOURCE_HINT, type TermKey } from "@/lib/glossary";
import type { AdsTableData, TableRow } from "@/lib/ads-table";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";
import { productVerdict } from "@/core/verdict";
import { STATUS_LABEL, StatusChip } from "./status-chip";

const DEF = new Map(COLUMNS.map((c) => [c.key, c]));
const WIDTH: Partial<Record<ColumnKey, string>> = { name: "min-w-[15rem] max-w-[19rem]", product: "min-w-[7rem]", spendTY: "min-w-[8rem]", costPerOrder: "min-w-[7.5rem]", profit: "min-w-[6.5rem]" };
const TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** Writes the filters into the address (so Back, a refresh and a shared link keep them) without asking the server again. */
function writeFilters(f: Filters) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries({ product: f.product, page: f.page, market: f.market, kind: f.kind && f.kind !== "all" ? f.kind : null, status: f.status })) (v ? q.set(k, v) : q.delete(k));
  window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
}

function Thumb({ code }: { code: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/creatives/${encodeURIComponent(code)}/thumb/1`} alt="" loading="lazy" onError={() => setBad(true)} className="size-8 shrink-0 rounded-md bg-surface-2 object-cover" />;
}

/** One cell of the table. Numbers read the row's own metrics; «قارن» puts the window before's change under each. */
function Cell({ def, row, compare, target }: { def: ColumnDef; row: TableRow; compare: boolean; target: number | null }) {
  const dash = <span className="text-fg-muted">—</span>;
  if (def.metric) {
    const v = row.m[def.metric];
    const tone = def.key === "costPerOrder" ? costTone(v, target, row.breakeven) : undefined;
    return (
      <div className="flex flex-col gap-0.5">
        <span dir="ltr" className={cn("tabular-nums font-semibold", tone ? TONE[tone] : "text-fg")}>{v === null ? "—" : fmt(v, def.unit)}</span>
        {compare ? <Delta now={v} base={row.prev[def.metric]} good={def.good} /> : null}
      </div>
    );
  }
  switch (def.key) {
    case "verdict": {
      // the verdict of the row's cost against the owner's target and break-even — shown, never decided here
      const v = productVerdict(row.m.costPerOrder, target, row.breakeven);
      return <Pill tone={v.tone}>{v.label}</Pill>;
    }
    case "product":
      return row.product ? <span className="block truncate text-fg" title={row.product.code}>{row.product.name}</span> : dash;
    case "page":
      return row.pages.length ? <span dir="ltr" className="font-mono text-fg">{row.pages.join(" · ")}</span> : dash;
    case "status":
      return <StatusChip status={row.status} />;
    case "days":
      return row.days === null ? dash : <span dir="ltr" className="tabular-nums text-fg">{row.days}</span>;
    case "budget":
      return row.budget === undefined ? dash : <span dir="ltr" className="tabular-nums text-fg">{fmt(row.budget, "$", 0)}</span>;
    case "spendTY":
      return (
        <div className="flex flex-col gap-0.5">
          <span dir="ltr" className="tabular-nums text-fg">
            <span className="font-semibold">{row.spendToday === null ? "—" : fmt(row.spendToday, "$")}</span>
            <span className="text-fg-muted"> / {row.spendYesterday === null ? "—" : fmt(row.spendYesterday, "$")}</span>
          </span>
          {compare ? <Delta now={row.spendToday} base={row.spendYesterday} good="none" /> : null}
        </div>
      );
    case "adsCount":
      return row.adsCount === null ? dash : <span dir="ltr" className="tabular-nums text-fg">{row.adsCount}</span>;
    default:
      return dash;
  }
}

/** The name cell: the chevron that opens what is under it, the thumbnail of an ad, the name, what the name says. */
function NameCell({ row, depth, hasKids, open, onToggle, onOpen }: { row: TableRow; depth: number; hasKids: boolean; open: boolean; onToggle: () => void; onOpen: (r: TableRow) => void }) {
  return (
    <div className="flex items-start gap-1.5">
      {hasKids ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "سكّر" : "افتح"} className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2">
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
        </button>
      ) : (
        <span className="w-7 shrink-0" />
      )}
      {depth === 2 && row.creativeCode ? <Thumb code={row.creativeCode} /> : null}
      <button type="button" onClick={() => onOpen(row)} className="min-w-0 flex-1 text-start">
        <span className="flex items-center gap-1.5">
          {row.needsNaming ? <span className="shrink-0 rounded-md bg-warn/10 px-1 py-0.5 text-[10px] font-semibold text-warn">بدها تسمية</span> : null}
          <span dir="ltr" className={cn("block truncate font-mono text-fg hover:text-accent", depth === 0 ? "text-[13px] font-semibold" : "text-xs")}>{row.name}</span>
        </span>
        {row.decoded ? <span className="block truncate text-[11px] text-fg-muted">{row.decoded.join(" · ")}</span> : null}
        {depth === 2 && row.codes ? <span dir="ltr" className="block truncate font-mono text-[10px] text-fg-muted">{row.codes}</span> : null}
        {row.note ? <span className="block truncate text-[11px] text-warn">{row.note}</span> : null}
      </button>
    </div>
  );
}

/** «قاعدة الاحتساب» of a column: its name, the exact formula, what to do with it, where the number comes from. */
function HelpSheet({ def, onClose }: { def: ColumnDef | null; onClose: () => void }) {
  const t = def?.term ? GLOSSARY[def.term as TermKey] : undefined;
  return (
    <Sheet open={!!def && !!t} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {def && t ? (
          <>
            <SheetHeader>
              <SheetTitle>{t.name}</SheetTitle>
              <SheetDescription>قاعدة الاحتساب</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-3">
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg">{t.formula}</p>
              <p className="text-sm leading-6 text-fg">{t.meaning}</p>
              <p className="flex items-start gap-2 text-xs leading-5 text-fg-muted">
                <SourceBadge source={t.source} />
                {SOURCE_HINT[t.source]}
              </p>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Which columns, in which order. Saved for the person at once (the phone and the desktop show the same table). */
function ColumnPicker({ open, onOpenChange, cols, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; cols: ColumnKey[]; onChange: (c: ColumnKey[]) => void }) {
  const off = COLUMNS.filter((c) => !cols.includes(c.key));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (i < 1 || j < 1 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>الأعمدة</SheetTitle>
          <SheetDescription>اختار شو بدك تشوف وبأي ترتيب. اختيارك بينحفظ إلك لحالك.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <ul className="space-y-1">
            {cols.map((k, i) => {
              const d = DEF.get(k)!;
              return (
                <li key={k} className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-2 py-1.5">
                  <input type="checkbox" checked disabled={k === "name"} onChange={() => onChange(cols.filter((x) => x !== k))} aria-label={d.label} className="size-4 accent-[var(--accent,#2563eb)]" />
                  <span className="flex-1 text-sm text-fg">{d.label}</span>
                  {k !== "name" ? (
                    <>
                      <button type="button" onClick={() => move(i, -1)} disabled={i < 2} aria-label="فوق" className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 disabled:opacity-30">
                        <ArrowUp className="size-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i >= cols.length - 1} aria-label="تحت" className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 disabled:opacity-30">
                        <ArrowDown className="size-4" />
                      </button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {off.length ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-fg-muted">أعمدة تانية</p>
              <ul className="space-y-1">
                {off.map((d) => (
                  <li key={d.key} className="flex items-center gap-2 px-2 py-1">
                    <input type="checkbox" checked={false} onChange={() => onChange([...cols, d.key])} aria-label={d.label} className="size-4 accent-[var(--accent,#2563eb)]" />
                    <span className="text-sm text-fg">{d.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={() => onChange([...DEFAULT_COLUMNS])}>
            <RotateCcw className="size-4" />
            الافتراضي
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const select = "min-h-9 shrink-0 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg";

/** The test-share gauge: how much of the spend went into tests, against the limit. */
function Gauge({ share }: { share: AdsTableData["share"] }) {
  const pct = share.share === null ? null : Math.round(share.share * 100);
  const limit = Math.round(share.limit * 100);
  return (
    <div data-tour="share" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs">
      <span className="font-semibold text-fg">حصة الاختبارات</span>
      <span className="relative h-2 w-32 shrink-0 rounded-full bg-surface-2" role="img" aria-label={pct === null ? "ما في صرف" : `${pct}% من الصرف، الحد ${limit}%`}>
        <span className={cn("absolute inset-y-0 start-0 rounded-full", share.over ? "bg-danger" : "bg-accent")} style={{ width: `${Math.min(100, (share.share ?? 0) * 100)}%` }} />
        <span className="absolute -inset-y-0.5 w-0.5 rounded bg-fg/60" style={{ insetInlineStart: `${Math.min(100, limit)}%` }} />
      </span>
      <span dir="ltr" className={cn("tabular-nums font-semibold", share.over ? "text-danger" : "text-fg")}>{pct === null ? "—" : `${pct}%`} / {limit}%</span>
      {share.over ? <span className="text-danger">الاختبارات أخدت أكتر من حصتها — الصرف الكبير بينحرق عليها</span> : null}
    </div>
  );
}

/**
 * «الإعلانات»: one table, campaign → ad set → ad inline. The columns are the person's own (saved), the filters live in the
 * address, «قارن» sets each number beside the window before, and every header explains how its number is made.
 */
export function AdsTable({ data, initialColumns, initialFilters, onOpen }: { data: AdsTableData; initialColumns: ColumnKey[]; initialFilters: Filters; onOpen: (row: TableRow) => void }) {
  const { toast } = useToast();
  const [cols, setCols] = useState<ColumnKey[]>(initialColumns);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [compare, setCompare] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState(false);
  const [help, setHelp] = useState<ColumnDef | null>(null);

  const active = filtersActive(filters);
  const shown = useMemo(() => filterTree(data.rows, filters), [data.rows, filters]);
  const namingCount = data.rows.filter((r) => r.needsNaming).length;
  const defs = cols.map((k) => DEF.get(k)!).filter(Boolean);

  const lines = useMemo(() => {
    const out: { row: TableRow; depth: 0 | 1 | 2; hasKids: boolean; open: boolean }[] = [];
    // campaigns that run show their ad sets; a filter opens everything so a match is never hidden
    const isOpen = (r: TableRow, depth: number) => open[r.id] ?? (active ? true : depth === 0 ? r.status !== "paused" : false);
    for (const c of shown) {
      const co = isOpen(c, 0);
      out.push({ row: c, depth: 0, hasKids: c.children.length > 0, open: co });
      if (!co) continue;
      for (const s of c.children) {
        const so = isOpen(s, 1);
        out.push({ row: s, depth: 1, hasKids: s.children.length > 0, open: so });
        if (so) for (const a of s.children) out.push({ row: a, depth: 2, hasKids: false, open: false });
      }
    }
    return out;
  }, [shown, open, active]);

  const setF = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    writeFilters(next);
  };

  async function saveColumns(next: ColumnKey[]) {
    setCols(next);
    const r = await fetch("/api/ads/columns", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ columns: next }) }).catch(() => null);
    if (!r || !r.ok) toast("ما انحفظ اختيار الأعمدة — بيضل لهالجلسة بس", "error");
  }

  return (
    <div className="space-y-3">
      {data.demo ? <p className="rounded-lg border border-dashed border-warn/50 bg-warn/5 p-3 text-xs leading-5 text-warn">بيانات تجريبية — أرقام مثال بنفس الحسابات. لما يبعت Claude أرقامك (أو ينربط ميتا والـ OMS) وتشغّل الموقع على الحقيقي، بتطلع حملاتك الفعلية.</p> : null}

      <Gauge share={data.share} />

      {/* one scrollable row on a phone (the table must stay near the top), wrapped from sm up */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-tour="filters">
        <select aria-label="المنتج" value={filters.product ?? ""} onChange={(e) => setF({ product: e.target.value || null })} className={select}>
          <option value="">كل المنتجات</option>
          {data.products.map((p) => (
            <option key={p.code} value={p.code}>{p.name}</option>
          ))}
        </select>
        <select aria-label="الصفحة" value={filters.page ?? ""} onChange={(e) => setF({ page: e.target.value || null })} className={select}>
          <option value="">كل الصفحات</option>
          {data.pages.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select aria-label="اختبار أو تكبير" value={filters.kind ?? "all"} onChange={(e) => setF({ kind: e.target.value as Filters["kind"] })} className={select}>
          <option value="all">اختبار وتكبير</option>
          <option value="test">اختبارات</option>
          <option value="scale">تكبير</option>
        </select>
        <select aria-label="السوق" value={filters.market ?? ""} onChange={(e) => setF({ market: e.target.value || null })} className={select}>
          <option value="">كل الأسواق</option>
          <option value="SY">سوريا</option>
          <option value="JO">الأردن</option>
        </select>
        <select aria-label="الحالة" value={filters.status ?? ""} onChange={(e) => setF({ status: e.target.value || null })} className={select}>
          <option value="">كل الحالات</option>
          {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
          {namingCount ? <option value="naming">بدها تسمية ({namingCount})</option> : null}
        </select>
        {active ? (
          <button type="button" onClick={() => setF({ product: null, page: null, kind: "all", status: null, market: null })} className="min-h-9 shrink-0 whitespace-nowrap rounded-lg px-2 text-sm text-accent hover:underline">
            شيل الفلاتر
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-[var(--accent,#2563eb)]" />
          قارن
        </label>
        <Button variant="secondary" size="sm" onClick={() => setPicker(true)} className="ms-auto min-h-9">
          <SlidersHorizontal className="size-3.5" />
          الأعمدة
        </Button>
      </div>
      {compare ? <p className="text-[11px] leading-4 text-fg-muted">كل رقم مقابل {data.range.days === 1 ? (data.range.key === "today" ? "أمس" : "اليوم اللي قبله") : "الفترة اللي قبلها"}. السهم الأخضر = أحسن، الأحمر = أسوأ. الصرف مقابل أمس.</p> : null}

      {lines.length ? (
        <div data-tour="tree" className="overflow-x-auto rounded-card border border-border bg-surface-1">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-fg-muted">
                {defs.map((d) => (
                  <th key={d.key} scope="col" className={cn("whitespace-nowrap bg-surface-2 px-3 py-2 text-start font-medium", WIDTH[d.key], d.key === "name" && "sticky start-0 z-20")}>
                    <span className="inline-flex items-center gap-1">
                      {d.label}
                      {d.term ? (
                        <button type="button" onClick={() => setHelp(d)} aria-label={`قاعدة احتساب ${d.label}`} className="inline-flex size-5 items-center justify-center rounded text-fg-muted/70 hover:text-accent">
                          <Info className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(({ row, depth, hasKids, open: isOpen }) => {
                const bg = depth === 1 ? "bg-surface-2" : "bg-surface-1";
                return (
                  <tr key={row.id} className={cn("border-b border-border/60 last:border-b-0", bg)}>
                    {defs.map((d) =>
                      d.key === "name" ? (
                        <td key={d.key} className={cn("sticky start-0 z-10 py-2 pe-3", bg, WIDTH.name)} style={{ paddingInlineStart: `${8 + depth * 14}px` }}>
                          <NameCell row={row} depth={depth} hasKids={hasKids} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [row.id]: !isOpen }))} onOpen={onOpen} />
                        </td>
                      ) : (
                        <td key={d.key} className={cn("whitespace-nowrap px-3 py-2 align-top", WIDTH[d.key])}>
                          <Cell def={d} row={row} compare={compare} target={data.target} />
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={active ? "ما في شي بهالفلاتر" : "ما في حملات لسا"} hint={active ? "غيّر الفلاتر أو شيلها." : "أول ما يبعت Claude أرقامك (أو ينربط ميتا) بتطلع هون."} art="empty-ads" />
      )}

      {data.rulesMissing && !data.demo ? (
        <p className="rounded-lg border border-border bg-surface-1 p-3 text-xs leading-5 text-fg-muted">
          لون «تكلفة الطلب الحقيقي» (أخضر / برتقالي / أحمر) بدّه «الهدف» و«نقطة التعادل» من <a href="/settings/rules#campaign-rules" className="font-medium text-accent hover:underline">قواعد الحملات</a> — لسا ناقصة.
        </p>
      ) : null}

      <ColumnPicker open={picker} onOpenChange={setPicker} cols={cols} onChange={saveColumns} />
      <HelpSheet def={help} onClose={() => setHelp(null)} />
    </div>
  );
}
