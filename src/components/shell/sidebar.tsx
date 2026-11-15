"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { MediaBuyerMark } from "@/components/logo";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { cn } from "@/lib/utils";
import { iconOfPage } from "./nav-icons";
import { useCurrentPlace, useShell } from "./shell-context";

/**
 * The navigation from the `md` breakpoint up: the mark on the decorated header and the pages as the owner left them (at most seven;
 * «وضع التعديل» also shows the ones he hid, dimmed, and a way into the panel that changes them).
 */
export function Sidebar() {
  const current = useCurrentPlace();
  const { pages, editing, openPanel } = useShell();
  const list = pages.filter((p) => !p.archived && (editing || !p.hidden));
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
      <nav aria-label="الأماكن" className="flex-1 space-y-1 overflow-y-auto p-3">
        {list.map((p) => {
          const active = p.key === current.key;
          const Icon = iconOfPage(p);
          const cls = cn(
            "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
            active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            p.hidden && "opacity-50",
          );
          const inner = (
            <>
              <Icon className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {p.hidden ? <span className="text-[10px] font-normal">مخفية</span> : null}
            </>
          );
          return p.external ? (
            <a key={p.key} href={p.href} target="_blank" rel="noreferrer noopener" className={cls}>
              {inner}
            </a>
          ) : (
            <Link key={p.key} href={p.href} aria-current={active ? "page" : undefined} className={cls}>
              {inner}
            </Link>
          );
        })}
        {editing ? (
          <button type="button" onClick={() => openPanel("pages")} className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-dashed border-accent/50 px-3 text-sm font-medium text-accent hover:bg-accent/5">
            <Pencil className="size-[18px]" />
            عدّل الصفحات
          </button>
        ) : null}
      </nav>
    </aside>
  );
}
