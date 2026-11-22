"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { themeLabelKey, themeMoodKey, type ThemeKey } from "@/lib/themes/registry";
import { useTheme } from "./theme-provider";

/**
 * The theme picker: two cards (فاتح · داكن), each a native radio (so arrows move the choice, Tab enters and leaves the group, and a
 * screen reader says "1 of 2, selected"). Every card shows a miniature of its theme painted with THAT theme's own tokens: the preview
 * carries `data-theme`, and themes.css defines every token for any element with the attribute. A choice applies at once.
 */
export function ThemePicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme, themes } = useTheme();
  const id = useId();

  return (
    <fieldset data-tour="theme" className={cn(className)}>
      <legend className="text-sm font-semibold text-fg">{t("theme.picker")}</legend>
      <p className="mt-0.5 text-xs text-fg-muted">{t("theme.picker_hint")}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {themes.map((info) => {
          const selected = info.key === theme;
          const moodId = `${id}-${info.key}-mood`;
          return (
            <label
              key={info.key}
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-card border bg-surface-1 p-2 text-start transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-info has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-surface",
                selected ? "border-accent" : "border-border hover:border-fg-muted",
              )}
            >
              <input
                type="radio"
                name="zk-theme"
                className="sr-only"
                aria-label={t(themeLabelKey(info.key))}
                aria-describedby={moodId}
                checked={selected}
                value={info.key}
                onChange={() => setTheme(info.key)}
              />
              <ThemePreview theme={info.key} />
              <span className="text-sm font-semibold text-fg">{t(themeLabelKey(info.key))}</span>
              <span id={moodId} className="text-xs text-fg-muted">
                {t(themeMoodKey(info.key))}
              </span>
              {selected ? (
                <span aria-hidden="true" className="absolute end-3 top-3 grid size-5 place-items-center rounded-full bg-accent text-accent-fg">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A miniature screen in the theme's own colours: a title line, a card, the primary button, the status colours. Decorative. */
function ThemePreview({ theme }: { theme: ThemeKey }) {
  return (
    <span data-theme={theme} aria-hidden="true" className="flex h-16 flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-surface p-2">
      <span className="h-1.5 w-2/3 rounded-full bg-fg" />
      <span className="h-0.5 w-1/4 rounded-full bg-accent" />
      <span className="flex h-4 items-center rounded-md border border-border bg-surface-1 px-1">
        <span className="h-1 flex-1 rounded-full bg-fg-muted/50" />
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-6 rounded-full bg-accent" />
        <span className="size-1.5 rounded-full bg-ok" />
        <span className="size-1.5 rounded-full bg-warn" />
        <span className="size-1.5 rounded-full bg-danger" />
      </span>
    </span>
  );
}
