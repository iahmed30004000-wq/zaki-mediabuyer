"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, ListChecks, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Artifact, Fact, SourceRef } from "@/core/assistant";
import { VERB_AR } from "@/core/job-draft";
import { RECIPE_TITLE } from "@/core/recipes";
import { assigneeName } from "@/core/tasks";
import { stepOrder } from "@/core/workflow";
import { saveDraftJob } from "@/lib/draft-job-client";
import { FROM_ASSISTANT, leaveJobDraft } from "@/lib/job-draft-handoff";
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
    <ul className="list-disc space-y-0.5 ps-5 text-sm leading-5 text-warn">
      {issues.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

function Steps({ graph }: { graph: Parameters<typeof stepOrder>[0] }) {
  return (
    <ol className="list-decimal space-y-0.5 ps-5 text-sm leading-5 text-fg-muted">
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
          {a.assignee || a.dueAt ? <p className="text-sm text-fg-muted">{[assigneeName(a.assignee), a.dueAt?.slice(0, 10)].filter(Boolean).join(" · ")}</p> : null}
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            افتح «المهام» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "task_updated":
      return (
        <div className={card}>
          <Head icon={<ListChecks className="size-4" />}>تحدّثت مهمة</Head>
          <p className="text-fg">{a.title}</p>
          <p className="text-sm text-fg-muted">{a.change}</p>
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            افتح «المهام» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "change_proposed":
      return (
        <div className={card}>
          <Head icon={<Check className="size-4" />}>اقتراح · {a.stateLabel}</Head>
          <p className="text-fg">{a.sentence}</p>
          <p className="text-sm text-fg-muted">
            {a.items} {a.items === 1 ? "تغيير" : "تغييرات"}
            {a.spendDeltaDaily === null ? "" : ` · أثره على الصرف اليومي ${a.spendDeltaDaily >= 0 ? "+" : "−"}${fmt(Math.abs(a.spendDeltaDaily), "$")}`} · ما انتنفّذ شي
          </p>
          <Link href={a.href} onClick={onNavigate} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            افتح القرار بـ «بانتظارك» <ExternalLink className="size-3" />
          </Link>
        </div>
      );

    case "workflow_draft": {
      const open = async () => {
        setBusy(true);
        try {
          const out = await saveDraftJob({ name: a.name, description: a.description, graph: a.graph });
          if (!out.saved) return "error" in out ? toast(out.error, "error") : toast("بالوضع التجريبي ما انعمل شي", "info");
          toast("انعملت المهمة مطفية — راجع خطواتها وشغّلها", "success");
          onNavigate();
          router.push(`/tasks/${encodeURIComponent(out.key)}`);
        } finally {
          setBusy(false);
        }
      };
      return (
        <div className={card}>
          <Head icon={<Workflow className="size-4" />}>مسودة مهمة: {a.name}</Head>
          <p className="text-sm text-fg-muted">{a.summary} — لسا ما انحفظت</p>
          <Steps graph={a.graph} />
          <Issues issues={a.issues} />
          {canDraft ? (
            <Button size="sm" variant="secondary" className="min-h-10 max-md:min-h-[44px]" onClick={open} disabled={busy}>
              {busy ? "لحظة…" : "احفظها مهمة مطفية"}
            </Button>
          ) : (
            <p className="text-sm text-fg-muted">المالك بيفتحها ويحفظها.</p>
          )}
        </div>
      );
    }

    case "node_draft": {
      const open = () => {
        onNavigate();
        router.push(`/tasks/${encodeURIComponent(a.workflowKey)}/edit`);
      };
      return (
        <div className={card}>
          <Head icon={<Workflow className="size-4" />}>خطوة مقترحة على «{a.workflowName}»</Head>
          <p className="text-sm text-fg-muted">{a.summary} — لسا ما انحفظت</p>
          <Issues issues={a.issues} />
          {canDraft ? (
            <Button size="sm" variant="secondary" className="min-h-10 max-md:min-h-[44px]" onClick={open}>
              افتح خطوات المهمة وضيفها
            </Button>
          ) : (
            <p className="text-sm text-fg-muted">المالك بيضيفها بخطوات المهمة وبيحفظها.</p>
          )}
        </div>
      );
    }

    case "job_draft": {
      const open = () => {
        if (!leaveJobDraft(a.draft)) return toast("المتصفح ما سمح بنقل المسودة", "error");
        onNavigate();
        router.push(`/tasks/new${FROM_ASSISTANT}`);
      };
      return (
        <div className={card}>
          <Head icon={<ListChecks className="size-4" />}>مسودة مهمة: {a.draft.name}</Head>
          <p className="text-sm leading-6 text-fg-muted">{a.sentence} — لسا ما انحفظت</p>
          {a.draft.recipe ? (
            <p className="text-sm text-fg-muted">وصفة «{RECIPE_TITLE[a.draft.recipe.name]}» — الموقع بينفّذها لحاله</p>
          ) : (
            <ol className="list-decimal space-y-0.5 ps-5 text-sm leading-6 text-fg-muted">
              {a.draft.steps.slice(0, 8).map((s, i) => (
                <li key={i}>{`${VERB_AR[s.verb]}: ${s.text}`}</li>
              ))}
            </ol>
          )}
          <Button size="sm" variant="secondary" className="min-h-10 max-md:min-h-[44px]" onClick={open}>
            افتحها بـ«مهمة جديدة» وراجعها
          </Button>
        </div>
      );
    }

    case "prompt_draft":
      return (
        <div className={card}>
          <Head icon={<FileText className="size-4" />}>برومبت: {a.title}</Head>
          <pre dir="auto" className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-sm leading-5 text-fg">
            {a.text}
          </pre>
          {a.variables.length ? (
            <p className="flex flex-wrap gap-1 text-sm text-fg-muted">
              المتغيرات:
              {a.variables.map((v) => (
                <code key={v} dir="ltr" className="rounded bg-surface-2 px-1">{`{{${v}}}`}</code>
              ))}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="min-h-10 max-md:min-h-[44px]"
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
    <div className="space-y-1.5 text-sm text-fg-muted">
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
