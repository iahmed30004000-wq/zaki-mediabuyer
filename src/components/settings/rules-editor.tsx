"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { describeRules, missingRules, type CampaignRules } from "@/core/rules-v2";
import { safeFetch } from "@/lib/call";
import { Checkbox } from "@/components/ui/checkbox";

type Kind = "int" | "money" | "pct" | "factor" | "bool" | "time";
interface Field {
  path: string;
  label: string;
  kind: Kind;
  hint?: string;
}

const GROUPS: { title: string; open?: boolean; fields: Field[] }[] = [
  {
    title: "الأساسيات",
    open: true,
    fields: [
      { path: "nightRound", label: "جولة الليل (الوقت الوحيد للتغيير)", kind: "time" },
      { path: "judgeDays", label: "الحكم على آخر … أيام كاملة", kind: "int" },
      { path: "ignoreFirstDay", label: "أول يوم لأي مجموعة بينتجاهل", kind: "bool" },
      { path: "realCostFactor", label: "تكلفة الطلب الحقيقي = تكلفة البكسل ×", kind: "factor" },
      { path: "targetCost", label: "الهدف: تكلفة الطلب الحقيقي أقل من", kind: "money", hint: "$" },
      { path: "adsetPauseDays", label: "مجموعة فوق التعادل … أيام ← توقيف", kind: "int" },
      { path: "newAdsetFreezeHours", label: "مجموعة جديدة: بلا تغيير … ساعة", kind: "int" },
    ],
  },
  {
    title: "الإعلان الواحد",
    fields: [
      { path: "ad.minAdsetHours", label: "عمر المجموعة على الأقل (ساعة)", kind: "int" },
      { path: "ad.spendZeroSales", label: "صرف بصفر مبيعات ← توقيف", kind: "money", hint: "$" },
      { path: "ad.spendOneSale", label: "صرف بمبيعة وحدة ← توقيف", kind: "money", hint: "$" },
      { path: "ad.daysAboveBreakeven", label: "أيام فوق التعادل ← توقيف", kind: "int" },
      { path: "ad.untestedShare", label: "أقل من … من صرف المجموعة = «لم يُختبر»", kind: "pct" },
    ],
  },
  {
    title: "التكبير والرجوع",
    fields: [
      { path: "scale.maxCost", label: "التكبير لما التكلفة ≤", kind: "money", hint: "$" },
      { path: "scale.days", label: "لمدة … أيام", kind: "int" },
      { path: "scale.stepPct", label: "الزيادة كل مرة", kind: "pct" },
      { path: "scale.everyHours", label: "مرة كل … ساعة", kind: "int" },
      { path: "scale.maxWeekPct", label: "حد الأسبوع", kind: "pct" },
      { path: "scale.stockBlocks", label: "المخزون القليل بيمنع التكبير", kind: "bool" },
      { path: "scale.capRunning", label: "سقف المنتجات الشغّالة باليوم", kind: "money", hint: "$" },
      { path: "scale.proposeCapRaiseDays", label: "اقترح رفع السقف بعد … أيام بالهدف", kind: "int" },
      { path: "revert.backToOldBudget", label: "مجموعة كبّرناها وصارت فوق التعادل: ترجع لميزانيتها", kind: "bool" },
      { path: "revert.pauseAfterHours", label: "وإذا بعد … ساعة لسا فوقه ← توقيف", kind: "int" },
    ],
  },
  {
    title: "المخزون",
    fields: [
      { path: "stock.redDays", label: "🔴 أقل من … أيام", kind: "int" },
      { path: "stock.orangeDays", label: "🟠 لحد … أيام", kind: "int" },
      { path: "stock.yellowDays", label: "🟡 لحد … أيام", kind: "int" },
    ],
  },
  {
    title: "الفيديوهات والهوكات",
    fields: [
      { path: "videos.fatigueFrequency", label: "رابح تعبان: التكرار أكبر من", kind: "factor" },
      { path: "videos.fatigueDropPct", label: "أو CTR/Hook نزل", kind: "pct" },
      { path: "videos.fatigueCostMax", label: "أو التكلفة أكتر من", kind: "money", hint: "$" },
      { path: "videos.fatigueCostDays", label: "لمدة … أيام", kind: "int" },
      { path: "videos.winnerScenarios", label: "رابح جديد: عدد السيناريوهات المطلوبة", kind: "int" },
      { path: "videos.bankMin", label: "بنك المنتج ≤ … فيديو ← دفعة جديدة", kind: "int" },
      { path: "videos.batch", label: "حجم الدفعة", kind: "int" },
      { path: "videos.batchRefs", label: "منها من المراجع", kind: "int" },
      { path: "videos.batchWinners", label: "ومن الرابحين", kind: "int" },
    ],
  },
  {
    title: "الميزانيات واختبار المنتج الجديد",
    fields: [
      { path: "budgets.runningCap", label: "المنتجات الشغّالة مع اختبارات إبداعها ≤ (باليوم)", kind: "money", hint: "$" },
      { path: "budgets.newProductTests", label: "ميزانية اختبارات المنتجات الجديدة (باليوم)", kind: "money", hint: "$" },
      { path: "budgets.testPerProduct", label: "اختبار المنتج الواحد (باليوم)", kind: "money", hint: "$" },
      { path: "budgets.fallbackTotal", label: "إذا النتائج نزلت: المجموع مع الاختبارات ≤", kind: "money", hint: "$" },
      { path: "newProductTest.perDay", label: "اختبار منتج جديد: يومياً", kind: "money", hint: "$" },
      { path: "newProductTest.ignoreDay1", label: "أول يوم بيتجاهل", kind: "bool" },
      { path: "newProductTest.day2Max", label: "اليوم الثاني < ← بيكمّل", kind: "money", hint: "$" },
      { path: "newProductTest.day3Max", label: "اليوم الثالث < ← رابح", kind: "money", hint: "$" },
      { path: "newProductTest.maxSpend", label: "لحد صرف", kind: "money", hint: "$" },
    ],
  },
];

