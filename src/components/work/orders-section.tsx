"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select, Textarea } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/section-title";
import { useToast } from "@/components/ui/toast";
import { DOMAIN_AR, EFFECT_AR, untilWords, type OrderDomain, type OrderEffect } from "@/core/orders";
import type { OrderView } from "@/server/orders";

export interface OrderScope {
  domain: OrderDomain;
  jobKeys?: string[];
  products?: string[];
}

/**
 * «أوامر سارية»: the owner's temporary instructions that touch this job / product / domain — each with what it does (يشدّد / يرخّي), until
 * when, and «ارجع» to end it (it stays in the archive). «＋ أمر جديد» writes one: the words, tighten or loosen, until when. A tightening one is
 * in force at once; a loosening one from anyone but the owner waits in «بانتظارك».
 */
export function OrdersSection({ orders, scope, title = "أوامر سارية", canCreate, canEnd }: { orders: OrderView[]; scope: OrderScope; title?: string; canCreate: boolean; canEnd: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [effect, setEffect] = useState<OrderEffect>("restrict");
  const [domain, setDomain] = useState<OrderDomain>(scope.domain);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown, done: string) {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; order?: OrderView };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      if (d.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      toast(d.order?.status === "pending" ? "انسجّل — وبانتظار موافقتك بـ «بانتظارك»" : done, "success");
      setText("");
      setUntil("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" data-tour="orders">
      <SectionTitle>{title}</SectionTitle>
      {orders.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <Pill tone={o.effect === "restrict" ? "warn" : "info"}>{EFFECT_AR[o.effect]}</Pill>
              <span className="min-w-0 flex-1 text-sm font-semibold leading-6 text-fg">{o.text}</span>
              <span className="text-xs text-fg-muted">
                {DOMAIN_AR[o.domain as OrderDomain] ?? o.domain} · {untilWords(o.endsAt)}
              </span>
              {o.status === "pending" ? <Pill tone="neutral">بانتظار موافقتك</Pill> : null}
              {o.endRequested ? <Pill tone="neutral">Claude طلب ينهيه</Pill> : null}
              {canEnd && o.status === "active" ? (
                <Button size="sm" variant="secondary" confirm="متأكد؟" loading={busy} onClick={() => void post(`/api/orders/${o.id}`, { action: "end" }, "انتهى الأمر ✓")}>
                  ارجع
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في أوامر سارية هون. لما تقول لـ Claude «لا تعمل كذا لحد ما أقلك»، بينكتب هون وبيقراه بأول كل تشغيل.</p>
      )}
      {canCreate ? (
        open ? (
          <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
            <Field label="الأمر بكلامك" hint="مثلاً: ما في فيديو جديد لحد ما أقلك ارجع" required>
              <Textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <Segmented label="شو بيعمل" value={effect} onChange={setEffect} options={[{ value: "restrict", label: "بيشدّد" }, { value: "allow", label: "بيرخّي" }]} />
              {scope.jobKeys?.length || scope.products?.length ? null : (
                <Field label="المجال">
                  <Select value={domain} onChange={(e) => setDomain(e.target.value as OrderDomain)}>
                    {(["ads", "ops", "all"] as const).map((d) => (
                      <option key={d} value={d}>
                        {DOMAIN_AR[d]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="لحد إيمتى" hint="فاضي = لحد ما تقول «ارجع»">
                <input type="datetime-local" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} className="h-10 max-md:h-[44px] rounded-lg border border-border bg-surface-1 px-2 text-base text-fg" />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button
                loading={busy}
                disabled={!text.trim()}
                onClick={() =>
                  void post("/api/orders", { text: text.trim(), effect, domain: scope.domain === "all" && !scope.jobKeys?.length ? domain : scope.domain, ...(scope.jobKeys?.length ? { job_keys: scope.jobKeys } : {}), ...(scope.products?.length ? { products: scope.products } : {}), ...(until ? { until: new Date(until).toISOString() } : {}) }, "انحفظ الأمر ✓ — Claude بيقراه بأول تشغيل")
                }
              >
                احفظ الأمر
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                لا
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            أمر جديد
          </Button>
        )
      ) : null}
    </section>
  );
}
