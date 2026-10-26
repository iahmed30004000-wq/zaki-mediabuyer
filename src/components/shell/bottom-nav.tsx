"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Ellipsis } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PLACES, placeOf } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** The phone's bottom bar (spec 18.5): four places and «المزيد» (reports, settings, guide). */
export function BottomNav() {
  const current = placeOf(usePathname() ?? "/");
  const [more, setMore] = useState(false);
  const main = PLACES.filter((p) => p.mobile);
  const rest = PLACES.filter((p) => !p.mobile);
  const moreActive = rest.some((p) => p.key === current.key);

  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  return (
    <>
      <nav aria-label="الأماكن" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {main.map((p) => {
          const Icon = p.icon;
          const active = p.key === current.key;
          return (
            <Link key={p.key} href={p.href} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-accent" : "text-fg-muted")}>
              <Icon className="size-5" />
              {p.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} className={cn(item, moreActive ? "text-accent" : "text-fg-muted")}>
          <Ellipsis className="size-5" />
          المزيد
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>المزيد</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-1">
            {[...rest.map((p) => ({ href: p.href, label: p.label, Icon: p.icon })), { href: "/guide", label: "الدليل", Icon: BookOpen }].map(({ href, label, Icon }) => (
              <Link key={href} href={href} onClick={() => setMore(false)} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm text-fg hover:bg-surface-2">
                <Icon className="size-5 text-fg-muted" />
                {label}
              </Link>
            ))}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
