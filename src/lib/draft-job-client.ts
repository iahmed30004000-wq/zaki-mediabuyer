/**
 * The browser's half of «احفظها مهمة مطفية»: a job the assistant drafted (a graph of steps) is saved, switched off, by the same route the steps screen uses (`POST /api/workflow`).
 * It answers what the card says in words: the job's key, a trial (nothing was saved), or the error. Kept out of the card so the card holds no code between its tags.
 */
import type { WfGraph } from "@/core/workflow";
import { safeFetch } from "./call";

export type SaveDraftJob = { saved: true; key: string } | { saved: false; demo: true } | { saved: false; error: string };

export async function saveDraftJob(draft: { name: string; description?: string; graph: WfGraph }): Promise<SaveDraftJob> {
  const body = { name: draft.name, ...(draft.description ? { description: draft.description } : {}), graph: draft.graph, enabled: false, note: "مسودة من المساعد" };
  const r = await safeFetch("/api/workflow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; workflow?: { key: string } };
  if (!r.ok) return { saved: false, error: d.error ?? "صار خطأ" };
  if (d.demo || !d.workflow) return { saved: false, demo: true };
  return { saved: true, key: d.workflow.key };
}
