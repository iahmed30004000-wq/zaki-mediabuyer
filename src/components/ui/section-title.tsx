import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The title of a block on a page: 16/800, with an optional link at the end («عرض الكل»). The page title is `PageShell`'s. */
export function SectionTitle({ children, hint, href, linkLabel, className }: { children: ReactNode; hint?: string; href?: string; linkLabel?: string; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-extrabold text-fg">{children}</h2>
        {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link href={href} className="inline-flex min-h-10 min-w-[44px] shrink-0 items-center justify-center text-sm font-semibold text-info hover:underline max-md:min-h-[44px]">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
