"use client";

import type { ReactNode } from "react";
import { MediaBuyerMark } from "@/components/logo";
import { KillSwitch } from "@/components/mb/kill-switch";
import { BellButton } from "./bell";
import { HeaderMenu } from "./header-menu";
import { useCan, useCurrentPlace, useShell } from "./shell-context";

/**
 * The top of every page: the place's name (24/800) and its one question, then three buttons — the full stop, the bell and «⋯» (search · the assistant · what this page is · the settings) —
 * always in reach (18.2, U-17).
 */
export function PageHeader({ actions }: { actions?: ReactNode }) {
  const place = useCurrentPlace();
  const mayStop = useCan("ads.pause");
  const { stopAccounts } = useShell();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface-1">
      <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-4 py-3 md:px-6">
        <MediaBuyerMark className="size-8 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-extrabold text-fg">{place.title}</h1>
          <p className="truncate text-sm text-fg-muted">{place.question}</p>
        </div>
        {actions}
        {mayStop ? <KillSwitch accounts={stopAccounts} /> : null}
        <BellButton />
        <HeaderMenu />
      </div>
    </header>
  );
}
