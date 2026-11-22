"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot } from "lucide-react";
import { DOMAIN_AR, KIND_AR, inboxHref, type InboxActionKey, type InboxItem } from "@/core/inbox";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Chip } from "./chip";
import { Pill, type PillTone } from "./pill";

const URGENCY: Record<InboxItem["urgency"], { tone: PillTone; label: string }> = {
  red: { tone: "danger", label: "عاجل" },
  orange: { tone: "warn", label: "مهم" },
  yellow: { tone: "neutral", label: "عادي" },
};

/** Is this path the item's own page (`/inbox/<id>`)? Compared decoded, so an encoded colon does not hide the match. */
export function isItsOwnPage(pathname: string | null, id: string): boolean {
  if (!pathname) return false;
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return dec(pathname).replace(/[/]+$/, "") === dec(inboxHref(id));
}

export const LATER_CHOICES = [
  { until: "15m", label: "15 دقيقة" },
  { until: "1h", label: "ساعة" },
  { until: "morning", label: "الصبح" },
] as const;

const left = (iso: string | null, now = Date.now()): string | null => {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso) - now) / 60_000);
  if (m <= 0) return "انتهى";
  return m < 60 ? `بعد ${m} دقيقة` : m < 1440 ? `بعد ${Math.round(m / 60)} ساعة` : `بعد ${Math.round(m / 1440)} يوم`;
};

/**
 * THE decision card — the same one on the home, in «بانتظارك» and on the ring screen (docs/rebuild/04-work.md §6): urgency · what kind ·
 * who asked · the sentence · why · the money it moves · the buttons (the first is the main one, always in the same order).
 * It only draws and reports a press; `InboxCard` (components/inbox) is what sends it to the right endpoint.
 */
export function DecisionCard({
  item,
  onAction,
  busy = false,
  resolved = null,
  compact = false,
  detailLink = true,
  className,
}: {
  item: InboxItem;
  onAction?: (key: InboxActionKey, extra?: { until?: string }) => void;
  busy?: boolean;
  /** Replaces the buttons once the item is decided («وافقت»). */
  resolved?: string | null;
  compact?: boolean;
  /** A link to the item's own page. */
  detailLink?: boolean;
  className?: string;
}) {
  const [later, setLater] = useState(false);
  // U-12: «جرّب أول» and «التفاصيل» lead to the item's own page — on that page they are not shown (they would only reload it)
  const here = isItsOwnPage(usePathname(), item.id);
  const u = URGENCY[item.urgency];
  const delta = item.effect?.moneyDeltaDaily ?? null;
  const expires = left(item.expiresAt);
  return (
    <article className={cn("space-y-3 rounded-card border bg-surface-1 p-4", item.urgency === "red" && !resolved ? "border-danger/50" : "border-border", className)} data-item={item.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={u.tone}>{u.label}</Pill>
        <Chip>{KIND_AR[item.kind]}</Chip>
        <Chip>{DOMAIN_AR[item.domain]}</Chip>
        {item.from ? (
          <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <Bot className="size-3.5" aria-hidden />
            {item.from.label}
          </span>
        ) : null}
        {expires ? <span className="ms-auto text-xs text-fg-muted">ينتهي {expires}</span> : null}
      </div>

      <h3 className="text-base font-extrabold leading-7 text-fg">{item.title}</h3>
      {item.why && !compact ? <p className="text-sm leading-6 text-fg-muted">{item.why}</p> : null}

      {item.effect || item.numbers?.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {delta ? (
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", delta > 0 ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok")}>
              <span dir="ltr" className="tabular-nums">
                {delta > 0 ? "+" : "−"}
                {fmt(Math.abs(delta), "$", 0)}
              </span>{" "}
              باليوم
            </span>
          ) : null}
          {item.effect?.moneyAfter ? (
            <span dir="ltr" className="rounded-md bg-warn/10 px-2 py-0.5 text-xs font-bold tabular-nums text-warn">
              {fmt(item.effect.moneyAfter, "$", 0)}
            </span>
          ) : null}
          {item.effect?.text ? <span className="text-fg-muted">{item.effect.text}</span> : null}
          {item.numbers?.map((n) => (
            <span key={n.label} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">
              <span className="text-fg-muted">{n.label}: </span>
              <span dir="ltr" className="font-semibold tabular-nums">
                {n.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {item.preview ? <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm leading-6 text-fg">{item.preview}</p> : null}
      {item.postponedUntil ? <p className="text-xs text-warn">مأجّل — بيرجع {left(item.postponedUntil) ?? "قريب"}</p> : null}

      {resolved ? (
        <p className="text-sm font-bold text-ok">{resolved}</p>
      ) : onAction ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.actions.map((a, i) =>
              a.key === "later" ? (
                <Button key={a.key} variant={a.variant} size={compact ? "sm" : "md"} disabled={busy} aria-expanded={later} onClick={() => setLater((v) => !v)}>
                  {a.label}
                </Button>
              ) : a.key === "open" ? (
                here ? null : (
                <Link key={a.key} href={inboxHref(item.id)} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-bold text-fg-muted hover:bg-surface-2 hover:text-fg">
                  {a.label}
                </Link>
                )
              ) : (
                <Button
                  key={a.key}
                  variant={a.variant}
                  size={compact ? "sm" : i === 0 ? "lg" : "md"}
                  disabled={busy}
                  {...(a.confirm ? { confirm: "متأكد؟" } : {})}
                  onClick={() => onAction(a.key)}
                >
                  {a.label}
                </Button>
              ),
            )}
            {detailLink && !here ? (
              <Link href={inboxHref(item.id)} className="ms-auto text-sm font-semibold text-info hover:underline">
                التفاصيل
              </Link>
            ) : null}
          </div>
          {later ? (
            <div role="group" aria-label="أجّل لـ" className="flex flex-wrap gap-2">
              {LATER_CHOICES.map((c) => (
                <Button key={c.until} variant="secondary" size="sm" disabled={busy} onClick={() => onAction("later", { until: c.until })}>
                  {c.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