const getIn = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);
function setIn<T>(o: T, path: string, v: unknown): T {
  const [k, ...rest] = path.split(".");
  const cur = o as Record<string, unknown>;
  return { ...cur, [k!]: rest.length ? setIn(cur[k!], rest.join("."), v) : v } as T;
}

/** A number the owner types: the text stays as typed («3.» is not lost), the value follows it. */
function NumberField({ f, value, onChange }: { f: Field; value: number | null; onChange: (v: number | null) => void }) {
  const shown = (v: number | null) => (v === null ? "" : String(f.kind === "pct" ? Math.round(v * 1000) / 10 : v));
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    const parsed = text === "" ? null : f.kind === "pct" ? Number(text) / 100 : Number(text);
    if (parsed !== value && !(Number.isNaN(parsed) && value === null)) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const nullable = f.kind === "money" || f.kind === "pct";
  return (
    <div className="flex items-center gap-2">
      <Input
        dir="ltr"
        inputMode="decimal"
        value={text}
        placeholder={nullable ? "—" : "0"}
        aria-label={f.label}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          if (t === "") return onChange(nullable ? null : 0);
          const n = Number(t);
          if (Number.isFinite(n)) onChange(f.kind === "pct" ? n / 100 : n);
        }}
        className="w-24 text-end tabular-nums"
      />
      <span className="w-4 text-sm text-fg-muted">{f.kind === "pct" ? "%" : f.hint ?? ""}</span>
    </div>
  );
}

/**
 * «قواعد الحملات»: the owner's operating rules as numbers he can change — the night round, three days of judgement, the
 * targets, the break-even of each product, the single-ad thresholds, the ladder, stock, video requests, budgets. Saved as a
 * new version (the old one can come back), read by Claude through `get_rules`. The dollar amounts start empty: they are his.
 */
