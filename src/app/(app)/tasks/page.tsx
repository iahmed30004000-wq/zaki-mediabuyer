import { ListChecks } from "lucide-react";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { ChangeCard } from "@/components/mb/change-card";
import { Panel, Section } from "@/components/mb/section";
import { DecisionsLog } from "@/components/pages/decisions-log";
import { EmptyState } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import { loadChanges } from "@/lib/changes-view";
import { listApprovals } from "@/server/approvals";

export const metadata = { title: "المهام" };
export const dynamic = "force-dynamic";

/**
 * المهام: everything that waits for somebody. The first column is «بانتظار موافقتك» — what used to be the decisions page:
 * every change to Meta passes here (proposal → test → approval → execution → verification → revert), approved on the
 * site only, never from Telegram.
 */
export default async function TasksPage() {
  const [changes, requests] = await Promise.all([loadChanges(), process.env.MOCK_MODE === "1" ? Promise.resolve([]) : listApprovals({ status: ["pending", "postponed"] })]);
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
          ) : (
            <EmptyState title="ما في شي بانتظارك" hint="لما قاعدة أو وكيل يقترح صرف، بيوصلك هون وعلى تيليجرام كتنبيه." art="empty-decisions" />
          )}
        </div>
      </Section>

      <Panel className="flex items-center gap-3 text-sm text-fg-muted">
        <ListChecks className="size-5 shrink-0 text-accent" />
        <p>مهام الفريق (جديد · شغال · متوقف · خلص) بتظهر هون بعد التحديث الجاي — بنفس الصفحة، بلا صفحة جديدة.</p>
      </Panel>

      <DecisionsLog changes={changes} />
    </div>
  );
}
