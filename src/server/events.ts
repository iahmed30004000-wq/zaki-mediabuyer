/**
 * THE ONE PLACE AN EVENT IS WRITTEN (docs/rebuild-v6/01-model.md §10). `emit` turns an event of the engine into a `Notification` row whose key makes it
 * unique — the same event twice is one row — and does nothing else: sending it is the dispatcher's (src/jobs/notify-dispatch.ts, v6 · P7), which picks the row up
 * within the minute. It never throws: failing to write a notice must not fail the work that raised it.
 */
import { runEventRow, wantsEvent, type RunEventFacts } from "@/core/events";
import { createNotification } from "./notify";

export interface EmitResult {
  written: boolean;
  /** why nothing was written: the job does not want this event, or the write failed */
  skipped?: "not_wanted" | "failed" | "exists";
}

/** An event of a run (the events of the other phases — stock, report, backup, approval — join here as they are wired). `notifyOn` is the job's own list of what it wants to hear about (missed · stuck · failed · done). */
export async function emit(facts: RunEventFacts, notifyOn: readonly string[] | null | undefined): Promise<EmitResult> {
  if (!wantsEvent(facts.kind, notifyOn)) return { written: false, skipped: "not_wanted" };
  try {
    const row = runEventRow(facts);
    const r = await createNotification({ urgency: row.urgency, audience: "owner", title: row.title, body: row.body, href: row.href, source: "workflow", key: row.key, kind: facts.kind });
    return r.created ? { written: true } : { written: false, skipped: "exists" };
  } catch (e) {
    console.error("emit failed:", e instanceof Error ? e.message : e);
    return { written: false, skipped: "failed" };
  }
}
