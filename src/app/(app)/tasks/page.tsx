import { ApprovalCard } from "@/components/approvals/approval-card";
import { ChangeCard } from "@/components/mb/change-card";
import { Section } from "@/components/mb/section";
import { DecisionsLog } from "@/components/pages/decisions-log";
import { TasksBoard } from "@/components/tasks/tasks-board";
import { EmptyState } from "@/components/ui/card";
import { can } from "@/core/roles";
import { fmt } from "@/lib/format";
import { loadTasksCustom } from "@/lib/ui-view";
import { loadChanges } from "@/lib/changes-view";
import { listApprovals } from "@/server/approvals";
import { currentCaller } from "@/server/auth";
import { listTasks } from "@/server/tasks";

export const metadata = { title: "المهام" };
export const dynamic = "force-dynamic";

/**
 * المهام: everything that waits for somebody. The first part is «بانتظار موافقتك» — what used to be the decisions page:
 * every change to Meta passes here (proposal → test → approval → execution → verification → revert), approved on the
 * site only, never from Telegram. Under it the team's board (جديد · شغّال · بانتظار موافقة · متوقف · خلص) and its
 * operations boards, then the log of what the system did on its own.
 */
export default async function TasksPage() {
  const now = new Date();
  const [changes, requests, tasks, me] = await Promise.all([
    loadChanges(),
    process.env.MOCK_MODE === "1" ? Promise.resolve([]) : listApprovals({ status: ["pending", "postponed"] }),
    listTasks({ limit: 300, doneWithinDays: 14 }, now),
    currentCaller(),
  ]);
  const custom = await loadTasksCustom(tasks.map((t) => t.id));
  const pending = changes.filter((c) => c.state === "pending_approval");
  const delta = pending.reduce((s, c) => s + c.spendDeltaDaily, 0);
  const waiting = pending.length + requests.length;
  return (
    <div className="space-y-8">
      <Section
        title="بانتظار موافقتك"
        hint={pending.length && delta !== 0 ? `لو وافقت على قرارات الإعلانات: ${delta > 0 ? "+" : ""}${fmt(delta, "$", 0)} باليوم` : "أي زيادة صرف أو إنشاء — بالموقع بس، أبداً من تيليجرام"}
        tour="pending"
      >
        <div id="approval" className="scroll-mt-24">
          {waiting ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {requests.map((a) => <ApprovalCard key={a.id} approval={a} />)}
              {pending.map((c) => <ChangeCard key={c.id} change={c} />)}
            </div>
          ) : tasks.length ? (
            // the team's board is under it: a line, not a whole screen of empty illustration
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-fg-muted">ما في شي بانتظارك ✓ — لما قاعدة أو وكيل يقترح صرف، بيوصلك هون وعلى تيليجرام كتنبيه.</p>
          ) : (
            <EmptyState title="ما في شي بانتظارك" hint="لما قاعدة أو وكيل يقترح صرف، بيوصلك هون وعلى تيليجرام كتنبيه." art="empty-decisions" />
          )}
        </div>
      </Section>

      <Section title="مهام الفريق" hint="مين وإمتى وشو — بسطر وحد. أي مهمة بيطلبها Claude أو هيرمز بتنزل هون كمان">
        <TasksBoard initial={tasks} canEdit={!!me && can(me.role, "propose_change") && !me.demo} nowIso={now.toISOString()} custom={custom} />
      </Section>

      <DecisionsLog changes={changes} />
    </div>
  );
}
