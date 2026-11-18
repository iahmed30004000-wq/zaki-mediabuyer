"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { EffPage } from "@/core/customize";
import { READY_PLACES, placeOf, type Place } from "@/lib/nav";

/** The tabs of the edit panel. */
export type PanelTab = "boards" | "fields" | "buttons" | "trash";

interface Shell {
  /** every page (the hidden and the put-away ones too: the sidebar and the phone's bar filter) */
  pages: EffPage[];
  /** the owner, signed in: only he sees «وضع التعديل» */
  canEdit: boolean;
  /** how many decisions wait for him (the red number beside «بانتظارك») */
  inbox: number;
  /** the places this person's role has in its bar (docs/rebuild/05-permissions.md §3) */
  places: readonly string[];
  /** may open the settings (read) */
  settings: boolean;
  /** the capabilities of this person's role (the buttons that are not theirs are not drawn; the server refuses them anyway) */
  caps: readonly string[] | null;
  editing: boolean;
  setEditing: (v: boolean) => void;
  panel: { open: boolean; tab: PanelTab };
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setTab: (tab: PanelTab) => void;
}

const Ctx = createContext<Shell | null>(null);

const KEY = "mb:edit";

/**
 * What the shell shares: the pages as the owner left them (the layout read them on the server), whether edit mode is on (a
 * person's switch, kept in this browser), and the edit panel's state. A page that is not the owner's to change never shows any of it.
 */
export function ShellProvider({ pages, canEdit, inbox = 0, places, settings = true, caps, children }: { pages: EffPage[]; canEdit: boolean; inbox?: number; places?: readonly string[]; settings?: boolean; caps?: readonly string[]; children: ReactNode }) {
  const [editing, setEditingState] = useState(false);
  const [panel, setPanel] = useState<{ open: boolean; tab: PanelTab }>({ open: false, tab: "boards" });

  // the switch survives a reload (and only for the owner)
  useEffect(() => {
    if (!canEdit) return;
    try {
      setEditingState(localStorage.getItem(KEY) === "1");
    } catch {
      // private mode: it simply starts off
    }
  }, [canEdit]);

  const setEditing = useCallback((v: boolean) => {
    setEditingState(v);
    if (!v) setPanel((p) => ({ ...p, open: false }));
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // nothing to keep it in
    }
  }, []);

  const value = useMemo<Shell>(
    () => ({
      pages,
      canEdit,
      inbox,
      places: places ?? READY_PLACES.map((p) => p.key),
      settings,
      caps: caps ?? null,
      editing: canEdit && editing,
      setEditing,
      panel,
      openPanel: (tab) => setPanel((p) => ({ open: true, tab: tab ?? p.tab })),
      closePanel: () => setPanel((p) => ({ ...p, open: false })),
      setTab: (tab) => setPanel((p) => ({ ...p, tab })),
    }),
    [pages, canEdit, inbox, places, settings, caps, editing, setEditing, panel],
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
  return { places: READY_PLACES.filter((p) => places.includes(p.key)), settings };
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
  /** one of the five places, the settings or the products (its guide exists) — not a page the owner made */
  builtin: boolean;
}

/** Where the person is: a place, the settings, the products — or one of his own pages (`/p/<key>`). */
export function useCurrentPlace(): CurrentPlace {
  const pathname = usePathname() ?? "/";
  const { pages } = useShell();
  const custom = /^\/p\/([^/?#]+)/.exec(pathname);
  if (custom) {
    const p = pages.find((x) => x.key === custom[1]);
    if (p) return { key: p.key, label: p.label, title: p.label, question: p.question, href: p.href, builtin: false };
  }
  const here = placeOf(pathname);
  return { key: here.key, label: here.label, title: here.title, question: here.question, href: here.href, builtin: true };
}
