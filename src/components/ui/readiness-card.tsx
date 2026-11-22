import { cn } from "@/lib/utils";
import { ButtonLink } from "./button-link";
import { Lamp } from "./lamp";

export interface ReadinessRow {
  key: string;
  ok: boolean;
  /** what is missing, in a sentence («5 منتجات بلا نقطة تعادل»); when it is fine, what is fine */
  text: string;
  /** the button that fixes it */
  action?: { label: string; href: string } | null;
}

/**
 * «شو ناقص لتطلع الأرقام» (docs/rebuild-v6/03-look.md §7): a list of what the numbers need, and for each one that is missing a button that fixes it. It stands in place of
 * four dashes when the numbers cannot be shown: the screen says WHY and what to press. The rows are computed by the code (`numbersReadiness`); this only draws them. The
 * lamp is green for what is there and orange for what is missing, and the sentence says it too.
 */
export function ReadinessCard({ rows, title = "شو ناقص لتطلع الأرقام", className }: { rows: readonly ReadinessRow[]; title?: string; className?: string }) {
  if (!rows.length) return null;
  const missing = rows.filter((r) => !r.ok).length;
  return (
    <section aria-label={title} className={cn("space-y-3 rounded-2xl border border-warn/45 bg-warn/[0.06] p-4", missing === 0 && "border-ok/45 bg-ok/[0.06]", className)}>
      <h3 className="font-display text-lg font-bold text-fg">{title}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-2.5 last:border-b-0">
            <Lamp state={r.ok ? "done" : "wait"} size={10} />
            <span className={cn("min-w-0 flex-1 basis-56 text-base", r.ok ? "text-fg-muted" : "font-semibold text-fg")}>{r.text}</span>
            {!r.ok && r.action ? (
              <ButtonLink href={r.action.href} variant="secondary" size="sm">
                {r.action.label}
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
