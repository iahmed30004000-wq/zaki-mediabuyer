"use client";

import { useState } from "react";
import { ChevronDown, Printer, Send } from "lucide-react";
import { Delta } from "@/components/home/number-card";
import { Num } from "@/components/mb/num";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { GROUPS, STATS, costTone, type GroupKey, type NumbersSet, type ProductNumbers, type StatDef } from "@/core/numbers";
import type { TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import type { NumbersData } from "@/lib/numbers-view";

const URGENCY_ICON = { red: "🔴", orange: "🟠", yellow: "🟡" } as const;

/** One number: its value (with its «قاعدة الاحتساب» a tap away), coloured against the rules where the rules say so, and — with «قارن» on — against the window before and the 7-day average. */
function Stat({ def, set, prev, avg, compare, tone, prevLabel }: { def: StatDef; set: NumbersSet; prev: NumbersSet; avg: NumbersSet; compare: boolean; tone?: "ok" | "warn" | "danger"; prevLabel: string }) {
  const v = set[def.key];
  return (
    <div className="min-w-0 rounded-lg bg-surface-2/50 px-2.5 py-2">
      <p className="truncate text-[11px] text-fg-muted">{def.label}</p>
      <div className="mt-0.5 flex items-baseline gap-1">
        <Num value={v} unit={def.unit === "يوم" ? "" : def.unit} term={def.term as TermKey} tone={tone} />
        {def.unit === "يوم" && v !== null ? <span className="text-[11px] text-fg-muted">يوم</span> : null}
      </div>
      {compare ? (
        <div className="mt-1 space-y-0.5 whitespace-nowrap text-[10px] text-fg-muted">
          <div className="flex items-center justify-between gap-1">
            <span>{prevLabel}</span>
            <Delta now={v} base={prev[def.key]} good={def.good} />
          </div>
          <div className="flex items-center justify-between gap-1">
            <span title="معدّل آخر 7 أيام" aria-label="معدّل 7 أيام">7 أيام</span>
            <Delta now={v} base={avg[def.key]} good={def.good} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** All the numbers of one product (or of the total), in their eight groups. */
function Groups({ p, compare, target, prevLabel, only }: { p: Pick<ProductNumbers, "current" | "prev" | "avg7" | "breakeven" | "rejectReasons" | "offers" | "stockUrgency">; compare: boolean; target: number | null; prevLabel: string; only?: GroupKey[] }) {
  return (
    <div className="space-y-4">
      {GROUPS.filter((g) => !only || only.includes(g.key)).map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-fg-muted">
            {g.label}
            {g.key === "stock" && p.stockUrgency ? <span className="text-sm" title="🔴 أقل من 7 أيام · 🟠 7–10 · 🟡 10–14">{URGENCY_ICON[p.stockUrgency]}</span> : null}
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATS.filter((s) => s.group === g.key).map((s) => (
              <Stat
                key={s.key}
                def={s}
                set={p.current}
                prev={p.prev}
                avg={p.avg7}
                compare={compare}
                prevLabel={prevLabel}
                tone={s.key === "costPerOrder" ? costTone(p.current.costPerOrder, target, p.breakeven) : s.key === "gapPct" && p.current.gapPct !== null && Math.abs(p.current.gapPct) > 20 ? "warn" : undefined}
              />
            ))}
          </div>
          {g.key === "confirm" && p.rejectReasons.length ? (
            <p className="mt-1.5 text-xs text-fg-muted">أكتر أسباب الرفض: {p.rejectReasons.map((r) => `${r.reason} (${r.count})`).join(" · ")}</p>
          ) : null}
          {g.key === "offers" && p.offers.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {p.offers.map((o) => (
                <li key={o.offer} className="rounded-full bg-surface-2 px-2.5 py-1 text-fg">
                  {o.offer}: <span dir="ltr" className="font-semibold tabular-nums">{o.orders}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** The few numbers that must fit one phone screen without scrolling: spend, real orders, cost of a real order, confirmed, pieces shipped, expected profit. */
function Strip({ s, prev, avg, compare, tone, prevLabel }: { s: NumbersSet; prev: NumbersSet; avg: NumbersSet; compare: boolean; tone?: "ok" | "warn" | "danger"; prevLabel: string }) {
  const keys = ["spend", "ordersIn", "costPerOrder", "confirmed", "shippedPieces", "expectedProfit"] as const;
  return (
    <div className="grid grid-cols-3 gap-2" data-tour="totals">
      {keys.map((k) => (
        <Stat key={k} def={STATS.find((x) => x.key === k)!} set={s} prev={prev} avg={avg} compare={compare} prevLabel={prevLabel} tone={k === "costPerOrder" ? tone : undefined} />
      ))}
    </div>
  );
}

function ProductCard({ p, compare, target, prevLabel }: { p: ProductNumbers; compare: boolean; target: number | null; prevLabel: string }) {
  const [open, setOpen] = useState(false);
  const s = p.current;
  const tone = costTone(s.costPerOrder, target, p.breakeven);
  return (
    <Panel className="p-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-start sm:p-4">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg">{p.name}</span>
            <span dir="ltr" className="font-mono text-[11px] text-fg-muted">{p.code}</span>
            {p.stockUrgency ? <span title="المخزون">{URGENCY_ICON[p.stockUrgency]}</span> : null}
          </span>
          <span className="mt-1 grid grid-cols-4 gap-2 text-[11px]">
            {([["الصرف", s.spend, "$"], ["الطلبات", s.ordersIn, ""], ["تكلفة الطلب", s.costPerOrder, "$"], ["تأكيد", s.confirmRate, "%"]] as const).map(([l, v, u]) => (
              <span key={l} className="min-w-0">
                <span className="block truncate text-fg-muted">{l}</span>
                <span dir="ltr" className={cn("font-semibold tabular-nums", l === "تكلفة الطلب" && tone === "ok" && "text-ok", l === "تكلفة الطلب" && tone === "warn" && "text-warn", l === "تكلفة الطلب" && tone === "danger" && "text-danger", !(l === "تكلفة الطلب" && tone) && "text-fg")}>
                  {v === null ? "—" : `${u === "$" ? Number(v).toFixed(2) : u === "%" ? Number(v).toFixed(1) : Math.round(Number(v))}${u === "$" ? "$" : u}`}
                </span>
              </span>
            ))}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t border-border p-3 sm:p-4">
          <Groups p={p} compare={compare} target={target} prevLabel={prevLabel} />
        </div>
      ) : null}
    </Panel>
  );
}

/** «شارك»: the day as a phone-friendly PDF (the print page — «احفظ كـ PDF») and as a summary on Telegram. */
function Share({ query }: { query: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function telegram() {
    setBusy(true);
    try {
      const r = await fetch(`/api/numbers/share?${query}`, { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما انبعت شي" : "انبعت الملخص على تيليجرام ✓", d.demo ? "info" : "success");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-9">
        <Send className="size-3.5" />
        شارك
      </Button>
      {open ? (
        <div className="absolute end-0 top-full z-30 mt-2 w-60 space-y-1.5 rounded-xl border border-border bg-surface-1 p-2 shadow-card">
          <a href={`/print/numbers?${query}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-fg hover:bg-surface-2">
            <Printer className="size-4" /> PDF — صفحة للطباعة والحفظ
          </a>
          <button type="button" disabled={busy} onClick={telegram} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm text-fg hover:bg-surface-2 disabled:opacity-50">
            <Send className="size-4" /> ملخص على تيليجرام
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «الأرقام»: every number of the day. The totals strip first (one phone screen), then a card per product — collapsed until
 * tapped. «قارن» puts each number beside yesterday's and the 7-day average. Every figure explains itself with a tap.
 */
export function NumbersView({ data, query }: { data: NumbersData; query: string }) {
  const [compare, setCompare] = useState(false);
  const [all, setAll] = useState(false);
  // Short on purpose: it sits in a ~110px tile on a phone, next to its arrow and percentage.
  const prevLabel = data.range.days === 1 ? (data.range.key === "today" ? "أمس" : "قبله") : "قبلها";
  const { current, prev, avg7 } = data.totals;
  const tone = costTone(current.costPerOrder, data.target, null);
  const total = { current, prev, avg7, breakeven: null, rejectReasons: data.products.flatMap((p) => p.rejectReasons), offers: [], stockUrgency: null };

  return (
    <div className="space-y-4">
      {data.demo ? <p className="rounded-lg border border-dashed border-warn/50 bg-warn/5 p-3 text-xs leading-5 text-warn">بيانات تجريبية — أرقام مثال بنفس الحسابات. لما يبعت Claude أرقامك (أو ينربط الـ OMS وميتا) وتشغّل الموقع على الحقيقي، بتطلع أرقامك الفعلية.</p> : null}
      <div className="flex flex-wrap items-center gap-3" data-tour="toolbar">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-[var(--accent,#2563eb)]" />
          قارن
        </label>
        <span className="text-xs text-fg-muted">{data.label}</span>
        <span className="ms-auto">
          <Share query={query} />
        </span>
      </div>

      <section aria-label="الإجمالي" className="space-y-2">
        <h3 className="text-sm font-bold text-fg">الإجمالي</h3>
        <Strip s={current} prev={prev} avg={avg7} compare={compare} tone={tone} prevLabel={prevLabel} />
        {compare ? (
          // Under the strip, not above it: the strip is the part that has to stay on the first phone screen.
          <p className="text-[11px] leading-4 text-fg-muted">
            كل رقم مقابل {data.range.days === 1 ? (data.range.key === "today" ? "أمس" : "اليوم اللي قبله") : "الفترة اللي قبلها"} («{prevLabel}») ومقابل معدّل آخر 7 أيام («7 أيام»). السهم الأخضر = أحسن، الأحمر = أسوأ.
          </p>
        ) : null}
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-xs font-medium text-accent hover:underline">
          {all ? "سكّر أرقام الإجمالي" : "كل أرقام الإجمالي"}
        </button>
        {all ? (
          <Panel>
            <Groups p={total} compare={compare} target={data.target} prevLabel={prevLabel} />
          </Panel>
        ) : null}
      </section>

      <section aria-label="المنتجات" className="space-y-2" data-tour="products">
        <h3 className="text-sm font-bold text-fg">المنتجات</h3>
        {data.products.map((p) => (
          <ProductCard key={p.code} p={p} compare={compare} target={data.target} prevLabel={prevLabel} />
        ))}
        {!data.products.length ? <Panel className="text-sm text-fg-muted">ما في أرقام للفترة هاي لسا. أول ما يبعتها Claude (أو ينربط الـ OMS وميتا) بتطلع هون.</Panel> : null}
      </section>

      {data.rulesMissing && !data.demo ? <p className="rounded-lg border border-border bg-surface-1 p-3 text-xs leading-5 text-fg-muted">الألوان (أخضر / برتقالي / أحمر) بتحتاج «الهدف» و«نقطة التعادل» من <a href="/settings#campaign-rules" className="font-medium text-accent hover:underline">قواعد الحملات</a> — لسا ناقصة.</p> : null}
    </div>
  );
}
