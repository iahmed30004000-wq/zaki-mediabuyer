"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { livePollMs, liveSignature, type LiveOut } from "@/core/jobs-live";
import { callJson } from "@/lib/call";

export const LIVE_KEY = ["jobs-live"] as const;

async function fetchLive(): Promise<LiveOut> {
  const r = await callJson<LiveOut>("/api/jobs/live", { cache: "no-store" });
  if (!r.ok || !r.data) throw new Error(r.error ?? "ما قدرنا نقرا الوضع الحي");
  return r.data;
}

/**
 * THE LIVE ANSWER (docs/rebuild-v6/01-model.md §13): `/api/jobs/live` through react-query — every 5 seconds while a run is going, every 30 otherwise, and it stops by itself while the
 * tab is hidden. Every screen that shows a run, the agents or the number of requests shares this one query (one request, whoever asks).
 */
export function useLive(enabled = true) {
  return useQuery({
    queryKey: LIVE_KEY,
    queryFn: fetchLive,
    enabled,
    staleTime: 4_000,
    refetchInterval: (query) => livePollMs(query.state.data),
    refetchIntervalInBackground: false,
  });
}

/**
 * Keeps a screen that was drawn on the server in step with what is going on: it asks for the live answer, and when what the screen shows has changed (`liveSignature`) it reads
 * the page again. The first answer is only remembered — nothing is redrawn for nothing. It draws nothing itself. `jobKey` / `runId` narrow it to what the screen shows.
 */
export function LiveRefresh({ jobKey, runId }: { jobKey?: string; runId?: string }) {
  const router = useRouter();
  const live = useLive();
  const sig = liveSignature(live.data, { ...(jobKey ? { jobKey } : {}), ...(runId ? { runId } : {}) });
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (sig === null) return;
    if (last.current !== null && last.current !== sig) router.refresh();
    last.current = sig;
  }, [sig, router]);
  return null;
}
