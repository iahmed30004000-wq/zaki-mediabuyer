"use client";

import type { ReactNode } from "react";
import { MediaBuyerMark } from "@/components/logo";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The calm screen before the work — sign-in, the first-run set-up, a missing page: the mark and the name, then the card. No picture,
 * no ornament (docs/rebuild/03-look.md §1). It replaces the old DoorShell.
 */
export function DoorCard({ children, width = "sm" }: { children?: ReactNode; width?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-8">
      <div className={cn("w-full space-y-5", width === "md" ? "max-w-md" : "max-w-sm")}>
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden="true">
            <MediaBuyerMark className="size-14" />
          </span>
          <p className="text-xl font-extrabold text-fg">{t("app.name")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
