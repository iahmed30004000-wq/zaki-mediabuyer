"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp, Ellipsis, MessageCircleQuestion, Search, Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { SEARCH_EVENT } from "./command-palette";
import { CONSULTANT_EVENT } from "./consultant";
import { ModeMenuItem } from "./mode-menu-item";
import { PageHelpSheet } from "./page-help";
import { useCan, useCurrentPlace, useMyPlaces } from "./shell-context";

/**
 * THE «⋯» OF THE NEW HEADER (docs/rebuild-v6/02-screens.md §1): search · the assistant · صاحي / نايم (the owner's) · what this page is · the settings. Three buttons in the header instead of five (U-17):
 * the bell, this one, and the full stop. On a phone the settings are only here.
 */
export function HeaderMenu() {
  const place = useCurrentPlace();
  const mayAsk = useCan("assistant.use");
  const isOwner = useCan("owner_only");
  const { settings } = useMyPlaces();
  const [help, setHelp] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label="المزيد" title="المزيد">
            <Ellipsis className="size-5" aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(SEARCH_EVENT))}>
            <Search className="size-4" aria-hidden /> بحث
          </DropdownMenuItem>
          {mayAsk ? (
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(CONSULTANT_EVENT))}>
              <MessageCircleQuestion className="size-4" aria-hidden /> اسأل المساعد
            </DropdownMenuItem>
          ) : null}
          {/* صاحي / نايم is the owner's switch (the same rule as the endpoint behind it) */}
          {isOwner ? <ModeMenuItem /> : null}
          <DropdownMenuItem onSelect={() => setHelp(true)}>
            <CircleHelp className="size-4" aria-hidden /> شو هاي الصفحة؟
          </DropdownMenuItem>
          {settings ? (
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="size-4" aria-hidden /> الإعدادات
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <PageHelpSheet place={place} open={help} onOpenChange={setHelp} />
    </>
  );
}
