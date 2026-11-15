"use client";

import { useState } from "react";
import Link from "next/link";
import { Ellipsis, Pencil } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MAX_PHONE_BAR } from "@/core/customize";
import { cn } from "@/lib/utils";
import { iconOfPage } from "./nav-icons";
import { useCurrentPlace, useShell } from "./shell-context";

/** The phone's bottom bar (spec 18.5): up to four pages the owner put on it, and «المزيد» for the rest (and, for him, «وضع التعديل»). */
export function BottomNav() {
  const current = useCurrentPlace();
  const { pages, canEdit, editing, setEditing, openPanel } = useShell();
  const [more, setMore] = useState(false);
  const shown = pages.filter((p) => !p.hidden && !p.archived);
  const main = shown.filter((p) => p.mobile).slice(0, MAX_PHONE_BAR);
  const rest = shown.filter((p) => !main.includes(p));
  const moreActive = rest.some((p) => p.key === current.key);

  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  const row = "flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm text-fg hover:bg-surface-2";
  return (
    <>
      <nav aria-label="الأماكن" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {main.map((p) => {
          const Icon = iconOfPage(p);
          const active = p.key === current.key;
          const inner = (
            <>
              <Icon className="size-5" />
              <span className="max-w-full truncate px-1">{p.label}</span>
            </>
          );
          return p.external ? (
            <a key={p.key} href={p.href} target="_blank" rel="noreferrer noopener" className={cn(item, "text-fg-muted")}>
              {inner}
            </a>
          ) : (
            <Link key={p.key} href={p.href} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-accent" : "text-fg-muted")}>
              {inner}
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
            {rest.map((p) => {
              const Icon = iconOfPage(p);
              return p.external ? (
                <a key={p.key} href={p.href} target="_blank" rel="noreferrer noopener" onClick={() => setMore(false)} className={row}>
                  <Icon className="size-5 text-fg-muted" />
                  {p.label}
                </a>
              ) : (
                <Link key={p.key} href={p.href} onClick={() => setMore(false)} className={row}>
                  <Icon className="size-5 text-fg-muted" />
                  {p.label}
                </Link>
              );
            })}
            {canEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(!editing);
                    if (!editing) {
                      setMore(false);
                      openPanel("pages");
                    }
                  }}
                  className={cn(row, "w-full border-t border-border pt-2 font-medium", editing ? "text-accent" : "")}
                >
                  <Pencil className="size-5" />
                  {editing ? "طفّي وضع التعديل" : "وضع التعديل"}
                </button>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMore(false);
                      openPanel();
                    }}
                    className={cn(row, "w-full text-accent")}
                  >
                    <Pencil className="size-5" />
                    افتح لوحة التعديل
                  </button>
                ) : null}
              </>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
