import { ApprovalCard } from "@/components/approvals/approval-card";
import { ChangeCard } from "@/components/mb/change-card";
import { Section } from "@/components/mb/section";
import { DecisionsLog } from "@/components/pages/decisions-log";
import { EmptyState } from "@/components/ui/card";
import { isDemo } from "@/core/readiness";
import { fmt } from "@/lib/format";
import { loadChanges } from "@/lib/changes-view";
import { listApprovals } from "@/server/approvals";

export const metadata = { title: "بانتظارك" };
export const dynamic = "force-dynamic";

/**
 * بانتظارك: every decision that waits for the owner — what Claude asked and every change to Meta (proposal → test → approval →
 * execution → verification → revert). Approved on the site only, never from Telegram. P3 rebuilds it around one decision card.
 */
export default async function InboxPage() {
  const [changes, requests] = await Promise.all([loadChanges(), isDemo(process.env) ? Promise.resolve([]) : listApprovals({ status: ["pending", "postponed"] })]);
  const pending = changes.filter((c) => c.state === "pending_approval");
  const delta = pending.reduce((s, c) => s + c.spendDeltaDaily, 0);
  const waiting = pending.length + requests.length;
  return (
    <div className="space-y-8">
      <Section
        title="بدها قرارك"
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
            <EmptyState title="ما في شي بانتظارك ✓" hint="لما قاعدة أو وكيل يقترح صرف، بيوصلك هون وعلى تيليجرام كتنبيه." />
          )}
        </div>
      </Section>

      <DecisionsLog changes={changes} />
    </div>
  );
}
