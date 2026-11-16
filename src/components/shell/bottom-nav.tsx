"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CountBadge } from "./sidebar";
import { useCurrentPlace, useInboxCount, useMyPlaces } from "./shell-context";

/** The phone's bottom bar (60px): the five places, an icon and a name each; the active one has the gold line above it. The settings are in the header's «⋯». */
export function BottomNav() {
  const current = useCurrentPlace();
  const inbox = useInboxCount();
  const { places } = useMyPlaces();
  return (
    <nav aria-label="الأماكن" className="fixed inset-x-0 bottom-0 z-30 flex h-[60px] border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden">
      {places.map((p) => {
        const active = p.key === current.key;
        const Icon = p.icon;
        return (
          <Link
            key={p.key}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold", active ? "text-fg" : "text-fg-muted")}
          >
            {active ? <span aria-hidden className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-accent-2" /> : null}
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {p.key === "inbox" ? <CountBadge count={inbox} className="absolute -end-3 -top-2" /> : null}
            </span>
            <span className="max-w-full truncate px-1">{p.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
