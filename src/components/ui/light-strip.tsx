import { needsFold, stripItems, stripSummary, type Stretch, type StripItem, type StripStep } from "@/core/light-strip";
import { cn } from "@/lib/utils";
import { Lamp } from "./lamp";

/** The three small diodes between two lamps, drawn horizontally (the strip) or vertically (`RunSteps`). */
export function Diodes({ stretch, vertical = false }: { stretch: Stretch; vertical?: boolean }) {
  return (
    <>
      {[0, 1, 2].map((k) => (
        <i
          key={k}
          aria-hidden
          className={cn(
            "block size-1 rounded-[1px]",
            stretch.lit ? cn("bg-ok", stretch.glow && "shadow-diode-ok") : stretch.chase ? "animate-chase bg-info motion-reduce:animate-none" : "bg-muted",
            vertical && "mx-auto",
          )}
          style={stretch.chase ? { animationDelay: `${k * 0.2}s` } : undefined}
        />
      ))}
    </>
  );
}

function Items({ items, big }: { items: readonly StripItem[]; big: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center rounded-full bg-tape", big ? "px-3 py-2.5" : "px-2 py-1.5")}>
      {items.map((it, k) =>
        it.kind === "lamp" ? (
          <Lamp key={`l${k}`} state={it.lamp} size={big ? 20 : 14} glow={it.glow} />
        ) : it.kind === "stretch" ? (
          <span key={`s${k}`} aria-hidden className="flex min-w-2.5 flex-1 items-center justify-evenly">
            <Diodes stretch={it} />
          </span>
        ) : (
          // a folded run of finished steps: one lit stretch with how many it stands for
          <span key={`f${k}`} aria-hidden className="flex min-w-12 flex-1 items-center justify-evenly gap-1 text-ok">
            <Diodes stretch={{ lit: true, chase: false, glow: it.glow }} />
            <span className="font-display text-xs font-bold tabular-nums">{it.count}</span>
            <Diodes stretch={{ lit: true, chase: false, glow: it.glow }} />
          </span>
        ),
      )}
    </div>
  );
}

/**
 * THE LIGHT STRIP (docs/rebuild-v6/03-look.md §6): one lamp per step, three diodes between two lamps. The stretch behind a finished step glows green,
 * behind the running step the diodes chase, a step the site only inferred is green without a halo. `label` is the run's sentence («هلق عند الخطوة 4 من 7 …»):
 * it is the strip's accessible text; without it the strip counts its own lamps. Past 12 steps, on a phone, finished steps in a row fold into one stretch with their count.
 */
export function LightStrip({ steps, label, big = false, className }: { steps: readonly StripStep[]; label?: string; big?: boolean; className?: string }) {
  const text = label?.trim() || stripSummary(steps);
  if (!steps.length) return null;
  const fold = needsFold(steps);
  return (
    <div role="img" aria-label={text} className={className}>
      {fold ? (
        <>
          <div className="md:hidden">
            <Items items={stripItems(steps, { fold: true })} big={big} />
          </div>
          <div className="hidden md:block">
            <Items items={stripItems(steps)} big={big} />
          </div>
        </>
      ) : (
        <Items items={stripItems(steps)} big={big} />
      )}
    </div>
  );
}
