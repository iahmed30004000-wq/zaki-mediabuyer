/**
 * WHAT A `push_jobs` MAY CHANGE — pure (docs/rebuild-v6/01-model.md §11, W-13). The agent's map is a hint, not an order: what the owner edited by hand
 * (`Workflow.ownerEdited`) is never written over, a step that is no longer in the agent's list is marked (not left behind as if nothing happened, not
 * deleted), and a step that comes back is switched on again. Nothing here reads a database.
 */
import type { WfEdge, WfGraph, WfNode } from "./workflow";

/** The fields of a job the owner can edit by hand — the names of the columns, as `ownerEdited` keeps them. */
export const OWNER_FIELDS = ["name", "description", "schedule", "scheduleText", "kind", "runsAt", "endsAt", "note", "number", "domain"] as const;
export type OwnerField = (typeof OWNER_FIELDS)[number];

/** What the owner's own save of a job (the settings sheet, the schedule) marks as «his»: only what really changed. */
export function ownerEditedFields(patch: { name?: string; description?: string | null; schedule?: string | null }, before: { name: string; description: string | null; schedule: string | null }): OwnerField[] {
  const out: OwnerField[] = [];
  if (patch.name !== undefined && patch.name !== before.name) out.push("name");
  if (patch.description !== undefined && patch.description !== before.description) out.push("description");
  // the cron and the words that say it are one thing: if he moved the time, the agent's words for the old one must not come back
  if (patch.schedule !== undefined && patch.schedule !== before.schedule) out.push("schedule", "scheduleText");
  return out;
}

/** The union of what was already his and what he just edited (no duplicates, a stable order). */
export const mergeOwnerEdited = (current: readonly string[], added: readonly string[]): string[] => [...new Set([...current, ...added])].sort();

/** Drops from `data` every column the owner edited by hand; returns what is left and the names that were kept as they are. */
export function withoutOwnerEdited<T extends Record<string, unknown>>(data: T, ownerEdited: readonly string[]): { data: Partial<T>; kept: string[] } {
  const kept: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (ownerEdited.includes(k)) kept.push(k);
    else out[k] = v;
  }
  return { data: out as Partial<T>, kept };
}

/** The text a step carries when the agent's list no longer has it (the step is switched off, never deleted). */
export const GONE_DESC = "غابت عن خريطة Claude — طفّيناها";

export interface BranchIn {
  id: string;
  label: string;
  desc?: string;
  enabled?: boolean;
}

/** A step the agent carries out itself — the ones its own list speaks for (a person's step, an n8n call, a gate are not its to drop). */
const agentStep = (n: WfNode): boolean => n.type === "step" && (n.executor === undefined || n.executor.startsWith("claude"));

const stepNode = (b: BranchIn): WfNode => ({ id: b.id, type: "step", label: b.label, ...(b.desc ? { desc: b.desc } : {}), executor: "claude_mcp", dataSource: "mcp", permission: "green", ...(b.enabled === false ? { disabled: true } : {}) });

export interface BranchMerge {
  /** the new drawing, or null when nothing changed */
  graph: WfGraph | null;
  added: string[];
  /** steps the list no longer has: now switched off and marked */
  gone: string[];
  /** steps that were gone and are back */
  revived: string[];
}

/**
 * The drawing with the agent's list merged in by id. New steps are appended; titles are updated; the agent may switch a step off but never one the owner
 * switched off back on; a step the agent's list no longer names (and that it carries out) is switched off and marked; one that comes back is switched on
 * again. A list that is empty says nothing about the steps (it is not «I do nothing»).
 */
export function mergeBranches(graph: WfGraph, branches: readonly BranchIn[]): BranchMerge {
  const nodes: WfNode[] = graph.nodes.map((n) => ({ ...n }));
  const edges: WfEdge[] = [...graph.edges];
  const added: string[] = [];
  const gone: string[] = [];
  const revived: string[] = [];
  let changed = false;
  const named = new Set(branches.map((b) => b.id));

  for (const b of branches) {
    const at = nodes.findIndex((n) => n.id === b.id);
    if (at >= 0) {
      const n = nodes[at]!;
      if (n.label !== b.label) (n.label = b.label), (changed = true);
      if (n.desc === GONE_DESC) {
        // back in the list: it is on again (it was switched off only because it was gone), with the agent's words
        revived.push(n.id);
        delete n.disabled;
        if (b.desc !== undefined) n.desc = b.desc;
        else delete n.desc;
        if (b.enabled === false) n.disabled = true;
        changed = true;
      } else {
        if (b.desc !== undefined && n.desc !== b.desc) (n.desc = b.desc), (changed = true);
        if (b.enabled === false && !n.disabled) (n.disabled = true), (changed = true);
      }
    } else {
      const last = nodes[nodes.length - 1];
      nodes.push(stepNode(b));
      if (last) edges.push({ from: last.id, to: b.id });
      added.push(b.id);
      changed = true;
    }
  }
  if (branches.length) {
    for (const n of nodes) {
      if (named.has(n.id) || !agentStep(n) || n.disabled) continue;
      n.disabled = true;
      n.desc = GONE_DESC;
      gone.push(n.id);
      changed = true;
    }
  }
  return { graph: changed ? { nodes, edges } : null, added, gone, revived };
}
