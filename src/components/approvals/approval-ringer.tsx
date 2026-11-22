"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PhoneMissed } from "lucide-react";
import type { ApprovalView } from "@/server/approvals";
import { RingScreen } from "./ring-screen";
import { safeFetch } from "@/lib/call";

const POLL_MS = 60_000; // never faster: the phone's battery. The native app is pushed (FCM), not polled.
const KEY = "mb:rang";

function loadRang(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * The open app, ringing: every minute (only while the page is visible) it asks what waits for the owner. A 🔴 request
 * that has not rung yet — while he is awake — takes the whole screen with the ringtone and the vibration for up to 60
 * seconds; then it stays as a «missed call» banner until he answers. A 🟠 one is a banner. A 🟡 one is never shown here.
 * When he is asleep nothing rings (the server says so: `mode`). This is the in-app half; the native wrapper adds the
 * push that rings the phone when the app is closed.
 */
export function ApprovalRinger() {
  const pathname = usePathname() ?? "/";
  const [waiting, setWaiting] = useState<ApprovalView[]>([]);
  const [ring, setRing] = useState<{ approval: ApprovalView; ringing: boolean } | null>(null);
  const rang = useRef<Set<string>>(new Set());
  const ringRef = useRef<typeof ring>(null);
  ringRef.current = ring;
  const off = pathname.startsWith("/login") || pathname.startsWith("/ring/");

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await safeFetch("/api/approvals/pending", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { approvals: ApprovalView[]; mode: "awake" | "asleep" };
      const loud = d.approvals.filter((a) => a.urgency !== "yellow");
      setWaiting(loud);
      const cur = ringRef.current;
      if (cur) {
        if (!loud.some((a) => a.id === cur.approval.id)) setRing(null); // answered somewhere else
        return;
      }
      // decided here, outside any state updater (a React updater may run twice and must stay pure)
      const fresh = d.mode === "awake" ? loud.find((a) => a.urgency === "red" && !rang.current.has(a.id)) : undefined;
      if (!fresh) return;
      rang.current.add(fresh.id);
      localStorage.setItem(KEY, JSON.stringify([...rang.current].slice(-100)));
      setRing({ approval: fresh, ringing: true });
    } catch {
      // offline: nothing to ring about
    }
  }, []);

  useEffect(() => {
    if (off) return;
    rang.current = loadRang();
    void poll();
    const t = setInterval(poll, POLL_MS);
    const visible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [off, poll]);

  if (off) return null;
  if (ring) {
    return (
      <RingScreen
        approval={ring.approval}
        ringing={ring.ringing}
        overlay
        onLater={() => {
          setRing(null);
          void poll();
        }}
      />
    );
  }
  const first = waiting[0];
  if (!first || pathname.startsWith("/inbox")) return null;
  return (
    <div className="fixed inset-x-3 top-[4.75rem] z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-warn/40 bg-surface-1 px-3 py-2 shadow-card md:top-[4.75rem]">
      <PhoneMissed className="size-5 shrink-0 text-warn" />
      <button type="button" onClick={() => setRing({ approval: first, ringing: false })} className="min-w-0 flex-1 text-start text-sm">
        <span className="block truncate font-medium text-fg">{waiting.length > 1 ? `${waiting.length} موافقات بانتظارك` : `بانتظارك: ${first.title}`}</span>
        <span className="block truncate text-sm text-fg-muted">{first.why}</span>
      </button>
      <Link href="/inbox" className="shrink-0 text-sm font-medium text-accent">
        افتح
      </Link>
    </div>
  );
}
