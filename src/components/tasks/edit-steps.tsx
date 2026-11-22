"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { VersionsSheet } from "@/components/tasks/versions-sheet";
import { addStep, draftGraph, graphToSteps, moveItem, moveStep, removeItem, removeStep, setElse, setStepText, settleLayout, validateSteps, type DraftStep } from "@/core/job-draft";
import type { Executor, WfGraph } from "@/core/workflow";
import { graphDiff, isChanged } from "@/core/workflow-edit";
import { callJson } from "@/lib/call";
import { StepsBuilder } from "./steps-builder";

interface Saved {
  ok?: boolean;
  demo?: boolean;
}

/**
 * «تعديل الخطوات» (docs/rebuild-v6/02-screens.md §3.8): the same blocks as «ركّبها», filled from the drawing the job has. A block that came from a node and was not touched stays that node (its id,
 * who does it, its badge, its switch); the save sends the new drawing with the version this page was loaded with, so a save made meanwhile is not written over («حدا عدّلها قبلك»).
 * Every save is a new version; the old ones are in «النسخ السابقة» in the «⋯», and one opened from there is only a draft until it is saved.
 */
export function EditSteps({ jobKey, jobName, version, graph, executor, demo }: { jobKey: string; jobName: string; version: number; graph: WfGraph; executor: Executor; demo: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const first = useMemo(() => {
    const r = graphToSteps(graph);
    return r.ok ? r : { steps: [] as DraftStep[], ids: [] as string[], off: [] as boolean[] };
  }, [graph]);
  const [base, setBase] = useState<WfGraph>(graph);
  const [steps, setSteps] = useState<DraftStep[]>(first.steps);
  const [ids, setIds] = useState<(string | null)[]>(first.ids);
  const [off, setOff] = useState<boolean[]>(first.off);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState(false);

  const next = useMemo(() => settleLayout(graph, draftGraph(steps, { executor, triggerLabel: "", keep: { base, ids } })), [steps, ids, base, graph, executor]);
  const dirty = useMemo(() => isChanged(graphDiff(graph, next)), [graph, next]);

  const change = (f: () => void) => {
    setError(null);
    f();
  };

  const save = async () => {
    const check = validateSteps(steps);
    if (!check.ok) return setError(check.message);
    if (!steps.length) return setError("ضيف خطوة وحدة على الأقل");
    setSaving(true);
    try {
      const r = await callJson<Saved>(`/api/workflow/${encodeURIComponent(jobKey)}`, { method: "PATCH", body: { graph: next, baseVersion: version } });
      if (!r.ok) return setError(r.status === 409 ? "حدا عدّلها قبلك — حدّث الصفحة" : (r.error ?? "صار خطأ"));
      if (r.data?.demo) return toast("بالوضع التجريبي ما انحفظ شي", "info");
      toast("تمّت ✓ — انحفظت نسخة جديدة من الخطوات", "success");
      router.push(`/tasks/${encodeURIComponent(jobKey)}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-extrabold text-fg">تعديل الخطوات</h2>
          <p className="truncate text-base text-fg-muted">{jobName}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="المزيد" title="المزيد">
              <Ellipsis className="size-5" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setVersions(true)}>النسخ السابقة</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/tasks/${encodeURIComponent(jobKey)}/edit?view=board`}>لوحة الرسم (متقدّم)</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <section data-tour="steps" className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
        <StepsBuilder
          steps={steps}
          off={off}
          onText={(at, text) => change(() => setSteps(setStepText(steps, at, text)))}
          onElse={(at, to) => change(() => setSteps(setElse(steps, at, to)))}
          onMove={(at, by) =>
            change(() => {
              setSteps(moveStep(steps, at, by));
              setIds(moveItem(ids, at, by));
              setOff(moveItem(off, at, by));
            })
          }
          onRemove={(at) =>
            change(() => {
              setSteps(removeStep(steps, at));
              setIds(removeItem(ids, at));
              setOff(removeItem(off, at));
            })
          }
          onAdd={(verb) =>
            change(() => {
              setSteps(addStep(steps, verb));
              setIds([...ids, null]);
              setOff([...off, false]);
            })
          }
        />
      </section>

      <div data-tour="save" className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-border bg-surface-1/95 p-3 backdrop-blur md:bottom-4">
        {error ? (
          <p role="alert" className="text-base font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-base text-fg-muted">{dirty ? "فيه تعديلات ما انحفظت. كل حفظ بيعمل نسخة جديدة، والقديمة بتضل." : "ما تغيّر شي لسا."}</p>
          <Button size="lg" loading={saving} disabled={!dirty} onClick={save}>
            احفظ
          </Button>
        </div>
      </div>

      <VersionsSheet
        open={versions}
        onClose={() => setVersions(false)}
        workflowKey={jobKey}
        canEdit
        demo={demo}
        onLoad={(g) => {
          const r = graphToSteps(g);
          if (!r.ok) return toast("النسخة هاي مش خط واحد — افتحها باللوحة المتقدّمة", "error");
          setBase(g);
          setSteps(r.steps);
          setIds(r.ids);
          setOff(r.off);
          setError(null);
          setVersions(false);
          toast("فتحتها كمسودة — اضغط «احفظ» لتعمل منها نسخة جديدة", "info");
        }}
      />
    </div>
  );
}
