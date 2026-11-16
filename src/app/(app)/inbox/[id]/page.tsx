import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxCard } from "@/components/inbox/inbox-card";
import { DecisionCard } from "@/components/ui/decision-card";
import { Pill } from "@/components/ui/pill";
import { getInboxItem } from "@/server/inbox";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "قرار" };
export const dynamic = "force-dynamic";

/** One decision on its own page: the card, and what happened to it if it is already decided. The links in Telegram and the ring screen open this. */
export default async function InboxItemPage({ params }: { params: { id: string } }) {
  const caller = await currentCaller();
  if (!caller) notFound();
  const found = await getInboxItem(caller, decodeURIComponent(params.id));
  if (!found.item) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/inbox" className="text-sm font-semibold text-info hover:underline">
        ← بانتظارك
      </Link>
      {found.state === "done" ? (
        <>
          <Pill tone="neutral">انقرر: {found.outcome}</Pill>
          <DecisionCard item={found.item} detailLink={false} />
        </>
      ) : (
        <InboxCard item={found.item} />
      )}
    </div>
  );
}
