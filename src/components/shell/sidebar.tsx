"use client";

import Link from "next/link";
import { MediaBuyerMark } from "@/components/logo";
import { SETTINGS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useCurrentPlace, useInboxCount, useMyPlaces } from "./shell-context";

/** The count of what waits for the owner, as a red badge (the one place red is used for a number). */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold text-danger-fg tabular-nums", className)} aria-label={`${count} بانتظارك`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The side menu from `md` up (232px): the mark and the name, the five places (44px rows, «بانتظارك» with its count), then the settings
 * at the bottom. The pages the owner made himself are under «متقدّم» (P11), not here.
 */
export function Sidebar() {
  const current = useCurrentPlace();
  const inbox = useInboxCount();
  const { places, settings } = useMyPlaces();
  const row = (active: boolean) =>
    cn("flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold transition-colors", active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg");
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-e border-border bg-surface-1 md:flex">
      <div className="flex h-[72px] items-center gap-2.5 border-b border-border px-4">
        <MediaBuyerMark className="size-9" />
        <div className="leading-tight">
          <p className="text-base font-extrabold text-fg">الميديا باير</p>
          <p className="text-xs text-fg-muted">الإعلانات والتشغيل</p>
        </div>
      </div>
      <nav aria-label="الأماكن" className="flex-1 space-y-1 overflow-y-auto p-3">
        {places.map((p) => {
          const active = p.key === current.key;
          const Icon = p.icon;
          return (
            <Link key={p.key} href={p.href} aria-current={active ? "page" : undefined} className={row(active)}>
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {p.key === "inbox" ? <CountBadge count={inbox} /> : null}
            </Link>
          );
        })}
      </nav>
      <div className={cn("border-t border-border p-3", !settings && "hidden")}>
        <Link href={SETTINGS.href} aria-current={current.key === "settings" ? "page" : undefined} className={row(current.key === "settings")}>
          <SETTINGS.icon className="size-5 shrink-0" aria-hidden />
          <span>{SETTINGS.label}</span>
        </Link>
      </div>
    </aside>
  );
}
