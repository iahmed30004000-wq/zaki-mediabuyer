"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface TabItem {
  /** The address. A `?query` part is matched too, so «?view=flow» can be a tab of the same page. */
  href: string;
  label: string;
  /** A number beside the label (the tab's open items). Left out when 0 or unknown. */
  count?: number | null;
}

/** True when `href` is the page we are on (the address of a tab with a query must carry the same query). */
export function tabIsActive(href: string, pathname: string, query: URLSearchParams | { get(name: string): string | null }, exact = false): boolean {
  const [path, qs] = href.split("?");
  if (exact || qs) {
    if (pathname !== path) return false;
    if (!qs) return !query.get("view");
    return [...new URLSearchParams(qs)].every(([k, v]) => query.get(k) === v);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The tabs of a place: real links (the keyboard and middle-click work), the active one with the gold line. Four at most (03 §7).
 * `exact` makes the first tab of a place (`/ads`) active only on its own address.
 */
export function Tabs(props: TabsProps) {
  // useSearchParams needs a Suspense boundary (the static pass of the build); the fallback is the same bar with nothing active
  return (
    <Suspense fallback={<div aria-hidden className="h-10 border-b border-border" />}>
      <TabsBar {...props} />
    </Suspense>
  );
}

interface TabsProps {
  items: readonly TabItem[];
  label?: string;
  exactFirst?: boolean;
  className?: string;
}

function TabsBar({ items, label = "التبويبات", exactFirst = true, className }: TabsProps) {
  const pathname = usePathname();
  const query = useSearchParams();
  return (
    <nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {items.map((it, i) => {
          const active = tabIsActive(it.href, pathname, query, exactFirst && i === 0);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center gap-1.5 border-b-[3px] px-3 text-sm font-bold transition-colors max-md:h-11",
                  active ? "border-accent-2 text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {it.label}
                {it.count ? <span className="rounded-full bg-surface-2 px-1.5 text-xs font-bold text-fg-muted">{it.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
