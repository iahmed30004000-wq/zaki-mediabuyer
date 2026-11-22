"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { INBOX_TABS, PLACES, type PlaceKey } from "@/lib/nav";
import { useInboxCount } from "./shell-context";

/** The tabs of a place (from src/lib/nav.ts), as links under the page header; the place's layout puts it first. «بدها قرارك» (the decisions list) carries the open count. */
export function PlaceTabs({ place }: { place: PlaceKey | "inbox" }) {
  usePathname();
  const inbox = useInboxCount();
  const tabs = place === "inbox" ? INBOX_TABS : (PLACES.find((x) => x.key === place)?.tabs ?? []);
  if (tabs.length < 2) return null;
  const items = tabs.map((t) => ({ href: t.href, label: t.label, count: place === "inbox" && t.href === "/inbox" ? inbox : null }));
  return <Tabs items={items} label={place === "inbox" ? "بانتظارك" : (PLACES.find((x) => x.key === place)?.title ?? "")} className="mb-4" />;
}
