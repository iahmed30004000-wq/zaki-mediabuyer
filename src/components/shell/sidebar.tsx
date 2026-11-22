"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { MediaBuyerMark } from "@/components/logo";
import { AgentsStrip } from "@/components/tasks/agents-strip";
import { Button } from "@/components/ui/button";
import { SETTINGS, hrefOfPlace } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { PlusSheet } from "./plus-sheet";
import { useCurrentPlace, useInboxCount, useMyPlaces, useShell } from "./shell-context";

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
 * The side menu from `md` up (232px): the mark and the name, the places (44px rows), then the settings at the bottom. The new map (v6) has four places; under them «＋ جديد»
 * and, at the bottom, «مين شغّال» (a lamp for every agent). The old map has five places, «بانتظارك» with its count. The pages the owner made himself are under «متقدّم» (P11), not here.
 */
export function Sidebar() {
  const current = useCurrentPlace();
  const inbox = useInboxCount();
  const { places, settings } = useMyPlaces();
  const { navMap } = useShell();
  const [plus, setPlus] = useState(false);
  const v6 = navMap === "v6";
  const row = (active: boolean) =>
    cn("flex h-10 max-md:h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-bold transition-colors", active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg");
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-e border-border bg-surface-1 md:flex">
      <div className="flex h-[72px] items-center gap-2.5 border-b border-border px-4">
        <MediaBuyerMark className="size-9" />
        <div className="leading-tight">
          <p className="text-base font-extrabold text-fg">الميديا باير</p>
          <p className="text-sm text-fg-muted">الإعلانات والتشغيل</p>
        </div>
      </div>
      <nav aria-label="الأماكن" className="flex-1 space-y-1 overflow-y-auto p-3">
        {places.map((p) => {
          const active = p.key === current.key;
          const Icon = p.icon;
          return (
            <Link key={p.key} href={hrefOfPlace(p)} aria-current={active ? "page" : undefined} className={row(active)}>
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {p.key === (v6 ? "home" : "inbox") ? <CountBadge count={inbox} /> : null}
            </Link>
          );
        })}
        {v6 ? (
          <>
            <Button variant="secondary" size="sm" block className="mt-2" onClick={() => setPlus(true)}>
              <Plus className="size-4" aria-hidden />
              جديد
            </Button>
            <PlusSheet open={plus} onOpenChange={setPlus} />
          </>
        ) : null}
      </nav>
      {v6 ? (
        <div className="max-h-[38%] shrink-0 space-y-2 overflow-y-auto border-t border-border p-3">
          <p className="text-sm font-bold text-fg-muted">مين شغّال</p>
          <AgentsStrip compact />
        </div>
      ) : null}
      <div className={cn("border-t border-border p-3", !settings && "hidden")}>
        <Link href={SETTINGS.href} aria-current={current.key === "settings" ? "page" : undefined} className={row(current.key === "settings")}>
          <SETTINGS.icon className="size-5 shrink-0" aria-hidden />
          <span>{SETTINGS.label}</span>
        </Link>
      </div>
    </aside>
  );
}
