"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalView } from "@/server/approvals";
import { AnswerButtons, URGENCY, Why, minutesLeft, timeText } from "./approval-card";

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

/** The ring screen: the title, the one-line reason, the key numbers, the amount, and four big answers. «ليش؟» opens the whole analysis. */
export function RingScreen({ approval, ringing, overlay, onLater }: { approval: ApprovalView; ringing: boolean; overlay: boolean; onLater?: () => void }) {
  const router = useRouter();
  const [why, setWhy] = useState(false);
  const [left, setLeft] = useState(minutesLeft(approval.expiresAt));

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
  useEffect(() => {
    const t = setInterval(() => setLeft(minutesLeft(approval.expiresAt)), 30_000);
    return () => clearInterval(t);
  }, [approval.expiresAt]);

  const u = URGENCY[approval.urgency];
  const open = approval.status === "pending" || approval.status === "postponed";
  return (
    <div role="dialog" aria-modal={overlay} aria-label="موافقة بانتظارك" className={cn("flex flex-col bg-surface text-fg", overlay ? "fixed inset-0 z-[100] overflow-y-auto" : "min-h-dvh")}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 pb-8 pt-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="relative inline-flex size-20 items-center justify-center rounded-full bg-accent text-accent-fg">
            {ringing ? <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" /> : null}
            <Phone className={cn("relative size-9", ringing && "animate-wiggle motion-reduce:animate-none")} />
          </span>
          <p className="text-sm font-medium text-fg-muted">
            {ringing ? "بدي موافقتك هلأ" : open ? "بانتظار موافقتك" : "انجاوب على هالطلب"} · {u.icon}
          </p>
          <h1 className="text-xl font-bold leading-8">{approval.title}</h1>
          <p className="text-sm leading-6 text-fg-muted">{approval.why}</p>
        </div>

        {approval.amount !== null || approval.numbers.length ? (
          <div className="flex flex-wrap justify-center gap-2 text-sm">
            {approval.amount !== null ? (
              <span dir="ltr" className="rounded-lg bg-warn/10 px-3 py-1.5 text-lg font-bold tabular-nums text-warn">
                ${approval.amount}
              </span>
            ) : null}
            {approval.numbers.map((n) => (
              <span key={n.label} className="rounded-lg bg-surface-2 px-3 py-1.5">
                <span className="text-fg-muted">{n.label}: </span>
                <span dir="ltr" className="font-semibold tabular-nums">{n.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {left !== null ? <p className="text-center text-xs text-fg-muted">ينتهي {timeText(left)}</p> : null}

        {open ? (
          <AnswerButtons
            id={approval.id}
            big
            after={() => {
              if (overlay) onLater?.();
              else router.push("/inbox");
            }}
          />
        ) : (
          <p className="text-center text-sm text-fg-muted">الحالة: {approval.status} {approval.decidedBy ? "" : ""}</p>
        )}

        <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="mx-auto text-sm font-medium text-accent hover:underline">
          {why ? "سكّر" : "ليش؟"}
        </button>
        {why ? <Why a={approval} /> : null}

        {overlay && open ? (
          <button type="button" onClick={onLater} className="mx-auto text-xs text-fg-muted hover:text-fg">
            لاحقاً — خلّيها بانتظاري
          </button>
        ) : null}
      </div>
    </div>
  );
}
