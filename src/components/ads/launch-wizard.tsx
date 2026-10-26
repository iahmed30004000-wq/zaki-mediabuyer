"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, PenLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useMission } from "@/components/mb/mission";
import { fmt } from "@/components/mb/num";
import { nextFreeCampaignName, yymmdd, type Market } from "@/core/naming";
import type { LaunchOptions } from "@/lib/launch-view";
import { cn } from "@/lib/utils";

/** The templates of spec 5.3, in the owner's words. Every setting is explicit in code; everything is created PAUSED. */
const TEMPLATES = [
  { key: "CRT", title: "اختبار إبداعات", text: "مجموعة لكل مفهوم، 3–5 أيام بدون تعديل.", budget: (t: number) => Math.max(15, Math.ceil(3 * t)), days: 4 },
  { key: "TEST", title: "اختبار منتج", text: "3–5 مفاهيم، كل مفهوم بـ 3–6 هوكات، سقف صرف = ميزانية الاختبار.", budget: (t: number) => Math.max(15, Math.ceil(3 * t)), days: 6 },
  { key: "SCALE", title: "تكبير", text: "الرابحين بس، ميزانية على الحملة.", budget: () => 50, days: 7 },
] as const;

const STEPS = ["المنتج", "القالب", "الفيديوهات", "المراجعة"] as const;

interface Preview {
  ok: boolean;
  name?: string;
  perDay?: number;
  problems?: string[];
}

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(`mb.launch.${k}`) ?? "";
    localStorage.setItem(`mb.launch.${k}`, v);
  } catch {
    /* a private window: no memory, still works */
  }
  return "";
};

