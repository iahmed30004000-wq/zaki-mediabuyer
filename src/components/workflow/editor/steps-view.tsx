"use client";

import { ArrowDown, ArrowUp, ChevronLeft } from "lucide-react";
import type { NodeStates, WfGraph } from "@/core/workflow";
import { stepOrder } from "@/core/workflow";
import { TYPE_AR, isChain } from "@/core/workflow-edit";
import { cn } from "@/lib/utils";
import { ExecutorBadge, NODE_STATE_AR, PermBadge, StateIcon } from "../badges";
import "../workflow.css";
import { TYPE_ICON } from "./canvas";

/**
 * The same drawing as a list, in the order it runs — the way a phone opens it. A step opens its card with a tap; on a straight
 * line the arrows move it up or down; «＋» puts a step right after it. A drawing that branches says so, and is wired on the board.
 */
export function StepsView({
  graph,
  states,
  readOnly,
  selected,
  onOpen,
  onMove,
}: {
  graph: WfGraph;
  states: NodeStates;
  readOnly?: boolean;
  selected: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const order = stepOrder(graph);
  const chain = isChain(graph);
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div className="h-full overflow-y-auto p-3" data-tour="steps">
      {!chain ? <p className="mb-3 rounded-lg border border-dashed border-border p-2.5 text-xs leading-5 text-fg-muted">الرسم بيتفرّع أو بيلتقي — الأسهم معطّلة. اضغط على الخطوة بتشوف شو قبلها وشو بعدها وبتغيّرها، أو افتح اللوحة.</p> : null}
      <ol className="space-y-2">
        {order.map((n, i) => {
          const st = states[n.id];
          const Icon = TYPE_ICON[n.type];
          const before = graph.edges.filter((e) => e.to === n.id).map((e) => nameOf(e.from));
          const after = graph.edges.filter((e) => e.from === n.id).map((e) => (e.label ? `${e.label}: ${nameOf(e.to)}` : nameOf(e.to)));
          return (
            <li key={n.id} className={cn("rounded-xl border bg-surface-1", selected === n.id ? "border-accent" : "border-border", n.disabled && "border-dashed opacity-60")}>
              <div className="flex items-stretch">
                <button type="button" onClick={() => onOpen(n.id)} data-state={st?.status ?? "idle"} className="wf-node flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-start" aria-label={`${n.label} — ${TYPE_AR[n.type]}${st ? ` — ${NODE_STATE_AR[st.status]}` : ""}`}>
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                      <Icon className="size-3.5 shrink-0 text-fg-muted" />
                      <span className="truncate">{n.label}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <PermBadge permission={n.permission} />
                      <ExecutorBadge executor={n.executor} />
                      {n.disabled ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">معطّلة</span> : null}
                    </span>
                  </span>
                  <StateIcon status={st?.status} />
                  <ChevronLeft className="size-4 shrink-0 text-fg-muted" aria-hidden />
                </button>
                {readOnly || !chain ? null : (
                  <div className="flex shrink-0 flex-col justify-center gap-1 border-s border-border px-1">
                    {/* arrows */}
                    <>
                        <button type="button" aria-label={`حرّك «${n.label}» لفوق`} disabled={i === 0} onClick={() => onMove(n.id, -1)} className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30">
                          <ArrowUp className="size-4" />
                        </button>
                        <button type="button" aria-label={`حرّك «${n.label}» لتحت`} disabled={i === order.length - 1} onClick={() => onMove(n.id, 1)} className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30">
                          <ArrowDown className="size-4" />
                        </button>
                    </>
                  </div>
                )}
              </div>
              {!chain && (before.length || after.length) ? (
                <p className="border-t border-border px-3 py-1.5 text-[11px] leading-5 text-fg-muted">
                  {before.length ? `بعد: ${before.join("، ")}` : "بداية"}
                  {after.length ? ` · بتوصّل: ${after.join("، ")}` : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
