"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { hrefOfPlace } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { PlusSheet } from "./plus-sheet";
import { CountBadge } from "./sidebar";
import { useCurrentPlace, useInboxCount, useMyPlaces, useShell } from "./shell-context";

/**
 * The phone's bottom bar (60px): an icon and a name for every place; the active one has the gold line above it. The new map (v6) is five slots — the home (with the number of what
 * waits for you) · المهام · «＋» · الأرقام · الإعلانات; the old map is its five places. The settings are in the header's «⋯» (new) or its gear (old).
 */
export function BottomNav() {
  const current = useCurrentPlace();
  const inbox = useInboxCount();
  const { places } = useMyPlaces();
  const { navMap } = useShell();
  const [plus, setPlus] = useState(false);
  const v6 = navMap === "v6";
  const middle = Math.ceil(places.length / 2);
  return (
    <nav aria-label="الأماكن" className="fixed inset-x-0 bottom-0 z-30 flex h-[60px] items-stretch border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden">
      {places.map((p, i) => {
        const active = p.key === current.key;
        const Icon = p.icon;
        return (
          <Fragment key={p.key}>
            {v6 && i === middle ? (
              <span className="flex flex-1 items-center justify-center">
                <IconButton aria-label="جديد" title="جديد" onClick={() => setPlus(true)} className="size-12 rounded-full bg-accent text-accent-fg shadow-key active:shadow-key-down">
                  <Plus className="size-6" aria-hidden />
                </IconButton>
              </span>
            ) : null}
            <Link
              href={hrefOfPlace(p)}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold", active ? "text-fg" : "text-fg-muted")}
            >
              {active ? <span aria-hidden className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-accent" /> : null}
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {p.key === (v6 ? "home" : "inbox") ? <CountBadge count={inbox} className="absolute -end-3 -top-2" /> : null}
              </span>
              <span className="max-w-full truncate px-1">{p.label}</span>
            </Link>
          </Fragment>
        );
      })}
      {v6 ? <PlusSheet open={plus} onOpenChange={setPlus} /> : null}
    </nav>
  );
}
