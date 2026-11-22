"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PLACES, placeOf, placesFor, type Place } from "@/lib/nav";

/** The tabs of the panel where the owner changes the team's boards and fields. */
export type PanelTab = "boards" | "fields" | "trash";

interface Shell {
  /** the owner, signed in: only he may change the boards and fields of the team's tasks */
  canEdit: boolean;
  /** how many decisions wait for him (the red number on the home) */
  inbox: number;
  /** the places this person's role has in its bar (docs/rebuild/05-permissions.md §3) */
  places: readonly string[];
  /** may open the settings (read) */
  settings: boolean;
  /** the capabilities of this person's role (the buttons that are not theirs are not drawn; the server refuses them anyway) */
  caps: readonly string[] | null;
  /** the real ad accounts the full stop can be aimed at (read on the server) */
  stopAccounts: { id: string; name: string }[];
  panel: { open: boolean; tab: PanelTab };
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setTab: (tab: PanelTab) => void;
}

const Ctx = createContext<Shell | null>(null);

/**
 * What the shell shares: who this person is allowed to be (the role's places and capabilities, read on the server) and the state of the panel where the owner changes the boards and
 * fields of the team's tasks (v6 · P8, Q5: that is all that is left of the old «وضع التعديل»). A person who is not the owner never sees the panel.
 */
export function ShellProvider({ canEdit, inbox = 0, places, settings = true, caps, stopAccounts = [], children }: { canEdit: boolean; inbox?: number; places?: readonly string[]; settings?: boolean; caps?: readonly string[]; stopAccounts?: { id: string; name: string }[]; children: ReactNode }) {
  const [panel, setPanel] = useState<{ open: boolean; tab: PanelTab }>({ open: false, tab: "boards" });

  const value = useMemo<Shell>(
    () => ({
      canEdit,
      inbox,
      places: places ?? PLACES.map((p) => p.key),
      settings,
      caps: caps ?? null,
      stopAccounts,
      panel,
      openPanel: (tab) => setPanel((p) => ({ open: true, tab: tab ?? p.tab })),
      closePanel: () => setPanel((p) => ({ ...p, open: false })),
      setTab: (tab) => setPanel((p) => ({ ...p, tab })),
    }),
    [canEdit, inbox, places, settings, caps, stopAccounts, panel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell: no ShellProvider above");
  return v;
}

/** The places this role sees in the bar, and whether the settings are open to it. */
export function useMyPlaces(): { places: readonly Place[]; settings: boolean } {
  const { places, settings } = useShell();
  return { places: placesFor(places), settings };
}

/** Does this person's role hold the capability? (No role known = the demo owner: yes.) */
export function useCan(capability: string): boolean {
  const { caps } = useShell();
  return caps === null || caps.includes(capability);
}

/** How many decisions wait for the owner. */
export function useInboxCount(): number {
  return useShell().inbox;
}

export interface CurrentPlace {
  key: string;
  /** the name in the menu */
  label: string;
  /** the title on the page header */
  title: string;
  question: string;
  href: string;
}

/** Where the person is: a place, the decisions list or the settings. */
export function useCurrentPlace(): CurrentPlace {
  const pathname = usePathname() ?? "/";
  const here = placeOf(pathname);
  return { key: here.key, label: here.label, title: here.title, question: here.question, href: here.href };
}
