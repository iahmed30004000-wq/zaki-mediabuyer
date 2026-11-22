/**
 * THE MAP FROM CLAUDE (`push_jobs`) and THE OWNER'S DECISIONS ON IT (the decision sheet) — docs/rebuild/04-work.md §4 and §8.
 *
 * Claude knows its own schedule; the site shows it with numbers. `upsertJobs` creates or updates a job by its key. The owner's word wins:
 * a job or a branch he switched off is never switched back on by a push, and his decision on a job is never erased. Nothing is deleted:
 * `replace` marks the jobs Claude made that are not in its list as «خلصت». Every text passes the customer-data filter.
 */
import { z } from "zod";
import { JOB_ADVICE, JOB_DOMAINS, JOB_KINDS, JOB_DECISIONS } from "@/core/jobs";
import { refuseIfPrivate } from "@/core/push-rows";
import { isValidCron } from "@/core/cron";
import { findNameClash } from "@/core/job-map";
import { mergeBranches, withoutOwnerEdited } from "@/core/push-jobs";
import { GraphSchema, type WfGraph, type WfNode } from "@/core/workflow";
import { ensureLayout } from "@/core/workflow-edit";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { createHandoff } from "./handoffs";
import { loadJob, nextJobNumber, numberTaken, withNumberLock } from "./job-map";
import { RunRefused, updateWorkflow } from "./workflows";
import type { Prisma } from "@prisma/client";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const iso = z.string().datetime({ offset: true });
const text = (n: number) => z.string().trim().min(1).max(n);

const Branch = z
  .object({
    id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "معرّف الفرع حروف إنجليزية وأرقام وشرطات"),
    label: text(120),
    desc: text(300).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const JobIn = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{2,60}$/, "key: حروف صغيرة وأرقام وشرطات (2–60)").describe("نفس مفتاح log_run"),
    number: z.number().int().min(1).max(999).optional().describe("رقمها عالخريطة"),
    name: text(120),
    domain: z.enum(JOB_DOMAINS).describe("ads · ops"),
    kind: z.enum(JOB_KINDS).describe("recurring متكررة · once مرة وحدة · window لفترة · manual عند الطلب"),
    schedule: z.string().trim().max(60).optional().describe("cron بخمس خانات بتوقيت عمّان"),
    schedule_text: text(80).optional().describe("الموعد بالكلام لما ما في cron"),
    runs_at: iso.optional(),
    ends_at: iso.optional(),
    runs_from: text(60).optional(),
    origin: text(200).optional(),
    touches: z.array(text(60)).max(8).optional(),
    talks_to: z.array(text(60)).max(8).optional(),
    description: text(500).optional(),
    note: text(300).optional(),
    advice: z.enum(JOB_ADVICE).optional(),
    advice_text: text(300).optional(),
    branches: z.array(Branch).max(20).optional(),
    finished: z.boolean().optional(),
  })
  .strict();

export const PushJobsInput = z
  .object({
    jobs: z.array(JobIn).min(1).max(40).describe("خريطة مهامك: من 1 لـ 40"),
    replace: z.boolean().optional().describe("true: المهام اللي مصدرها mcp وغايبة عن القائمة بتتعلّم «خلصت» (ولا شي بينحذف)"),
  })
  .strict();
export type PushJobsInputT = z.infer<typeof PushJobsInput>;
type JobInT = z.infer<typeof JobIn>;

export interface PushJobResult {
  key: string;
  ok: boolean;
  created?: boolean;
  /** the owner's switch: false = he switched it off, do not run it */
  enabled?: boolean;
  number?: number | null;
  /** the owner's decision on it (keep / cancel / merge), if he made one */
  decision?: string | null;
  branches?: { id: string; enabled: boolean }[];
  /** the key asked for was merged into another job: this is the one it landed on */
  redirected_to?: string;
  /** steps the agent's list no longer has: switched off and marked */
  gone_steps?: string[];
  /** fields the owner edited by hand: kept as he left them, the push did not write them */
  kept_yours?: string[];
  error?: string;
}
export interface PushJobsResult {
  jobs: PushJobResult[];
  /** keys marked finished because `replace` was set and they were not in the list */
  finished: string[];
}

const texts = (j: JobInT) => [j.name, j.schedule_text, j.runs_from, j.origin, j.description, j.note, j.advice_text, ...(j.touches ?? []), ...(j.talks_to ?? []), ...(j.branches ?? []).flatMap((b) => [b.label, b.desc])];

