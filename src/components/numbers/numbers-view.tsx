"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Printer, Send } from "lucide-react";
import { PasteNumbers } from "./paste-numbers";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ProductName } from "@/components/ui/product-name";
import { SectionTitle } from "@/components/ui/section-title";
import { useToast } from "@/components/ui/toast";
import { WasNow } from "@/components/ui/was-now";
import { statDelta, statMissing } from "@/core/compare";
import { productHref } from "@/core/markets";
import { badgeAfter } from "@/core/freshness";
import { GROUPS, STATS, costTone, type GroupKey, type NumbersSet, type ProductNumbers, type StatDef } from "@/core/numbers";
import type { SourceFacts } from "@/core/numbers-readiness";
import { productVerdict } from "@/core/verdict";
import type { TermKey } from "@/lib/glossary";
import { GLOSSARY } from "@/lib/glossary";
import { safeFetch } from "@/lib/call";
import { fmt } from "@/lib/format";
import type { NumbersData } from "@/lib/numbers-view";
import { Tap } from "@/components/ui/tap";

const URGENCY_WORD = { red: "المخزون أحمر", orange: "المخزون برتقالي", yellow: "المخزون أصفر" } as const;

/** Decimals a number is written with: the days of cover have one, everything else the usual writing of its unit. */
const digitsOf = (def: StatDef): number | undefined => (def.unit === "يوم" ? 1 : undefined);

/**
 * ONE of the 31 numbers as a «كنا ← صرنا» tile (v6 · P6): its value in the window, the value in the window before it, the difference in words — always shown, there is no «قارن» box any more. The words and
 * the colour come from `statDelta` (the good direction of THIS number, not the sign); a missing number says why (`statMissing`); the badge «حقيقي» becomes «تقدير» while the OMS is silent.
 */
export function StatTile({ def, set, prev, facts, tone }: { def: StatDef; set: NumbersSet; prev: NumbersSet; facts: SourceFacts; tone?: "ok" | "warn" | "danger" | undefined }) {
  const now = set[def.key];
  const was = prev[def.key];
  const d = statDelta(def, now, was);
  const unit = def.unit === "يوم" ? "" : def.unit;
  const term = def.term as TermKey;
  return (
    <WasNow
      label={def.unit === "يوم" ? `${def.label} (يوم)` : def.label}
      now={now}
      was={was}
      unit={unit}
      term={term}
      source={badgeAfter(GLOSSARY[term]?.source, facts)}
      delta={d}
      missing={now === null ? statMissing(def.group, set, facts) : null}
      digits={digitsOf(def)}
      tone={tone}
    />
  );
}

