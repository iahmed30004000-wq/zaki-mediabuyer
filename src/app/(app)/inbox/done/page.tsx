import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Pill } from "@/components/ui/pill";
import { RollbackButton } from "@/components/inbox/rollback-button";
import { loadInboxDone } from "@/server/inbox";
import { currentCaller, requirePage } from "@/server/auth";
import { cn } from "@/lib/utils";

export const metadata = { title: "قررتها" };
export const dynamic = "force-dynamic";

const PAGE = 25;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** بانتظارك ← قررتها: the last 30 days — what you answered and what the rules did by themselves («لحاله»), with «رجّع» for a change that ran. */
export default async function InboxDonePage({ searchParams: searchParamsP }: { searchParams: Promise<{ auto?: string; page?: string }> }) {
  await requirePage("inbox.view");
  const searchParams = await searchParamsP;
  const caller = await currentCaller();
  const autoOnly = searchParams.auto === "1";
  const all = caller ? await loadInboxDone(caller, { autoOnly }) : [];
  const page = Math.max(1, Number(searchParams.page) || 1);
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  const qs = (p: number) => `?${autoOnly ? "auto=1&" : ""}page=${p}`;
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="مين قرّر">
        <Link href="/inbox/done" aria-current={!autoOnly ? "true" : undefined}>
          <Chip className={cn("h-10 max-md:h-[44px] px-3 text-sm", !autoOnly && "border-accent bg-accent text-accent-fg")}>الكل</Chip>
        </Link>
        <Link href="/inbox/done?auto=1" aria-current={autoOnly ? "true" : undefined}>
          <Chip className={cn("h-10 max-md:h-[44px] px-3 text-sm", autoOnly && "border-accent bg-accent text-accent-fg")}>صار لحاله</Chip>
        </Link>
      </div>
      {rows.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-1">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Pill tone={d.tone === "ok" ? "ok" : d.tone === "danger" ? "danger" : "neutral"}>{d.outcome}</Pill>
              <Link href={d.href} className="inline-flex min-h-10 min-w-0 flex-1 items-center text-sm font-semibold text-fg hover:underline max-md:min-h-[44px]">
                {d.title}
              </Link>
              <span className="text-xs text-fg-muted">
                {d.by} · {when(d.at)}
              </span>
              {d.canRollback ? <RollbackButton id={d.id.replace(/^change:/, "")} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={autoOnly ? "ما صار شي لحاله" : "ما في قرارات لسا"} hint="كل قرار بتقرره، وكل قرار أمان بتاخده قاعدة لحالها، بيطلع هون آخر 30 يوم." />
      )}
      {all.length > PAGE ? (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="inline-flex min-h-10 items-center font-semibold text-info hover:underline max-md:min-h-[44px]">السابق</Link> : <span />}
          <span className="text-fg-muted">
            {page} / {Math.ceil(all.length / PAGE)}
          </span>
          {page * PAGE < all.length ? <Link href={qs(page + 1)} className="inline-flex min-h-10 items-center font-semibold text-info hover:underline max-md:min-h-[44px]">التالي</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