/** A new job's drawing: the trigger, then its branches in a straight line. */
function drawing(j: JobInT): WfGraph {
  const trigger: WfNode = { id: "start", type: "trigger", label: j.schedule_text ?? "بداية", executor: "system", permission: "green" };
  const steps: WfNode[] = (j.branches ?? []).map((b) => ({ id: b.id, type: "step", label: b.label, ...(b.desc ? { desc: b.desc } : {}), executor: "claude_mcp", dataSource: "mcp", permission: "green", ...(b.enabled === false ? { disabled: true } : {}) }));
  const nodes = [trigger, ...steps];
  return ensureLayout({ nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) });
}

/**
 * Creates or updates every job of the list, one by one: a job that fails (a phone number in a note, a bad cron, a name that is another job's) says so
 * and the others still land. The site owns the map (docs/rebuild-v6/01-model.md §11 · §12):
 *   · the number is the site's — the one asked for is used only when it is free, else the next free one; an existing job keeps its own;
 *   · a name that is another job's is refused, with that job's key;
 *   · a key that was merged into another job lands on that one;
 *   · what the owner edited by hand is never written over; `finished: false` opens a job again;
 *   · steps the list no longer has are switched off and marked, never left as if nothing happened.
 */
export async function upsertJobs(input: PushJobsInputT, actor: Actor, now = new Date(), opts: { actorKey?: string | null } = {}): Promise<PushJobsResult> {
  // a job the agent makes is carried out by that agent (an old token tied to nobody is Claude, as the queue always took it)
  const carrier = opts.actorKey ?? "claude";
  const executor = carrier === "hermes" || carrier === "muse" ? carrier : "claude_mcp";
  const results: PushJobResult[] = [];
  const names = await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true, name: true } });
  const landed = new Set<string>();
  for (const j of input.jobs) {
    try {
      const refusal = refuseIfPrivate(...texts(j));
      if (refusal) throw new RunRefused(refusal);
      if (j.schedule && !isValidCron(j.schedule)) throw new RunRefused("schedule: لازم cron من 5 خانات");
      if (j.branches?.some((b) => b.id === "start")) throw new RunRefused("معرّف الفرع «start» محجوز للبداية");
      if (new Set((j.branches ?? []).map((b) => b.id)).size !== (j.branches ?? []).length) throw new RunRefused("معرّف فرع مكرر");
      const existing = await loadJob(j.key);
      const key = existing?.key ?? j.key;
      landed.add(key);
      const redirected = existing && existing.key !== j.key ? { redirected_to: existing.key } : {};
      const mine = existing?.ownerEdited ?? [];
      // a name is one job: another job already has it
      if (!existing || (j.name !== existing.name && !mine.includes("name"))) {
        const clash = findNameClash(names, j.name, existing?.key);
        if (clash) throw new RunRefused(`في مهمة بنفس الاسم «${clash.name}» — مفتاحها ${clash.key}. استعمل نفس المفتاح بدل ما تعمل مهمة جديدة`);
      }
      const wanted = {
        name: j.name,
        domain: j.domain,
        kind: j.kind,
        ...(j.schedule !== undefined ? { schedule: j.schedule } : {}),
        ...(j.schedule_text !== undefined ? { scheduleText: j.schedule_text } : {}),
        ...(j.runs_at ? { runsAt: new Date(j.runs_at) } : {}),
        ...(j.ends_at ? { endsAt: new Date(j.ends_at) } : {}),
        ...(j.runs_from !== undefined ? { runsFrom: j.runs_from } : {}),
        ...(j.origin !== undefined ? { origin: j.origin } : {}),
        ...(j.touches ? { touches: j.touches } : {}),
        ...(j.talks_to ? { talksTo: j.talks_to } : {}),
        ...(j.description !== undefined ? { description: j.description } : {}),
        ...(j.note !== undefined ? { note: j.note } : {}),
        ...(j.advice ? { advice: j.advice } : {}),
        ...(j.advice_text !== undefined ? { adviceText: j.advice_text } : {}),
      };
      const { data: fields, kept } = withoutOwnerEdited(wanted, mine);
      // finished: true closes it (once); finished: false opens it again; saying nothing leaves it as it is
      const finishing = j.finished === true ? { finishedAt: existing?.finishedAt ?? now } : j.finished === false ? { finishedAt: null } : {};

      if (!existing) {
        const graph = drawing(j);
        const row = await withNumberLock(async (tx) => {
          const number = j.number !== undefined && !(await numberTaken(j.number, null, tx)) ? j.number : await nextJobNumber(tx);
          const made = await tx.workflow.create({ data: { key: j.key, name: j.name, executor, dataSource: "mcp", permission: "green", enabled: true, source: "mcp", graph: json(graph), assigneeKey: carrier, ...(fields as object), ...finishing, number } });
          await tx.workflowVersion.create({ data: { workflowId: made.id, version: 1, graph: json(graph), note: "من خريطة Claude", createdBy: actor.id ?? actor.type } });
          return made;
        });
        names.push({ key: row.key, name: row.name });
        await audit(actor, "workflow.push_jobs", { type: "workflow", id: row.id }, { after: { key: row.key, created: true, number: row.number } });
        results.push({ key: row.key, ok: true, created: true, enabled: row.enabled, number: row.number, decision: row.decision, branches: (j.branches ?? []).map((b) => ({ id: b.id, enabled: b.enabled !== false })) });
        continue;
      }

      // when the time of a job changes, what was expected of it before is not counted against it (the watchdog counts from this moment)
      const timeMoved = ("schedule" in fields && fields.schedule !== existing.schedule) || ("runsAt" in fields && (fields.runsAt as Date).getTime() !== existing.runsAt?.getTime()) || ("kind" in fields && fields.kind !== existing.kind);
      const row = await withNumberLock(async (tx) => {
        const number = existing.number !== null ? existing.number : j.number !== undefined && !(await numberTaken(j.number, existing.key, tx)) ? j.number : await nextJobNumber(tx);
        return tx.workflow.update({ where: { key: existing.key }, data: { ...(fields as object), ...finishing, number, ...(timeMoved ? { scheduleChangedAt: now } : {}) } });
      });
      let graph = GraphSchema.safeParse(existing.graph).success ? (GraphSchema.parse(existing.graph) as WfGraph) : null;
      let gone: string[] = [];
      if (graph && j.branches?.length) {
        const merged = mergeBranches(graph, j.branches);
        gone = merged.gone;
        if (merged.graph) {
          const laid = ensureLayout(merged.graph);
          await updateWorkflow(existing.key, { graph: laid, note: gone.length ? `من خريطة Claude — غابت: ${gone.join("، ")}` : "من خريطة Claude" }, actor);
          graph = laid;
        }
      }
      await audit(actor, "workflow.push_jobs", { type: "workflow", id: row.id }, { after: { key: row.key, created: false, number: row.number, ...(kept.length ? { kept } : {}) } });
      const states = (graph?.nodes ?? []).filter((n) => n.type !== "trigger").map((n) => ({ id: n.id, enabled: !n.disabled }));
      results.push({
        key: row.key,
        ok: true,
        created: false,
        enabled: row.enabled,
        number: row.number,
        decision: row.decision,
        branches: j.branches ? states.filter((s) => j.branches!.some((b) => b.id === s.id)) : states,
        ...redirected,
        ...(gone.length ? { gone_steps: gone } : {}),
        ...(kept.length ? { kept_yours: kept } : {}),
      });
    } catch (e) {
      if (e instanceof RunRefused) results.push({ key: j.key, ok: false, error: e.message });
      else throw e;
    }
  }
  const finished: string[] = [];
  if (input.replace) {
    const gone = await db.workflow.findMany({ where: { source: "mcp", archivedAt: null, finishedAt: null, mergedInto: null, key: { notIn: [...landed] } }, select: { id: true, key: true } });
    for (const g of gone) {
      await db.workflow.update({ where: { id: g.id }, data: { finishedAt: now } });
      finished.push(g.key);
    }
    if (finished.length) await audit(actor, "workflow.push_jobs", { type: "workflow", id: "map" }, { after: { replaced: finished } });
  }
  return { jobs: results, finished };
}

