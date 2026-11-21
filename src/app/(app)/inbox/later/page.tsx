import { InboxCard } from "@/components/inbox/inbox-card";
import { EmptyState } from "@/components/ui/card";
import { loadInboxLater } from "@/server/inbox";
import { currentCaller, requirePage } from "@/server/auth";

export const metadata = { title: "مؤجّلة" };
export const dynamic = "force-dynamic";

/** بانتظارك ← مؤجّلة: what you put off, and when each one comes back (it comes back by itself). */
export default async function InboxLaterPage() {
  await requirePage("inbox.view");
  const caller = await currentCaller();
  const items = caller ? await loadInboxLater(caller) : [];
  return items.length ? (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((i) => (
        <InboxCard key={i.id} item={i} />
      ))}
    </div>
  ) : (
    <EmptyState title="ما أجّلت شي" hint="لما تأجّل قرار، بيجي هون وبيرجع لبانتظارك بالوقت اللي حددته." />
  );
}
