"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen } from "lucide-react";
import { MediaBuyerMark } from "@/components/logo";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { PLACES, placeOf } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** The navigation from the `md` breakpoint up: the mark on the decorated header, the five places, the settings, the guide. */
export function Sidebar() {
  const current = placeOf(usePathname() ?? "/");
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-surface-1 md:flex">
      <div className="relative isolate flex h-[72px] items-center gap-2.5 overflow-hidden border-b border-border px-4">
        <ThemeDecor kind="sidebar" />
        <MediaBuyerMark className="relative z-10 size-9" />
        <div className="relative z-10 leading-tight">
          <p className="font-display text-base font-bold text-fg">الميديا باير</p>
          <p className="text-[11px] text-fg-muted">Zaki · إعلانات ميتا</p>
        </div>
      </div>
      <nav aria-label="الأماكن" className="flex-1 space-y-1 p-3">
        {PLACES.map((p) => {
          const active = p.key === current.key;
          const Icon = p.icon;
          return (
            <Link
              key={p.key}
              href={p.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon className="size-[18px]" />
              {p.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <Link href="/guide" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
          <BookOpen className="size-[18px]" />
          الدليل
        </Link>
      </div>
    </aside>
  );
}
