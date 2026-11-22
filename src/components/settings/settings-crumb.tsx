"use client";

import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui/button-link";
import { settingsParent, settingsTitle } from "@/lib/settings-nav";

/** Under the header of every settings page: where you are and the way back (the list has neither). */
export function SettingsCrumb() {
  const path = (usePathname() ?? "").replace(/\/$/, "");
  const parent = settingsParent(path);
  const title = settingsTitle(path);
  if (!parent) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ButtonLink href={parent.href} variant="ghost" size="sm">
        ← {parent.title}
      </ButtonLink>
      {title ? <h2 className="font-display text-lg font-extrabold text-fg">{title}</h2> : null}
    </div>
  );
}
