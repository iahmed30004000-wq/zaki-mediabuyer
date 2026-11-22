import { Bot, Hand, Check, CircleDashed, Loader2, TriangleAlert, UserCheck } from "lucide-react";
import { EXECUTOR_AR, PERMISSION_AR, type Executor, type NodeStatus, type Permission } from "@/core/workflow";
import { cn } from "@/lib/utils";

const PERM: Record<Permission, string> = {
  green: "bg-ok/10 text-ok border-ok/30",
  yellow: "bg-warn/10 text-warn border-warn/30",
  red: "bg-danger/10 text-danger border-danger/30",
  black: "bg-fg text-surface border-fg",
};
const PERM_SHORT: Record<Permission, string> = { green: "أخضر", yellow: "أصفر", red: "أحمر", black: "أسود" };

/** The permission badge every node and every workflow carries: أخضر · أصفر · أحمر · أسود. */
export function PermBadge({ permission, className }: { permission: Permission | undefined; className?: string }) {
  if (!permission) return null;
  return (
    <span title={PERMISSION_AR[permission]} className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold", PERM[permission], className)}>
      {PERM_SHORT[permission]}
    </span>
  );
}

export function ExecutorBadge({ executor, className }: { executor: Executor | string | undefined; className?: string }) {
  if (!executor) return null;
  const label = EXECUTOR_AR[executor as Executor] ?? executor;
  const claude = executor.startsWith("claude");
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg-muted", className)}>
      {claude ? <Bot className="size-3" /> : null}
      {label}
    </span>
  );
}

export const NODE_STATE_AR: Record<NodeStatus, string> = { waiting: "بالانتظار", running: "عم يشتغل", done: "خلص", failed: "فشل", handoff: "متوقف — Claude بيكمّلها", approval: "بانتظار موافقتك", skipped: "انتخطّت" };

/** The icon of a node's live state. */
export function StateIcon({ status, className }: { status: NodeStatus | undefined; className?: string }) {
  if (status === "done") return <Check className={cn("wf-check size-4 text-ok", className)} />;
  if (status === "running") return <Loader2 className={cn("size-4 animate-spin text-accent motion-reduce:animate-none", className)} />;
  if (status === "failed") return <TriangleAlert className={cn("size-4 text-danger", className)} />;
  if (status === "handoff") return <Bot className={cn("size-4 text-warn", className)} />;
  if (status === "approval") return <UserCheck className={cn("size-4 text-warn", className)} />;
  if (status === "waiting") return <Hand className={cn("size-4 text-fg-muted", className)} />;
  return <CircleDashed className={cn("size-4 text-fg-muted/60", className)} />;
}
