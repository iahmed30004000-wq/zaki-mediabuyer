"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, SOURCE_AR, SOURCE_HINT, type Source, type TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";

export { fmt };

const SOURCE_STYLE: Record<Source, string> = {
  meta: "border-border bg-surface-2 text-fg-muted",
  truth: "border-accent/40 bg-accent/10 text-accent",
  estimate: "border-dashed border-warn/60 text-warn",
};

/** The badge beside a number: ميتا · حقيقي · تقدير (spec 3.9). */
export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md border px-1 text-[10px] font-semibold leading-4", SOURCE_STYLE[source], className)}>{SOURCE_AR[source]}</span>;
}

/**
 * A number with its source and its «ليش؟». A tap opens a small card: the name, the formula, what to do with it and
 * where the number comes from. Every figure on every screen can explain itself — that is the in-site guide for numbers.
 */
export function Num({
  value,
  unit = "",
  term,
  source,
  label,
  big = false,
  tone,
  className,
}: {
  value: number | null | undefined;
  unit?: "$" | "%" | "x" | "";
  term?: TermKey;
  source?: Source;
  label?: string;
  big?: boolean;
  tone?: "ok" | "warn" | "danger";
  className?: string;
}) {
  const t = term ? GLOSSARY[term] : undefined;
  const src = source ?? t?.source;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-fg";
  const body = (
    <>
      <span dir="ltr" className={cn("tabular-nums font-semibold", big ? "text-2xl" : "text-sm", toneClass)}>
        {fmt(value, unit)}
      </span>
      {src ? <SourceBadge source={src} /> : null}
    </>
  );

  if (!t) return <span className={cn("inline-flex items-center gap-1.5", className)}>{body}</span>;

  return (
    <span ref={box} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label ?? t.name}: ${fmt(value, unit)} — ليش؟`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-0.5 underline decoration-dotted decoration-fg-muted/40 underline-offset-4 hover:decoration-accent"
      >
        {body}
      </button>
      {open ? (
        <span id={id} role="dialog" className="absolute start-0 top-full z-40 mt-2 w-64 animate-fade-in rounded-xl border border-border bg-surface-1 p-3 text-start shadow-card">
          <span className="block text-sm font-semibold text-fg">{t.name}</span>
          <span className="mt-1 block rounded-md bg-surface-2 px-2 py-1 text-xs text-fg-muted">{t.formula}</span>
          <span className="mt-2 block text-xs leading-5 text-fg">{t.meaning}</span>
          {src ? (
            <span className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-fg-muted">
              <SourceBadge source={src} />
              {SOURCE_HINT[src]}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
