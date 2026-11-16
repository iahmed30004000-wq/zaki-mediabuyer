import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HashRedirect } from "@/components/settings/hash-redirect";
import { SETTINGS_PAGES } from "@/lib/settings-nav";
import { loadReadiness } from "@/lib/readiness-view";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات: six lines, each a page (docs/rebuild/02-structure.md §3.7). Nothing is edited here. The long page of the older versions is gone; its old
 * `#anchors` (an alert, a message, a bookmark) are sent to the new address by `HashRedirect`.
 */
export default async function SettingsPage() {
  const readiness = await loadReadiness().catch(() => null);
  const linked = readiness ? readiness.rows.filter((r) => r.linked).length : null;
  return (
    <div className="space-y-3">
      <HashRedirect />
      <ul data-tour="groups" className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
        {SETTINGS_PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block text-base font-extrabold text-fg">{p.title}</span>
                <span className="block text-sm text-fg-muted">{p.line}</span>
              </span>
              {p.href === "/settings/connections" && readiness && linked !== null ? <span className="shrink-0 text-sm font-bold text-fg-muted">{linked} من {readiness.rows.length} مربوطين</span> : null}
              <ChevronLeft className="size-5 shrink-0 text-fg-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
