"use client";

import { useState } from "react";
import { Check, Copy, FolderInput, Send, ShieldAlert, ShieldCheck, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useMission } from "@/components/mb/mission";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import type { Creative, CreativeStage } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

const POLICY = {
  green: { icon: ShieldCheck, label: "سليم", cls: "text-ok" },
  yellow: { icon: ShieldQuestion, label: "بدو موافقتك", cls: "text-warn" },
  red: { icon: ShieldAlert, label: "ممنوع — في بديل", cls: "text-danger" },
  pending: { icon: ShieldQuestion, label: "عم ينفحص", cls: "text-fg-muted" },
} as const;

/** S06 as one flow: inbox → waiting for you → ready → live → tired. The duplicates sit apart, never deleted. */
export function CreativesView({ creatives, flow, products }: { creatives: Creative[]; flow: { key: CreativeStage; label: string; hint: string }[]; products: { code: string; name: string }[] }) {
  const [items, setItems] = useState(creatives);
  const [stage, setStage] = useState<CreativeStage>("review");
  const { toast } = useToast();
  const mission = useMission();
  const name = (code: string) => products.find((p) => p.code === code)?.name ?? code;
  const inStage = items.filter((c) => c.stage === stage);
  const dups = items.filter((c) => c.stage === "excluded");

  const move = (code: string, to: CreativeStage) => setItems((l) => l.map((c) => (c.code === code ? { ...c, stage: to, policy: to === "ready" ? "green" : c.policy } : c)));

  return (
    <div className="space-y-6">
      <ol data-tour="flow" className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {flow.map((f, i) => {
          const n = items.filter((c) => c.stage === f.key).length;
          const active = stage === f.key;
          return (
            <li key={f.key}>
              <button onClick={() => setStage(f.key)} aria-pressed={active} className={cn("relative flex w-full flex-col items-center gap-0.5 rounded-xl border px-1 py-2.5 transition-colors sm:py-3", active ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface-1 text-fg hover:border-accent/50")}>
                <span className="text-lg font-bold tabular-nums sm:text-2xl">{n}</span>
                <span className="text-[11px] font-medium sm:text-xs">{f.label}</span>
                {f.key === "review" && n > 0 && !active ? <span className="absolute -top-1 end-1 size-2.5 rounded-full bg-warn" /> : null}
              </button>
              {i < flow.length - 1 ? null : null}
            </li>
          );
        })}
      </ol>
      <p className="-mt-3 text-xs text-fg-muted">{flow.find((f) => f.key === stage)?.hint}</p>

      {inStage.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {inStage.map((c) => {
            const P = POLICY[c.policy];
            return (
              <Panel key={c.code} className="space-y-3">
                {/* The first frame is the real cover (7.5); until thumbnails exist, a calm placeholder of the right shape. */}
                <div className="flex gap-3">
                  <div className={cn("flex shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] text-fg-muted", c.aspect === "9:16" ? "h-24 w-[54px]" : c.aspect === "4:5" ? "h-24 w-[77px]" : "size-24")}>{c.aspect}</div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-sm font-semibold text-fg">{c.code}</span>
                      <span className="text-xs text-fg-muted">{name(c.product)}</span>
                    </p>
                    <p className="text-xs text-fg-muted">{[c.hook && `خطّاف: ${c.hook}`, c.angle && `زاوية: ${c.angle}`, c.dialect, `${c.duration}ث`].filter(Boolean).join(" · ")}</p>
                    <p className={cn("inline-flex items-center gap-1 text-xs font-medium", P.cls)}>
                      <P.icon className="size-3.5" />
                      {P.label}
                    </p>
                  </div>
                </div>
                {c.policyNote ? <p className={cn("rounded-lg p-2 text-xs leading-5", c.policy === "red" ? "bg-danger/5 text-fg" : "bg-warn/5 text-fg")}>{c.policyNote}</p> : null}
                {c.stage === "live" || c.stage === "fatigued" ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>Hook <Num value={c.hookRate} unit="%" term="hook" /></span>
                    <span>Hold <Num value={c.holdRate} unit="%" term="hold" /></span>
                    <span>مؤكد <Num value={c.costPerConfirmed} unit="$" term="costPerConfirmed" /></span>
                  </div>
                ) : null}
                {c.stage === "review" ? (
                  <div className="flex flex-wrap gap-2">
                    {c.policy === "yellow" ? (
                      <Button size="sm" onClick={() => { move(c.code, "ready"); mission({ title: "تمّت ✓", detail: `${c.code} صار جاهز وانرفع لميتا` }); }}>
                        <Check className="size-4" /> وافق
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => toast("انبعت طلب تعديل للاستديو مع البديل الآمن.", "success")}>
                        <Send className="size-4" /> اطلب نسخة معدّلة
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { move(c.code, "excluded"); toast("انتقل لـ excluded — ما انحذف شي.", "info"); }}>
                      <X className="size-4" /> استبعد
                    </Button>
                  </div>
                ) : c.stage === "fatigued" ? (
                  <Button size="sm" variant="secondary" onClick={() => toast("انطلب 4 هوكات جديدة على نفس جسم الفيديو من الاستديو.", "success")}>
                    <Send className="size-4" /> اطلب هوكات جديدة
                  </Button>
                ) : null}
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={stage === "inbox" ? "الوارد فاضي" : "ما في شي هون"}
          hint={stage === "inbox" ? "ارمي الفيديوهات بمجلد 01_inbox للمنتج على Drive، والنظام بيفحصها ويسمّيها كل 15 دقيقة." : "لما يوصل فيديو لهالمرحلة بيبيّن هون."}
          art={stage === "inbox" ? "empty-inbox" : "empty-creatives"}
        >
          {stage === "inbox" ? (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted">
              <FolderInput className="size-3.5" /> المنتجات / [المنتج] / 01_inbox
            </span>
          ) : null}
        </EmptyState>
      )}

      <Section title="المكرر والمستبعد" hint="بالبصمة (MD5) — بينقل لمجلد excluded ولا بينحذف أبداً" tour="dups">
        <Panel className="divide-y divide-border p-0">
          {dups.map((d, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-xs">
              <Copy className="size-3.5 text-fg-muted" />
              <span className="text-fg">{name(d.product)}</span>
              <span className="text-fg-muted">{d.dupOf ? <>نسخة طبق الأصل من <span dir="ltr" className="font-mono">{d.dupOf}</span></> : "انستبعد يدوياً"}</span>
            </div>
          ))}
        </Panel>
      </Section>
    </div>
  );
}
