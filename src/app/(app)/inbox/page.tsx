import Link from "next/link";
import { InboxCard } from "@/components/inbox/inbox-card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/card";
import { DOMAIN_AR, type InboxDomain } from "@/core/inbox";
import { loadInbox } from "@/server/inbox";
import { currentCaller, requirePage } from "@/server/auth";
import { cn } from "@/lib/utils";

export const metadata = { title: "بانتظارك" };
export const dynamic = "force-dynamic";

const DOMAINS: readonly (InboxDomain | "all")[] = ["all", "ads", "ops", "work"];

/**
 * بانتظارك ← بدها قرارك: every decision that waits, as the same card — what Claude asked, every change to Meta, a job nobody can finish.
 * Red first, then the one that runs out soonest, then the newest. Approved on the site only, never from Telegram.
 */
export default async function InboxPage({ searchParams }: { searchParams: { domain?: string } }) {
  await requirePage("inbox.view");
  const caller = await currentCaller();
  const domain = (DOMAINS as readonly string[]).includes(searchParams.domain ?? "") && searchParams.domain !== "all" ? (searchParams.domain as InboxDomain) : undefined;
  const items = caller ? await loadInbox(caller, domain ? { domain } : {}) : [];
  return (
    <div className="space-y-4" data-tour="pending">
      <div className="flex flex-wrap gap-2" role="group" aria-label="المجال">
        {DOMAINS.map((d) => {
          const active = (d === "all" && !domain) || d === domain;
          return (
            <Link key={d} href={d === "all" ? "/inbox" : `/inbox?domain=${d}`} aria-current={active ? "true" : undefined}>
              <Chip className={cn("h-10 max-md:h-[44px] px-3 text-sm", active && "border-accent bg-accent text-accent-fg")}>{d === "all" ? "الكل" : DOMAIN_AR[d]}</Chip>
            </Link>
          );
        })}
      </div>
      {items.length ? (
        <div id="approval" className="grid scroll-mt-24 gap-3 lg:grid-cols-2">
          {items.map((i) => (
            <InboxCard key={i.id} item={i} />
          ))}
        </div>
      ) : (
        <EmptyState title="ما في شي بانتظارك ✓" hint="لما قاعدة أو Claude يقترح صرف أو سؤال، بيوصلك هون وعلى تيليجرام كتنبيه." />
      )}
    </div>
  );
}