// ───────────────────────────── the decision sheet ─────────────────────────────

export const DecisionsInput = z
  .object({
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(60),
            decision: z.enum(JOB_DECISIONS),
            /** branches by id: false switches that branch off, true leaves it on */
            branches: z.record(z.string(), z.boolean()).optional(),
            /** for «ادمجها»: the number of the job it joins */
            mergeInto: z.number().int().min(1).max(999).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();
export type DecisionsInputT = z.infer<typeof DecisionsInput>;

export interface DecisionsResult {
  applied: number;
  cancelled: string[];
  merged: string[];
  kept: string[];
  branchesOff: { key: string; branch: string }[];
  handoffId: string | null;
}

/**
 * The owner's decision sheet, in ONE transaction: «ألغيها» switches the job off (a one-off is finished too), «خلّيها» records the decision
 * (the advice goes away), «ادمجها» switches it off with a note, and a branch marked false is switched off with a new drawing version.
 * Then ONE handoff to Claude, titled with the numbers («ألغي 7 · 8 · الفرع 11.3 — ادمج 2 · 3 بـ 1»), so it takes them off its own schedule.
 */
export async function applyDecisions(input: DecisionsInputT, actor: Actor, now = new Date()): Promise<DecisionsResult> {
  const keys = input.items.map((i) => i.key);
  const rows = await db.workflow.findMany({ where: { key: { in: keys }, archivedAt: null } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const unknown = keys.filter((k) => !byKey.has(k));
  if (unknown.length) throw new RunRefused(`مهمة مش موجودة: ${unknown.join("، ")}`);
  const res: DecisionsResult = { applied: 0, cancelled: [], merged: [], kept: [], branchesOff: [], handoffId: null };
  const graphUpdates: { key: string; graph: WfGraph }[] = [];

  await db.$transaction(async (tx) => {
    for (const it of input.items) {
      const row = byKey.get(it.key)!;
      const number = row.number;
      if (it.decision === "cancel") {
        await tx.workflow.update({ where: { id: row.id }, data: { enabled: false, decision: "cancel", decidedAt: now, ...(row.kind === "once" ? { finishedAt: row.finishedAt ?? now } : {}) } });
        res.cancelled.push(number ? String(number) : row.key);
      } else if (it.decision === "merge") {
        const into = it.mergeInto ? ` لـ ${it.mergeInto}` : "";
        await tx.workflow.update({ where: { id: row.id }, data: { enabled: false, decision: "merge", decidedAt: now, note: `انضمّت${into}` } });
        res.merged.push(`${number ?? row.key}${it.mergeInto ? `>${it.mergeInto}` : ""}`);
      } else {
        await tx.workflow.update({ where: { id: row.id }, data: { decision: "keep", decidedAt: now } });
        res.kept.push(number ? String(number) : row.key);
      }
      await tx.auditLog.create({ data: { actorType: actor.type, actorId: actor.id ?? null, action: "work.decision", targetType: "workflow", targetId: row.id, after: json({ key: row.key, number, decision: it.decision }) } });
      res.applied++;
      if (it.branches) {
        const g = GraphSchema.safeParse(row.graph);
        if (g.success) {
          const off = Object.entries(it.branches).filter(([, on]) => on === false).map(([id]) => id).filter((id) => g.data.nodes.some((n) => n.id === id && !n.disabled));
          if (off.length) {
            graphUpdates.push({ key: row.key, graph: { ...g.data, nodes: g.data.nodes.map((n) => (off.includes(n.id) ? { ...n, disabled: true } : n)) } });
            for (const id of off) res.branchesOff.push({ key: row.key, branch: id });
          }
        }
      }
    }
  });
  // a new drawing version per job (the same saving the drawing board uses)
  for (const u of graphUpdates) await updateWorkflow(u.key, { graph: u.graph, note: "من ورقة القرار" }, actor);

  // ONE handoff for Claude, in numbers
  const numberOf = new Map(rows.map((r) => [r.key, r.number]));
  const branchNum = res.branchesOff.map((b) => {
    const row = byKey.get(b.key)!;
    const g = GraphSchema.safeParse(row.graph);
    const order = g.success ? g.data.nodes.filter((n) => n.type !== "trigger").map((n) => n.id) : [];
    const idx = order.indexOf(b.branch);
    return numberOf.get(b.key) && idx >= 0 ? `${numberOf.get(b.key)}.${idx + 1}` : `${b.key}/${b.branch}`;
  });
  const parts = [res.cancelled.length ? `ألغي ${res.cancelled.join(" · ")}` : "", branchNum.length ? `الفرع ${branchNum.join(" · ")}` : "", res.merged.length ? `ادمج ${res.merged.join(" · ").replace(/>/g, " بـ ")}` : ""].filter(Boolean);
  if (parts.length) {
    const first = byKey.get(input.items.find((i) => i.decision !== "keep")?.key ?? input.items[0]!.key)!;
    const h = await createHandoff({ workflow: first.key, kind: "needs_input", title: `ورقة القرار: ${parts.join(" — ")}`.slice(0, 160), need: "شيلها من جدولتك قبل موعدها — الموقع طفّاها", assignee: "claude" }, actor);
    res.handoffId = h.handoff.id;
  }
  return res;
}

