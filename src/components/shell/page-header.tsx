"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MediaBuyerMark } from "@/components/logo";
import { KillSwitch } from "@/components/mb/kill-switch";
import { placeOf } from "@/lib/nav";
import { MessageCircleQuestion } from "lucide-react";
import { PageHelp } from "./page-help";
import { CONSULTANT_EVENT } from "./consultant";

/** The top of every page: the place's name and its one question, «؟», and the full stop — always in reach (18.2). */
export function PageHeader({ actions }: { actions?: ReactNode }) {
  const place = placeOf(usePathname() ?? "/");
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
        <MediaBuyerMark className="size-8 md:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-fg md:text-xl">{place.label}</h1>
          <p className="truncate text-xs text-fg-muted">{place.question}</p>
        </div>
        {actions}
        <button type="button" onClick={() => window.dispatchEvent(new Event(CONSULTANT_EVENT))} aria-label="اسأل المستشار" className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden">
          <MessageCircleQuestion className="size-[18px]" />
        </button>
        <PageHelp place={place} />
        <span className="md:hidden">
          <KillSwitch compact />
        </span>
        <span className="hidden md:inline-flex">
          <KillSwitch />
        </span>
      </div>
    </header>
  );
}
