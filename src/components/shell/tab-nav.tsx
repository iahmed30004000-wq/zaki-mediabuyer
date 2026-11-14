import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs that are plain links: the address says which tab is open (`?tab=…`), so the back button and a shared link land
 * on the same tab and the page keeps its filters. Server-rendered — no client state to lose.
 */
export function TabNav({ tabs, active, base, label, tour }: { tabs: readonly { key: string; label: string }[]; active: string; base: string; label?: string; tour?: string }) {
  return (
    <div role="tablist" aria-label={label} data-tour={tour} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          href={`${base}?tab=${t.key}`}
          className={cn("inline-flex min-h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium", active === t.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
