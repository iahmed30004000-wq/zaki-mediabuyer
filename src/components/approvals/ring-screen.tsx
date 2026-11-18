"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { InboxCard } from "@/components/inbox/inbox-card";
import { Button } from "@/components/ui/button";
import { fromApproval } from "@/core/inbox";
import { cn } from "@/lib/utils";
import type { ApprovalView } from "@/server/approvals";
import { minutesLeft } from "./approval-card";

/** Two tones, again and again — the sound of an incoming call. Returns the function that stops it. A browser may refuse sound until the page was touched once: then only the screen and the vibration work. */
export function startRingtone(): () => void {
  let stopped = false;
  let ctx: AudioContext | null = null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  } catch {
    ctx = null;
  }
  const beep = (at: number, freq: number) => {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.4);
  };
  const cycle = () => {
    if (stopped) return;
    if (ctx) {
      void ctx.resume?.().catch(() => undefined);
      const t = ctx.currentTime;
      beep(t, 880);
      beep(t + 0.45, 660);
      beep(t + 0.9, 880);
      beep(t + 1.35, 660);
    }
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  };
  cycle();
  const id = setInterval(cycle, 2600);
  return () => {
    stopped = true;
    clearInterval(id);
    navigator.vibrate?.(0);
    void ctx?.close().catch(() => undefined);
  };
}

/**
 * The ring screen: the sound and the call icon while it rings, then THE decision card (the same one as in «بانتظارك») — the title, the
 * reason, the numbers, the amount, and the answers. A request that is already answered shows its state instead of buttons.
 */
export function RingScreen({ approval, ringing, overlay, onLater }: { approval: ApprovalView; ringing: boolean; overlay: boolean; onLater?: () => void }) {
  const router = useRouter();

  // sound and vibration while it rings — at most 60 seconds, then it stays on screen silently (a missed call that waits)
  useEffect(() => {
    if (!ringing) return;
    const stop = startRingtone();
    const timer = setTimeout(stop, 60_000);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [ringing]);

  const open = approval.status === "pending" || approval.status === "postponed";
  const item = fromApproval(approval);
  return (
    <div role="dialog" aria-modal={overlay} aria-label="موافقة بانتظارك" className={cn("flex flex-col bg-surface text-fg", overlay ? "fixed inset-0 z-[100] overflow-y-auto" : "min-h-dvh")}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 pb-8 pt-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="relative inline-flex size-20 items-center justify-center rounded-full bg-accent text-accent-fg">
            {ringing ? <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" /> : null}
            <Phone className={cn("relative size-9", ringing && "animate-wiggle motion-reduce:animate-none")} />
          </span>
          <p className="text-sm font-semibold text-fg-muted">{ringing ? "بدي موافقتك هلأ" : open ? "بانتظار موافقتك" : "انجاوب على هالطلب"}</p>
        </div>

        {open ? (
          <InboxCard
            item={item}
            afterDecide={() => {
              if (overlay) onLater?.();
              else router.push("/inbox");
            }}
          />
        ) : (
          <p className="text-center text-sm text-fg-muted">الحالة: {approval.status}</p>
        )}

        {overlay && open ? (
          <Button variant="ghost" onClick={onLater} className="mx-auto">
            لاحقاً — خلّيها بانتظاري
          </Button>
        ) : null}
      </div>
    </div>
  );
}