export function RulesEditor({ initial, version, products, demo }: { initial: CampaignRules; version: number; products: string[]; demo: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const missing = useMemo(() => missingRules(rules), [rules]);
  const sentences = useMemo(() => describeRules(rules), [rules]);

  const edit = (path: string, v: unknown) => {
    setRules((r) => setIn(r, path, v));
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    try {
      const r = await safeFetch("/api/rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(rules) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; version?: number };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : `انحفظت القواعد — النسخة ${d.version} ✓ (Claude بيقراها بالتشغيل الجاي)`, d.demo ? "info" : "success");
      setDirty(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const be = Object.entries(rules.breakeven);
  return (
    <div className="space-y-3">
      {missing.length ? (
        <Panel className="space-y-1 border-warn/40 bg-warn/5">
          <p className="text-sm font-semibold text-warn">ناقص {missing.length} رقم — Claude ما رح ينفّذ قاعدة رقمها ناقص:</p>
          <p className="text-sm leading-5 text-fg-muted">{missing.map((m) => m.label).join(" · ")}</p>
        </Panel>
      ) : (
        <p className="text-sm text-ok">✓ كل أرقام القواعد مكتوبة.</p>
      )}

      <Panel className="space-y-3">
        <details open>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg max-md:min-h-[44px]">نقطة التعادل لكل منتج (دولار للطلب الحقيقي)</summary>
          <div className="mt-3 space-y-2">
            {be.map(([p, v]) => (
              <div key={p} className="flex items-center gap-2 text-sm">
                <span dir="ltr" className="w-28 tabular-nums text-sm text-fg">{p}</span>
                <NumberField f={{ path: `breakeven.${p}`, label: `تعادل ${p}`, kind: "money", hint: "$" }} value={v} onChange={(n) => n !== null && edit("breakeven", { ...rules.breakeven, [p]: n })} />
                <IconButton aria-label={`شيل ${p}`} onClick={() => { const { [p]: _gone, ...rest } = rules.breakeven; edit("breakeven", rest); }}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
            {!be.length ? <p className="text-sm text-fg-muted">ما في منتج لسا. اكتب رمز المنتج (مثل <span dir="ltr" className="tabular-nums">TRF01</span>) ورقم التعادل.</p> : null}
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const c = code.trim();
                const n = Number(amount);
                if (!c || !Number.isFinite(n) || n <= 0) return;
                edit("breakeven", { ...rules.breakeven, [c]: n });
                setCode("");
                setAmount("");
              }}
            >
              <Input dir="ltr" list="rules-products" value={code} onChange={(e) => setCode(e.target.value)} placeholder="رمز المنتج" className="w-36 tabular-nums" aria-label="رمز المنتج" />
              <datalist id="rules-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
              <Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="$" className="w-24 text-end" aria-label="نقطة التعادل بالدولار" />
              <Button size="sm" variant="secondary" type="submit" disabled={!code.trim() || !Number(amount)}>
                <Plus className="size-3.5" /> أضف
              </Button>
            </form>
          </div>
        </details>
      </Panel>

      {GROUPS.map((g) => (
        <Panel key={g.title}>
          <details open={g.open}>
            <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg max-md:min-h-[44px]">{g.title}</summary>
            <div className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
              {g.fields.map((f) => {
                const v = getIn(rules, f.path);
                return (
                  <label key={f.path} className="flex min-h-10 items-center justify-between gap-3 text-sm text-fg max-md:min-h-[44px]">
                    <span className="leading-5">{f.label}</span>
                    {f.kind === "bool" ? (
                      <Checkbox aria-label={f.label} checked={!!v} onChange={(e) => edit(f.path, e.target.checked)} className="min-h-0 shrink-0" />
                    ) : f.kind === "time" ? (
                      <Input type="time" dir="ltr" value={String(v)} onChange={(e) => e.target.value && edit(f.path, e.target.value)} className="w-28 shrink-0" />
                    ) : (
                      <NumberField f={f} value={v as number | null} onChange={(n) => edit(f.path, n)} />
                    )}
                  </label>
                );
              })}
              {g.title === "المخزون" ? (
                <label className="flex items-center justify-between gap-3 text-sm text-fg md:col-span-2">
                  <span>التنبيه لمين (مفاتيح مفصولة بفاصلة)</span>
                  <Input dir="ltr" value={rules.stock.audience.join(", ")} onChange={(e) => edit("stock.audience", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} className="w-64 tabular-nums" aria-label="مين بيتبلّغ" />
                </label>
              ) : null}
            </div>
          </details>
        </Panel>
      ))}

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1/95 p-3 shadow-card backdrop-blur md:bottom-4">
        <Button disabled={busy || !dirty} onClick={save} className="min-h-10 max-md:min-h-[44px]">
          احفظ القواعد
        </Button>
        <span className="text-sm text-fg-muted">{demo ? "تجريبي: ما بينحفظ" : version ? `النسخة الحالية ${version}` : "لسا ما انحفظت نسخة"}{dirty ? " · فيه تعديل ما انحفظ" : ""}</span>
      </div>

      <Panel>
        <details>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg max-md:min-h-[44px]">القواعد الـ 14 بكلامها (هيك بيقراها Claude)</summary>
          <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm leading-6 text-fg">
            {sentences.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      </Panel>
    </div>
  );
}