/** «＋ إطلاق»: four steps, one decision each, the money it moves and every reason to refuse shown before anything happens. */
export function LaunchWizard({ open, onOpenChange, options }: { open: boolean; onOpenChange: (o: boolean) => void; options: LaunchOptions }) {
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState<string | null>(null);
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["key"] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [page, setPage] = useState("");
  const [dataset, setDataset] = useState("");
  const [url, setUrl] = useState("");
  const [lp, setLp] = useState("LP1");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [variants, setVariants] = useState<{ hook: string; body: string; headline: string; flag: string; note: string | null }[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const mission = useMission();
  const { toast } = useToast();
  const router = useRouter();

  const p = options.products.find((x) => x.code === product);
  const tpl = TEMPLATES.find((t) => t.key === template);
  const account = options.accounts.find((a) => a.market === p?.market) ?? options.accounts[0];
  const ready = options.creatives.filter((c) => c.product === product);
  const perSet = p && tpl ? tpl.budget(p.tOrder) : 0;
  const daily = preview?.perDay ?? (tpl?.key === "SCALE" ? perSet : perSet * Math.max(1, picked.length));
  const localName = useMemo(() => (p && tpl ? nextFreeCampaignName({ market: p.market as Market, productCode: p.code, objective: "WEB", stage: tpl.key, date: yymmdd(new Date()) }, []) : ""), [p, tpl]);

  useEffect(() => {
    if (!product) return;
    // the settings' landing page first, then what was typed last time for this product
    const lp0 = options.landing.find((l) => l.productCode === product);
    setUrl(remember(`${product}.url`) || lp0?.url || "");
    if (lp0) setLp(lp0.lpCode);
    setMessage(remember(`${product}.message`));
    setTitle(remember(`${product}.title`) || "اطلب هلأ — الدفع عند الاستلام");
  }, [product]);
  useEffect(() => {
    setPage((v) => v || options.pages[0]?.metaId || "");
    setDataset((v) => v || options.datasets[0]?.metaId || "");
  }, [options]);

  const body = p && tpl && account ? { template: tpl.key, productCode: p.code, market: p.market, accountMetaId: account.metaId, pageMetaId: page, datasetMetaId: dataset, landingUrl: url, lpCode: lp, crCodes: picked, message, title } : null;
  const formOk = !!body && !!page && !!dataset && /^https:\/\//.test(url) && /^LP\d$/.test(lp) && message.trim().length > 0 && title.trim().length > 0;

  // «جرّب» on the server as the owner types: the real name, the money, and every reason it would be refused
  useEffect(() => {
    if (step !== 3 || !formOk || !options.live) return;
    const t = setTimeout(async () => {
      const r = await fetch("/api/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, preview: true }) }).catch(() => null);
      const j = (await r?.json().catch(() => null)) as (Preview & { error?: string }) | null;
      setPreview(j?.error ? { ok: false, problems: [j.error] } : j);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, formOk, page, dataset, url, lp, message, title, picked.join(","), template, product]);

  const canNext = [!!product, !!template, picked.length > 0, true][step];
  const reset = () => {
    setStep(0);
    setProduct(null);
    setTemplate(null);
    setPicked([]);
    setPreview(null);
  };

  // M07: variants from the writer, each already through the policy dictionary; one tap fills the text and the title
  const write = async () => {
    if (!p) return;
    setWriting(true);
    try {
      const r = await fetch("/api/agents/writer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productCode: p.code }) });
      const j = (await r.json()) as { variants?: { hook: string; body: string; headline: string; flag: string; note: string | null }[]; dropped?: number; error?: string };
      if (!r.ok || !j.variants) {
        toast(j.error ?? "ما زبط الكاتب", "error");
        return;
      }
      setVariants(j.variants);
      if (j.dropped) toast(`${j.dropped} نسخة انشالت لأنها فيها ممنوع`, "info");
    } finally {
      setWriting(false);
    }
  };

  const submit = async () => {
    if (!body) return;
    remember(`${body.productCode}.url`, url);
    remember(`${body.productCode}.message`, message);
    remember(`${body.productCode}.title`, title);
    if (!options.live) {
      onOpenChange(false);
      reset();
      mission({ title: "تجربة ✓", detail: "بالوضع التجريبي ما بينبعت شي — لما تربط ميتا بيصير الإطلاق حقيقي", art: "launch-done" });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok?: boolean; error?: string; state?: string; name?: string };
      if (!r.ok || !j.ok) {
        toast(j.error ?? "ما زبط الإطلاق", "error");
        return;
      }
      onOpenChange(false);
      reset();
      mission({ title: j.state === "pending_approval" ? "جاهز لموافقتك ✓" : "انطلقت ✓", detail: j.state === "pending_approval" ? `${j.name} بانتظارك بـ «القرارات» — بتنعمل موقوفة وبتتفعّل بعد التحقق` : "الحملة انعملت موقوفة — بتتفعّل لحالها بعد التحقق من الإعدادات", art: "launch-done" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const choice = (active: boolean) => cn("w-full rounded-xl border p-3 text-start transition-colors", active ? "border-accent bg-accent/10" : "border-border hover:border-accent/50");
  const blocked = options.live && (!formOk || !preview?.ok);

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
            (options.products.length ? (
              options.products.map((x) => (
                <button key={x.code} onClick={() => { setProduct(x.code); setPicked([]); }} className={choice(product === x.code)}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {x.name}
                    <span dir="ltr" className="font-mono text-xs text-fg-muted">{x.code}</span>
                    {x.stockDays !== null && x.stockDays < 5 ? <span className="ms-auto text-[11px] text-warn">المخزون {x.stockDays} أيام</span> : null}
                  </span>
                  <span className="text-xs text-fg-muted">هدف الطلب {fmt(x.tOrder, "$")} {x.estimated ? "(تقدير)" : ""}</span>
                </button>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-fg-muted">ما في منتجات لسا — بتيجي من الـ OMS لما ينربط، أو ضيفها من «الإعدادات».</p>
            ))}
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
                      <span className="text-xs text-fg-muted">{c.label}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-fg-muted">ما في فيديوهات مرفوعة لميتا لهالمنتج. ارمي فيديوهات بمجلد 01_inbox على درايف، أو اطلب من الاستديو من «الإبداعات».</p>
            ))}
          {step === 3 && p && tpl ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-fg-muted">اسم الحملة (بيعمله النظام)</p>
                <p dir="ltr" className="text-start font-mono text-fg">{preview?.name ?? localName}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <Label>الصفحة</Label>
                  <Select value={page} onChange={(e) => setPage(e.target.value)}>
                    {options.pages.map((x) => <option key={x.metaId} value={x.metaId}>{x.name} ({x.code})</option>)}
                  </Select>
                </label>
                <label className="block">
                  <Label>البكسل</Label>
                  <Select value={dataset} onChange={(e) => setDataset(e.target.value)}>
                    {options.datasets.map((x) => <option key={x.metaId} value={x.metaId}>{x.name}</option>)}
                  </Select>
                </label>
                <label className="block sm:col-span-2">
                  <Label>رابط صفحة الهبوط</Label>
                  <div className="flex gap-2">
                    <Input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://crm.zakiai.io/lp/…" />
                    <Input dir="ltr" value={lp} onChange={(e) => { const v = e.target.value.trim().toUpperCase(); setLp(v); const hit = options.landing.find((l) => l.productCode === product && l.lpCode === v); if (hit) setUrl(hit.url); }} className="w-20 text-center font-mono" aria-label="رمز صفحة الهبوط" />
                  </div>
                </label>
                <div className="sm:col-span-2">
                  <Button type="button" variant="ghost" disabled={writing} onClick={write} className="min-h-9 px-2 text-xs">
                    <PenLine className="size-3.5" />
                    {writing ? "عم يكتب…" : "اكتبلي نسخ (بتنفحص بالقاموس)"}
                  </Button>
                  {variants?.length ? (
                    <div className="mt-1 space-y-1">
                      {variants.map((v) => (
                        <button key={v.body} type="button" onClick={() => { setMessage(`${v.hook}
${v.body}`); setTitle(v.headline); setVariants(null); }} className={choice(false)}>
                          <span className="block text-sm text-fg">{v.hook}</span>
                          <span className="block text-xs text-fg-muted">{v.body}</span>
                          {v.flag === "yellow" ? <span className="mt-1 block text-[11px] text-warn">بدها موافقتك: {v.note}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="block sm:col-span-2">
                  <Label>نص الإعلان</Label>
                  <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="بينفحص بقاموس السياسات قبل ما يطلع" />
                </label>
                <label className="block sm:col-span-2">
                  <Label>العنوان</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
              </div>
              {preview && !preview.ok ? (
                <ul className="space-y-1 rounded-xl border border-danger/40 bg-danger/5 p-3 text-xs text-fg">
                  {preview.problems?.map((x) => (
                    <li key={x} className="flex gap-1.5"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />{x}</li>
                  ))}
                </ul>
              ) : null}
              <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                <p className="text-xs text-fg-muted">الأثر المالي</p>
                <p className="text-lg font-bold text-warn" dir="ltr">+{fmt(daily, "$", 0)} / يوم</p>
                <p className="text-xs text-fg-muted">لـ {tpl.days} أيام · {picked.length} فيديو · بالحساب {account?.name ?? "—"}</p>
              </div>
              <ul className="space-y-1 text-xs text-fg">
                {["بتنشأ موقوفة، وبتتفعّل بعد ما النظام يقرأها من ميتا ويتأكد إنها مطابقة للقالب", "تحسينات الإبداع التلقائية كلها مطفية بالاسم، وإعلانات المعلنين المتعددين مطفية", "الجمهور: السوق بس، 18+، بدون اهتمامات ولا جمهور Advantage+", "رابط صفحة الهبوط فيه رقم الإعلان عشان الطلب ينربط فيه"].map((x) => (
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
            <Button disabled={busy || blocked} onClick={submit}>
              <Check className="size-4" />
              {options.live ? "جهّزه لموافقتي" : "جرّب الإطلاق"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
