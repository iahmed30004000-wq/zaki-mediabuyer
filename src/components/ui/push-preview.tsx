import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";

/**
 * What a notification looks like on the phone's screen (docs/rebuild-v6/03-look.md §7): the app, the time, the title and the sentence. It is for the settings page, so the
 * owner sees what will ring before choosing what rings; the text is what the code would send, never a customer's name or phone. It sits on a tape-coloured "screen".
 */
export function PushPreview({ title, body, time, appName = "الميديا باير", className }: { title: string; body: string; time?: string; appName?: string; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[360px] flex-col gap-2.5 rounded-[28px] border border-border bg-tape p-3.5", className)}>
      <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface-1 p-3">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <BrandMark className="size-5" />
          <span>{appName}</span>
          {time ? <span className="ms-auto font-display tabular-nums">{time}</span> : null}
        </div>
        <b className="text-base font-bold text-fg">{title}</b>
        <p className="text-base text-fg">{body}</p>
      </div>
    </div>
  );
}