/** All the numbers of one product (or of the total), in their eight groups — each a tile with its «كنا» and its difference. */
export function Groups({ p, facts, target, only }: { p: Pick<ProductNumbers, "current" | "prev" | "breakeven" | "rejectReasons" | "offers" | "stockUrgency">; facts: SourceFacts; target: number | null; only?: GroupKey[] }) {
  return (
    <div className="space-y-5">
      {GROUPS.filter((g) => !only || only.includes(g.key)).map((g) => (
        <section key={g.key} aria-label={g.label} className="space-y-2">
          <h4 className="flex items-center gap-2 text-base font-bold text-fg">
            {g.label}
            {g.key === "stock" && p.stockUrgency ? <Pill tone={p.stockUrgency === "red" ? "danger" : "warn"}>{URGENCY_WORD[p.stockUrgency]}</Pill> : null}
          </h4>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {STATS.filter((s) => s.group === g.key).map((s) => (
              <StatTile
                key={s.key}
                def={s}
                set={p.current}
                prev={p.prev}
                facts={facts}
                tone={s.key === "costPerOrder" ? costTone(p.current.costPerOrder, target, p.breakeven) : s.key === "gapPct" && p.current.gapPct !== null && Math.abs(p.current.gapPct) > 20 ? "warn" : undefined}
              />
            ))}
          </div>
          {g.key === "confirm" && p.rejectReasons.length ? <p className="text-base text-fg-muted">أكتر أسباب الرفض: {p.rejectReasons.map((r) => `${r.reason} (${r.count})`).join(" · ")}</p> : null}
          {g.key === "offers" && p.offers.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0 text-sm">
              {p.offers.map((o) => (
                <li key={o.offer} className="rounded-full bg-surface-2 px-3 py-1 text-fg">
                  {o.offer}: <span dir="ltr" className="font-bold tabular-nums">{o.orders}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** The six numbers that open a card: spend, real orders, cost of a real order, confirmed, pieces shipped, expected profit. */
const SIX = ["spend", "ordersIn", "costPerOrder", "confirmed", "shippedPieces", "expectedProfit"] as const;

export function Six({ p, facts, target }: { p: Pick<ProductNumbers, "current" | "prev" | "breakeven">; facts: SourceFacts; target: number | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-tour="totals">
      {SIX.map((k) => (
        <StatTile key={k} def={STATS.find((x) => x.key === k)!} set={p.current} prev={p.prev} facts={facts} tone={k === "costPerOrder" ? costTone(p.current.costPerOrder, target, p.breakeven) : undefined} />
      ))}
    </div>
  );
}

const VERDICT_TONE = { neutral: "neutral", ok: "ok", warn: "warn", danger: "danger" } as const;

function ProductCard({ p, facts, target, query }: { p: ProductNumbers; facts: SourceFacts; target: number | null; query: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const verdict = productVerdict(p.current.costPerOrder, target, p.breakeven);
  return (
    <section className="rounded-card border border-border bg-surface-1">
      <Tap type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 p-4 text-start">
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ProductName name={p.name} code={p.code} />
            <Pill tone={VERDICT_TONE[verdict.tone]}>{verdict.label}</Pill>
          </span>
          <span className="flex flex-wrap gap-x-5 gap-y-1 text-base text-fg-muted">
            <span>تكلفة الطلب <b dir="ltr" className="font-display tabular-nums text-fg">{fmt(p.current.costPerOrder, "$")}</b></span>
            <span>طلبات <b dir="ltr" className="font-display tabular-nums text-fg">{fmt(p.current.ordersIn, "")}</b></span>
            <span>صرف <b dir="ltr" className="font-display tabular-nums text-fg">{fmt(p.current.spend, "$")}</b></span>
          </span>
        </span>
        <ChevronDown className={`size-5 shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </Tap>
      {open ? (
        <div className="space-y-4 border-t border-border p-4">
          <Link href={productHref(p, query)} className="inline-flex min-h-11 items-center text-base font-semibold text-info hover:underline">
            صفحة المنتج
          </Link>
          <Six p={p} facts={facts} target={target} />
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "سكّر الأرقام" : "كل الأرقام"}
          </Button>
          {all ? <Groups p={p} facts={facts} target={target} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/** «شارك»: the numbers as a phone-friendly PDF (the print page — «احفظ كـ PDF») and as a summary on Telegram. */
function Share({ query }: { query: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function telegram() {
    setBusy(true);
    try {
      const r = await safeFetch(`/api/numbers/share?${query}`, { method: "POST" });
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
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Send className="size-4" />
        شارك
      </Button>
      {open ? (
        <div className="absolute end-0 top-full z-30 mt-2 w-64 space-y-1.5 rounded-xl border border-border bg-surface-1 p-2 shadow-card">
          <a href={`/print/numbers?${query}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-base text-fg hover:bg-surface-2">
            <Printer className="size-4" /> PDF — صفحة للطباعة والحفظ
          </a>
          <Tap type="button" disabled={busy} onClick={telegram} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-base text-fg hover:bg-surface-2 disabled:opacity-50">
            <Send className="size-4" /> ملخص على تيليجرام
          </Tap>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «الأرقام ← المنتجات» (v6 · P6): the six numbers of the total first, then a card per product — closed until tapped, open on six numbers, the 31 behind «كل الأرقام». Every number is a «كنا ← صرنا» tile
 * with its difference in words, always shown (the «قارن» box is gone). Every figure explains itself with a tap and carries its source.
 */
export function NumbersView({ data, facts, query, pasteDay, linkQuery }: { data: NumbersData; facts: SourceFacts; /** the window as the share and print addresses read it (`d=custom&from=…&to=…`) */ query: string; /** set only for the owner: the day «ألصق أرقام» starts from */ pasteDay?: string; /** the period query the links to a product's page keep */ linkQuery: string }) {
  const [all, setAll] = useState(false);
  const { current, prev, avg7 } = data.totals;
  const total = { current, prev, avg7, breakeven: null, rejectReasons: data.products.flatMap((p) => p.rejectReasons), offers: [], stockUrgency: null };
  const shown = data.products.filter((p) => p.hasData);
  return (
    <div className="space-y-6">
      {data.demo ? <p className="rounded-card border border-dashed border-warn/50 bg-warn/5 p-3 text-base text-warn">بيانات تجريبية — أرقام مثال بنفس الحسابات. لما ينربط نظام الطلبات وميتا بتطلع أرقامك الفعلية.</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2" data-tour="toolbar">
        {pasteDay ? <PasteNumbers defaultDay={pasteDay} /> : null}
        <Share query={query} />
      </div>

      <section aria-label="الإجمالي" className="space-y-3">
        <SectionTitle hint={data.range.days === 1 ? "أمس مقابل اللي قبله" : `آخر ${data.range.days} يوم مقابل اللي قبلهم`}>الإجمالي</SectionTitle>
        <Six p={total} facts={facts} target={data.target} />
        <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "سكّر أرقام الإجمالي" : "كل أرقام الإجمالي"}
        </Button>
        {all ? (
          <div className="rounded-card border border-border bg-surface-1 p-4">
            <Groups p={total} facts={facts} target={data.target} />
          </div>
        ) : null}
      </section>

      <section aria-label="المنتجات" className="space-y-3" data-tour="products">
        <SectionTitle>المنتجات</SectionTitle>
        {shown.map((p) => (
          <ProductCard key={p.key ?? p.code} p={p} facts={facts} target={data.target} query={linkQuery} />
        ))}
        {!shown.length ? <p className="rounded-card border border-dashed border-border p-4 text-base text-fg-muted">ما في أرقام للفترة هاي لسا. أول ما توصل أرقام الطلبات والصرف بتطلع هون.</p> : null}
      </section>

      {data.rulesMissing && !data.demo ? (
        <p className="rounded-card border border-border bg-surface-1 p-4 text-base text-fg-muted">
          الألوان بتحتاج «الهدف» و«نقطة التعادل» من{" "}
          <Link href="/settings/rules#campaign-rules" className="inline-flex min-h-11 items-center font-semibold text-info hover:underline">
            قواعد الحملات
          </Link>{" "}
          — لسا ناقصة.
        </p>
      ) : null}
    </div>
  );
}
