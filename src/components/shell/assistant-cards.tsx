"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, ListChecks, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Artifact, Fact, SourceRef } from "@/core/assistant";
import { assigneeName } from "@/core/tasks";
import { stepOrder } from "@/core/workflow";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What the assistant made or drafted, as a card under its words. A draft is never saved by the card being shown: the owner opens it. */
const card = "space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm";

function Head({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-semibold text-fg">
      <span className="text-accent">{icon}</span>
      {children}
    </div>
  );
}

function Issues({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return (
    <ul className="list-disc space-y-0.5 ps-5 text-xs leading-5 text-warn">
      {issues.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

function Steps({ graph }: { graph: Parameters<typeof stepOrder>[0] }) {
  return (
    <ol className="list-decimal space-y-0.5 ps-5 text-xs leading-5 text-fg-muted">
      {stepOrder(graph).slice(0, 12).map((n) => (
        <li key={n.id}>{n.label}</li>
      ))}
      {graph.nodes.length > 12 ? <li className="list-none">… و{graph.nodes.length - 12} غيرها</li> : null}
    </ol>
  );
}

export function ArtifactCard({ a, canDraft, onNavigate }: { a: Artifact; canDraft: boolean; onNavigate: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  switch (a.kind) {
    case "task_created":
      return (
        <div className={card}>
          <Head icon={<ListChecks className="size-4" />}>انعملت مهمة</Head>
          <p className="text-fg">{a.title}</p>
          {a.assignee || a.dueAt ? <p className="text-xs text-fg-muted">{[assigneeName(a.assignee), a.dueAt?.slice(0, 10)].filter(Boolean).join(" · ")}</p> : null}
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            افتح «المهام» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "task_updated":
      return (
        <div className={card}>
          <Head icon={<ListChecks className="size-4" />}>تحدّثت مهمة</Head>
          <p className="text-fg">{a.title}</p>
          <p className="text-xs text-fg-muted">{a.change}</p>
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            افتح «المهام» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "change_proposed":
      return (
        <div className={card}>
          <Head icon={<Check className="size-4" />}>اقتراح · {a.stateLabel}</Head>
          <p className="text-fg">{a.sentence}</p>
          <p className="text-xs text-fg-muted">
            {a.items} {a.items === 1 ? "تغيير" : "تغييرات"}
            {a.spendDeltaDaily === null ? "" : ` · أثره على الصرف اليومي ${a.spendDeltaDaily >= 0 ? "+" : "−"}${fmt(Math.abs(a.spendDeltaDaily), "$")}`} · ما انتنفّذ شي
          </p>
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            افتح «المهام ← بانتظار موافقتك» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "workflow_draft": {
      const open = async () => {
        setBusy(true);
        try {
          const r = await fetch("/api/workflow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: a.name, ...(a.description ? { description: a.description } : {}), graph: a.graph, enabled: false, note: "مسودة من المساعد" }) });
          const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; workflow?: { key: string } };
          if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
          if (d.demo || !d.workflow) return toast("بالوضع التجريبي ما انعمل شي", "info");
          toast("انعمل ورك فلو مطفي — هي لوحة الرسم", "success");
          onNavigate();
          router.push(`/workflow/${d.workflow.key}`);
        } finally {
          setBusy(false);
        }
      };
      return (
        <div className={card}>
          <Head icon={<Workflow className="size-4" />}>مسودة ورك فلو: {a.name}</Head>
          <p className="text-xs text-fg-muted">{a.summary} — لسا ما انحفظت</p>
          <Steps graph={a.graph} />
          <Issues issues={a.issues} />
          {canDraft ? (
            <Button size="sm" variant="secondary" className="min-h-9" onClick={open} disabled={busy}>
              {busy ? "لحظة…" : "افتحها بلوحة الرسم (مطفية)"}
            </Button>
          ) : (
            <p className="text-xs text-fg-muted">المالك بيفتحها ويحفظها.</p>
          )}
        </div>
      );
    }

    case "node_draft": {
      const open = () => {
        try {
          sessionStorage.setItem(`mb:wf-draft:${a.workflowKey}`, JSON.stringify({ graph: a.graph, note: `مسودة المساعد: ${a.summary}` }));
        } catch {
          return toast("المتصفح ما سمح بنقل المسودة", "error");
        }
        onNavigate();
        router.push(`/workflow/${a.workflowKey}`);
      };
      return (
        <div className={card}>
          <Head icon={<Workflow className="size-4" />}>خطوة مقترحة على «{a.workflowName}»</Head>
          <p className="text-xs text-fg-muted">{a.summary} — لسا ما انحفظت</p>
          <Issues issues={a.issues} />
          {canDraft ? (
            <Button size="sm" variant="secondary" className="min-h-9" onClick={open}>
              افتح الرسم وفيه الخطوة
            </Button>
          ) : (
            <p className="text-xs text-fg-muted">المالك بيفتح الرسم وبيحفظها.</p>
          )}
        </div>
      );
    }

    case "prompt_draft":
      return (
        <div className={card}>
          <Head icon={<FileText className="size-4" />}>برومبت: {a.title}</Head>
          <pre dir="auto" className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs leading-5 text-fg">
            {a.text}
          </pre>
          {a.variables.length ? (
            <p className="flex flex-wrap gap-1 text-[11px] text-fg-muted">
              المتغيرات:
              {a.variables.map((v) => (
                <code key={v} dir="ltr" className="rounded bg-surface-2 px-1">{`{{${v}}}`}</code>
              ))}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="min-h-9"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(a.text);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              } catch {
                toast("ما قدرت أنسخ — انسخه يدوياً", "error");
              }
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "اننسخ" : "انسخه"}
          </Button>
        </div>
      );
  }
}

/** «الأرقام اللي جاوبت منها»: what the tools returned, printed by the code — the ones the answer says come first. */
export function FactsList({ facts, sources, onNavigate }: { facts: Fact[]; sources: SourceRef[]; onNavigate: () => void }) {
  const numbered = facts.filter((f) => f.value !== "");
  const notes = facts.filter((f) => f.value === "");
  return (
    <div className="space-y-1.5 text-xs text-fg-muted">
      {sources.length ? (
        <p className="flex flex-wrap items-center gap-1.5">
          <span>المصدر:</span>
          {sources.map((s) =>
            s.href ? (
              <Link key={s.id} href={s.href} onClick={onNavigate} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-fg hover:border-accent/60 hover:bg-accent/5">
                {s.label}
                <ExternalLink className="size-3" />
              </Link>
            ) : (
              <span key={s.id} className="rounded-full border border-border px-2 py-0.5 text-fg">
                {s.label}
              </span>
            ),
          )}
        </p>
      ) : null}
      {facts.length ? (
        <details>
          <summary className="cursor-pointer">الأرقام اللي جاوبت منها ({facts.length})</summary>
          <ul className="mt-1 space-y-1">
            {numbered.map((f, n) => (
              <li key={`${f.source}-${n}`} className={cn("flex items-baseline justify-between gap-3", f.cited ? "font-semibold text-fg" : "")}>
                <span className="min-w-0">{f.label}</span>
                <span dir="ltr" className="shrink-0 tabular-nums">{f.value}</span>
              </li>
            ))}
            {notes.map((f, n) => (
              <li key={`n-${n}`} className="list-disc ms-4">{f.label}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
