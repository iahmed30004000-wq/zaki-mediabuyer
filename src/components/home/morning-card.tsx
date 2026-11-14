"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coffee, X } from "lucide-react";
import { Panel } from "@/components/mb/section";
import type { MorningCard as Morning } from "@/lib/today-view";

const STATUS: Record<string, string> = { ok: "خلص", failed: "فشل", waiting: "متوقف", running: "شغّال", skipped: "تخطّى" };

/**
 * «صباح الخير»: one card for the whole night — what ran, what is waiting for him, what was kept quiet. It stays for twelve
 * hours after he wakes, or until he closes it.
 */
export function MorningCard({ m }: { m: Morning }) {
  const id = `mb:morning:${m.to}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(localStorage.getItem(id) === "1"), [id]);
  if (hidden) return null;
  const quiet = !m.runs.ok && !m.runs.failed && !m.runs.waiting && !m.approvalsQueued && !m.notifications.length && !m.executed;
  return (
    <Panel className="relative space-y-3 border-accent/40 bg-accent/5">
      <button type="button" aria-label="سكّر" onClick={() => { localStorage.setItem(id, "1"); setHidden(true); }} className="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2">
        <X className="size-4" />
      </button>
      <h2 className="flex items-center gap-2 text-base font-bold text-fg">
        <Coffee className="size-5 text-accent" />
        صباح الخير — شو صار وإنت نايم
      </h2>
      {quiet ? <p className="text-sm text-fg-muted">ليلة هادية: ما اشتغل شي وما استنى شي.</p> : null}
      <ul className="space-y-1.5 text-sm text-fg">
        {m.runs.ok + m.runs.failed + m.runs.waiting > 0 ? (
          <li>
            <span className="font-semibold">التشغيلات:</span> {m.runs.ok} خلصت{m.runs.failed ? ` · ${m.runs.failed} فشلت` : ""}{m.runs.waiting ? ` · ${m.runs.waiting} متوقفة` : ""}
            <ul className="mt-1 space-y-0.5 ps-4 text-xs text-fg-muted">
              {m.runs.list.map((r, i) => (
                <li key={i}>{r.name} — {STATUS[r.status] ?? r.status}{r.summary ? `: ${r.summary}` : ""}</li>
              ))}
            </ul>
          </li>
        ) : null}
        {m.executed ? <li><span className="font-semibold">قرارات أمان تنفّذت لحالها:</span> {m.executed}</li> : null}
        {m.approvalsQueued ? (
          <li>
            <span className="font-semibold">بانتظارك:</span> {m.approvalsQueued} قرار استنى للصبح — <Link href="/tasks#approval" className="font-medium text-accent hover:underline">افتحهم</Link>
          </li>
        ) : null}
        {m.notifications.length ? (
          <li>
            <span className="font-semibold">تنبيهات انحفظت بلا رنين:</span> {m.notifications.map((n) => n.title).join(" · ")}
          </li>
        ) : null}
      </ul>
    </Panel>
  );
}
