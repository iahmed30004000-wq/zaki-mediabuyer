"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { NAV_MAPS, type NavMap, type PlaceKey } from "@/lib/nav";
import { useInboxCount } from "./shell-context";

/** The tabs of a place (from src/lib/nav.ts), as links under the page header. The place's layout puts it first. «بدها قرارك» carries the open count. `map` says which map the place is of (default the old one). */
export function PlaceTabs({ place, map = "old" }: { place: PlaceKey; map?: NavMap }) {
  usePathname();
  const inbox = useInboxCount();
  const p = NAV_MAPS[map].find((x) => x.key === place);
  if (!p || p.tabs.filter((t) => t.ready !== false).length < 2) return null;
  const items = p.tabs.filter((t) => t.ready !== false).map((t) => ({ href: t.href, label: t.label, count: place === "inbox" && t.href === "/inbox" ? inbox : null }));
  return <Tabs items={items} label={p.title} className="mb-4" />;
}
