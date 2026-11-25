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
 * The tabs of a place: real links (the keyboard and middle-click work), the active one with an ink line. Four at most (03 §7).
 * `exact` makes the first tab of a place (`/ads`) active only on its own address.
 */
export function Tabs(props: TabsProps) {
  // useSearchParams needs a Suspense boundary (the static pass of the build); the fallback is the same bar with nothing active
  return (
    <Suspense fallback={<div aria-hidden className="h-12 border-b border-border" />}>
      <TabsBar {...props} />
    </Suspense>
  );
}

interface TabsProps {
  items: readonly TabItem[];
  label?: string;
  exactFirst?: boolean;
  className?: string;
  /** query names carried from the page we are on to every tab (the numbers keep the chosen market) */
  keep?: readonly string[];
}

/** A tab's address with the kept names of the current query on it. */
export function keepQuery(href: string, query: { get(name: string): string | null }, keep: readonly string[]): string {
  const [path, qs] = href.split("?");
  const next = new URLSearchParams(qs);
  for (const name of keep) {
    const v = query.get(name);
    if (v) next.set(name, v);
  }
  return next.size ? `${path}?${next.toString()}` : path!;
}

function TabsBar({ items, label = "التبويبات", exactFirst = true, className, keep = [] }: TabsProps) {
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
                href={keepQuery(it.href, query, keep)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-12 items-center gap-1.5 border-b-[3px] px-4 text-base font-bold transition-colors",
                  active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {it.label}
                {it.count ? <span className="rounded-full bg-surface-2 px-1.5 font-display text-xs font-bold text-fg-muted">{it.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
