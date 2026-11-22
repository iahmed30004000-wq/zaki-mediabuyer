import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The title of a block on a page: 20/800 Changa, with an optional link at the end («عرض الكل»). The page title is `PageShell`'s. */
export function SectionTitle({ children, hint, href, linkLabel, className }: { children: ReactNode; hint?: string; href?: string; linkLabel?: string; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-extrabold text-fg">{children}</h2>
        {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link href={href} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-base font-semibold text-info hover:underline">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
