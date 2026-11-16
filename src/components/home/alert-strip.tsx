import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { TodayAlert } from "@/core/today";
import { cn } from "@/lib/utils";

const TONE = {
  danger: { cls: "border-danger/40 bg-danger/5 text-danger", Icon: OctagonAlert },
  warn: { cls: "border-warn/40 bg-warn/5 text-warn", Icon: AlertTriangle },
  info: { cls: "border-border bg-surface-1 text-fg-muted", Icon: Info },
} as const;

/** What must not be missed, in one strip: tests over their share, a product above break-even, a campaign spending with no order, low stock. Each one opens the place to fix it. */
export function AlertStrip({ alerts }: { alerts: TodayAlert[] }) {
  if (!alerts.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-fg-muted">
        <CheckCircle2 className="size-4 text-ok" />
        ما في شي لازم تنتبه إله هلأ.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="تنبيهات">
      {alerts.map((a) => {
        const { cls, Icon } = TONE[a.tone];
        return (
          <li key={a.key}>
            <Link href={a.href} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm hover:brightness-95 max-md:min-h-[44px]", cls)}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="text-fg">{a.text}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
