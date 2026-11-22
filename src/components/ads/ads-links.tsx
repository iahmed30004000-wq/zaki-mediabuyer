import Link from "next/link";
import { isDemo } from "@/core/readiness";
import { gatherScale } from "@/jobs/scale-run";

const link = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-4 text-base font-semibold text-fg hover:bg-surface-2";

/**
 * The line above the campaigns table (docs/rebuild-v6/02-screens.md §5): «مرشّحين للتكبير (n)» and «صحة البيانات», as two links — the ladder and the data health each have their own page. The count is
 * how many ad sets the ladder says may be raised right now; when it cannot be read (the demo, or the ladder is not reachable) the link says no number rather than a wrong one.
 */
export async function AdsQuickLinks() {
  const rows = isDemo(process.env) ? null : await gatherScale().catch(() => null);
  const n = rows ? rows.filter((r) => r.decision.raise).length : null;
  return (
    <nav aria-label="روابط سريعة" className="flex flex-wrap gap-2">
      <Link href="/ads/scale" className={link}>
        مرشّحين للتكبير{n !== null ? <span dir="ltr" className="rounded-full bg-surface-2 px-2 font-display text-sm font-bold tabular-nums">{n}</span> : null}
      </Link>
      <Link href="/ads/health" className={link}>
        صحة البيانات
      </Link>
    </nav>
  );
}
