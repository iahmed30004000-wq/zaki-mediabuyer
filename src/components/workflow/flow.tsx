"use client";

import { useState } from "react";
import { Bell, Clock, GitBranch, Hourglass, Play, UserCheck } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { stepOrder, type NodeStates, type NodeType, type WfGraph, type WfNode } from "@/core/workflow";
import { cn } from "@/lib/utils";
import { ExecutorBadge, NODE_STATE_AR, PermBadge, StateIcon } from "./badges";
import "./workflow.css";

const TYPE_ICON: Record<NodeType, typeof Play> = { trigger: Clock, step: Play, condition: GitBranch, approval: UserCheck, wait: Hourglass, notify: Bell };
const TYPE_AR: Record<NodeType, string> = { trigger: "بداية", step: "خطوة", condition: "شرط", approval: "موافقة المالك", wait: "انتظار", notify: "تبليغ" };
const SOURCE_AR: Record<string, string> = { api: "API", mcp: "Claude (MCP)", manual: "يدوي" };

/** One node, as a pill: its label, its permission, and its live state (a ring while it runs, a check, a shake when it fails…). */
function Node({ node, states, onOpen }: { node: WfNode; states: NodeStates; onOpen: (n: WfNode) => void }) {
  const st = states[node.id];
  const Icon = TYPE_ICON[node.type];
  return (
    <button
      type="button"
      onClick={() => onOpen(node)}
      data-state={st?.status ?? "idle"}
      aria-label={`${node.label} — ${st ? NODE_STATE_AR[st.status] : "ما اشتغل"}`}
      className={cn("wf-node flex min-h-11 min-w-[7.5rem] max-w-[11rem] items-center gap-2 rounded-xl border bg-surface-1 px-3 py-2 text-start", node.disabled ? "border-dashed border-border opacity-50" : "border-border", node.type === "approval" && "border-warn/50")}
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg">{node.label}</span>
        <span className="mt-0.5 flex items-center gap-1">
          <PermBadge permission={node.permission} />
        </span>
      </span>
      <StateIcon status={st?.status} />
    </button>
  );
}

/** The line between two steps. Data flows along it (a moving dash) while the step before it is done and the next one is working. */
function Edge({ flowing }: { flowing: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 28 10" className="h-2.5 w-7 shrink-0 text-fg-muted rtl:-scale-x-100">
      <line x1="1" y1="5" x2="27" y2="5" className="wf-edge" data-flowing={flowing} />
    </svg>
  );
}

const isMoving = (s: NodeStates, id: string) => ["running", "handoff", "approval"].includes(s[id]?.status ?? "");

/** The drawing: the steps in the order they run, joined by their lines (md and up). On a phone the same graph is the steps list. */
export function FlowStrip({ graph, states }: { graph: WfGraph; states: NodeStates }) {
  const [open, setOpen] = useState<WfNode | null>(null);
  const order = stepOrder(graph);
  return (
    <>
      <div className="hidden min-w-0 max-w-full items-center gap-0 overflow-x-auto py-1 md:flex" style={{ ["--wf-accent-rgb" as string]: "var(--accent-rgb, 37 99 235)" }}>
        {order.map((n, i) => (
          <div key={n.id} className="flex shrink-0 items-center">
            {i > 0 ? <Edge flowing={states[order[i - 1]!.id]?.status === "done" && isMoving(states, n.id)} /> : null}
            <Node node={n} states={states} onOpen={setOpen} />
          </div>
        ))}
      </div>
      <ol className="space-y-1.5 md:hidden">
        {order.map((n, i) => {
          const st = states[n.id];
          return (
            <li key={n.id}>
              <button type="button" onClick={() => setOpen(n)} data-state={st?.status ?? "idle"} className="wf-node flex w-full min-h-12 items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2 text-start">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-fg-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{n.label}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <PermBadge permission={n.permission} />
                    <ExecutorBadge executor={n.executor} />
                  </span>
                </span>
                <StateIcon status={st?.status} />
              </button>
            </li>
          );
        })}
      </ol>
      <NodeSheet node={open} state={open ? states[open.id] : undefined} onClose={() => setOpen(null)} />
    </>
  );
}

/** A node's card (a bottom sheet on a phone): who does it, how risky it is, what goes in and out, where the result lands, and how it is doing now. */
function NodeSheet({ node, state, onClose }: { node: WfNode | null; state: NodeStates[string] | undefined; onClose: () => void }) {
  const row = (k: string, v: string | number | undefined) => (v === undefined || v === "" ? null : (
    <div>
      <dt className="text-xs text-fg-muted">{k}</dt>
      <dd className="text-sm text-fg">{v}</dd>
    </div>
  ));
  return (
    <Sheet open={!!node} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {node ? (
          <>
            <SheetHeader>
              <SheetTitle>{node.label}</SheetTitle>
              <SheetDescription>
                {TYPE_AR[node.type]}
                {state ? ` · ${NODE_STATE_AR[state.status]}` : ""}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <PermBadge permission={node.permission} />
                <ExecutorBadge executor={node.executor} />
                {node.dataSource ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">الأرقام: {SOURCE_AR[node.dataSource]}</span> : null}
              </div>
              {state?.note ? <p className="rounded-lg bg-surface-2 p-2 text-sm text-fg">{state.note}</p> : null}
              <dl className="space-y-3">
                {row("المسؤول", node.assignee)}
                {row("الدخل", node.inputs)}
                {row("الخرج", node.outputs)}
                {row("وين بتوصل النتيجة", node.destination)}
                {row("المهلة", node.timeoutS ? `${node.timeoutS} ثانية` : undefined)}
                {row("إعادة المحاولة", node.retries)}
                {row("إذا فشلت", node.fallback)}
              </dl>
              {node.prompt ? <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-xs leading-6 text-fg">{node.prompt}</pre> : null}
              {node.permission === "black" ? <p className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">ممنوع على الوكلاء: دفع · حذف · تسجيل خروج · CAPTCHA · توكنات · ورك فلو «ورك فلو n8n الرئيسي».</p> : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
