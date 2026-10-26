"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMission } from "@/components/mb/mission";
import { fmt } from "@/components/mb/num";
import { nextFreeCampaignName, yymmdd } from "@/core/naming";
import { CREATIVES, PACE, PRODUCTS, targetsOf } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

/** The templates of spec 5.3, in the owner's words. Every setting is explicit in code; everything is created PAUSED. */
const TEMPLATES = [
  { key: "CRT", title: "اختبار إبداعات", text: "مجموعة لكل مفهوم، 3–5 أيام بدون تعديل.", budget: (t: number) => Math.max(15, 3 * t), days: 4 },
  { key: "TEST", title: "اختبار منتج", text: "3–5 مفاهيم، كل مفهوم بـ 3–6 هوكات، سقف صرف = ميزانية الاختبار.", budget: () => 60, days: 6 },
  { key: "SCALE", title: "تكبير", text: "الرابحين بس، بنفس المنشور عشان التفاعل ينحفظ.", budget: () => 80, days: 7 },
] as const;

const STEPS = ["المنتج", "القالب", "الفيديوهات", "المراجعة"] as const;

/** «＋ إطلاق»: four steps, one decision each, and the money it moves shown before anything happens. */
export function LaunchWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState<string | null>(null);
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["key"] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const mission = useMission();

  const p = PRODUCTS.find((x) => x.code === product);
  const tpl = TEMPLATES.find((t) => t.key === template);
  const ready = CREATIVES.filter((c) => c.product === product && (c.stage === "ready" || c.stage === "live"));
  const perSet = p && tpl ? tpl.budget(targetsOf(p).tOrder) : 0;
  const daily = perSet * Math.max(1, picked.length);
  const name = useMemo(() => (p && tpl ? nextFreeCampaignName({ market: p.market, productCode: p.code, objective: "WEB", stage: tpl.key, date: yymmdd(new Date()) }, []) : ""), [p, tpl]);

  const canNext = [!!product, !!template, picked.length > 0, true][step];
  const reset = () => {
    setStep(0);
    setProduct(null);
    setTemplate(null);
    setPicked([]);
  };

  const choice = (active: boolean) => cn("w-full rounded-xl border p-3 text-start transition-colors", active ? "border-accent bg-accent/10" : "border-border hover:border-accent/50");

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إطلاق جديد</DialogTitle>
          <DialogDescription>
            <ol className="mt-2 flex gap-1.5">
              {STEPS.map((s, i) => (
                <li key={s} className={cn("flex-1 rounded-full py-1 text-center text-[11px] font-medium", i === step ? "bg-accent text-accent-fg" : i < step ? "bg-accent/15 text-accent" : "bg-surface-2 text-fg-muted")}>
                  {i + 1}. {s}
                </li>
              ))}
            </ol>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {step === 0 &&
            PRODUCTS.map((x) => {
              const t = targetsOf(x);
              return (
                <button key={x.code} onClick={() => setProduct(x.code)} className={choice(product === x.code)}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {x.name}
                    <span dir="ltr" className="font-mono text-xs text-fg-muted">{x.code}</span>
                    {x.stockDays < 5 ? <span className="ms-auto text-[11px] text-warn">المخزون {x.stockDays} أيام</span> : null}
                  </span>
                  <span className="text-xs text-fg-muted">هدف الطلب {fmt(t.tOrder, "$")} {t.estimated ? "(تقدير)" : ""}</span>
                </button>
              );
            })}
          {step === 1 &&
            TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => setTemplate(t.key)} className={choice(template === t.key)}>
                <span className="block text-sm font-semibold text-fg">{t.title}</span>
                <span className="text-xs text-fg-muted">{t.text}</span>
              </button>
            ))}
          {step === 2 &&
            (ready.length ? (
              ready.map((c) => {
                const on = picked.includes(c.code);
                return (
                  <button key={c.code} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== c.code) : [...l, c.code]))} className={choice(on)}>
                    <span className="flex items-center gap-2 text-sm">
                      <span className={cn("inline-flex size-5 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-border")}>{on ? <Check className="size-3.5" /> : null}</span>
                      <span dir="ltr" className="font-mono text-fg">{c.code}</span>
                      <span className="text-xs text-fg-muted">{[c.hook, c.angle, `${c.duration}ث`].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-fg-muted">ما في فيديوهات جاهزة لهالمنتج. ارمي فيديوهات بمجلد 01_inbox على Drive، أو اطلب من الاستديو من «الإبداعات».</p>
            ))}
          {step === 3 && p && tpl ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-fg-muted">اسم الحملة (بيعمله النظام)</p>
                <p dir="ltr" className="text-start font-mono text-fg">{name}</p>
              </div>
              <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                <p className="text-xs text-fg-muted">الأثر المالي</p>
                <p className="text-lg font-bold text-warn" dir="ltr">+{fmt(daily, "$", 0)} / يوم</p>
                <p className="text-xs text-fg-muted">لـ {tpl.days} أيام · صرف اليوم بعدها {fmt(PACE.spentToday + daily, "$")} من سقف {fmt(PACE.dailyCap, "$", 0)}</p>
              </div>
              <ul className="space-y-1 text-xs text-fg">
                {["بتنشأ موقوفة، وبتتفعّل بعد ما النظام يقرأها من ميتا ويتأكد إنها مطابقة للقالب", "تحسينات الإبداع التلقائية كلها مطفية، والمواضع Advantage+ بلا صرف على المستثنى", "الجمهور: السوق بس، 18+، بدون اهتمامات", "رابط صفحة الهبوط فيه رقم الإعلان عشان الطلب ينربط فيه"].map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ChevronRight className="size-4" />
            رجوع
          </Button>
          {step < 3 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              التالي
              <ChevronLeft className="size-4" />
            </Button>
          ) : (
            <Button
              onClick={() => {
                onOpenChange(false);
                reset();
                mission({ title: "انطلقت ✓", detail: "الحملة انعملت موقوفة — بتتفعّل لحالها بعد التحقق من الإعدادات", art: "launch-done" });
              }}
            >
              <Check className="size-4" />
              وافق وأطلق
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
