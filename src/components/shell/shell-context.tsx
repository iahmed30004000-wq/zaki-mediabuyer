"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { EffPage } from "@/core/customize";
import { placeOf } from "@/lib/nav";

/** The tabs of the edit panel. */
export type PanelTab = "pages" | "boards" | "fields" | "buttons" | "trash";

interface Shell {
  /** every page (the hidden and the put-away ones too: the sidebar and the phone's bar filter) */
  pages: EffPage[];
  /** the owner, signed in: only he sees «وضع التعديل» */
  canEdit: boolean;
  /** how many decisions wait for him (the red number beside «بانتظارك») */
  inbox: number;
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
export function ShellProvider({ pages, canEdit, inbox = 0, children }: { pages: EffPage[]; canEdit: boolean; inbox?: number; children: ReactNode }) {
  const [editing, setEditingState] = useState(false);
  const [panel, setPanel] = useState<{ open: boolean; tab: PanelTab }>({ open: false, tab: "pages" });

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
      editing: canEdit && editing,
      setEditing,
      panel,
      openPanel: (tab) => setPanel((p) => ({ open: true, tab: tab ?? p.tab })),
      closePanel: () => setPanel((p) => ({ ...p, open: false })),
      setTab: (tab) => setPanel((p) => ({ ...p, tab })),
    }),
    [pages, canEdit, inbox, editing, setEditing, panel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell: no ShellProvider above");
  return v;
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
