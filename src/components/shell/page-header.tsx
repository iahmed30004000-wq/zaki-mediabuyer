"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MessageCircleQuestion, Search, Settings } from "lucide-react";
import { MediaBuyerMark } from "@/components/logo";
import { KillSwitch } from "@/components/mb/kill-switch";
import { IconButton } from "@/components/ui/icon-button";
import { EditBar } from "@/components/customize/edit-bar";
import { BellButton } from "./bell";
import { HeaderMenu } from "./header-menu";
import { PageHelp } from "./page-help";
import { SEARCH_EVENT } from "./command-palette";
import { CONSULTANT_EVENT } from "./consultant";
import { useCan, useCurrentPlace, useMyPlaces, useShell } from "./shell-context";

/**
 * The top of every page: the place's name (24/800) and its one question, then the buttons — always in reach (18.2).
 * New map (v6): three buttons — the bell, «⋯» (search · the assistant · what this page is · the settings) and the full stop. Old map: search, the assistant, «؟», the settings (phone) and the full stop.
 */
export function PageHeader({ actions }: { actions?: ReactNode }) {
  const place = useCurrentPlace();
  const mayAsk = useCan("assistant.use");
  const mayStop = useCan("ads.pause");
  const { settings } = useMyPlaces();
  const { stopAccounts, navMap } = useShell();
  const v6 = navMap === "v6";
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface-1">
      <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-4 py-3 md:px-6">
        <MediaBuyerMark className="size-8 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-extrabold text-fg">{place.title}</h1>
          <p className="truncate text-sm text-fg-muted">{place.question}</p>
        </div>
        {actions}
        {v6 ? (
          <>
            {mayStop ? <KillSwitch accounts={stopAccounts} /> : null}
            <BellButton />
            <HeaderMenu />
          </>
        ) : (
          <>
            <IconButton aria-label="بحث (Ctrl K)" title="بحث (Ctrl K)" data-tour="search" onClick={() => window.dispatchEvent(new Event(SEARCH_EVENT))}>
              <Search className="size-5" aria-hidden />
            </IconButton>
            {mayAsk ? (
              <IconButton aria-label="اسأل المساعد" title="اسأل المساعد" onClick={() => window.dispatchEvent(new Event(CONSULTANT_EVENT))}>
                <MessageCircleQuestion className="size-5" aria-hidden />
              </IconButton>
            ) : null}
            <PageHelp place={place} />
            {/* on a phone the settings are not in the bottom bar: they are here */}
            {settings ? (
              <Link href="/settings" aria-label="الإعدادات" title="الإعدادات" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden">
                <Settings className="size-5" aria-hidden />
              </Link>
            ) : null}
            {mayStop ? <KillSwitch accounts={stopAccounts} /> : null}
          </>
        )}
      </div>
      <EditBar />
    </header>
  );
}
