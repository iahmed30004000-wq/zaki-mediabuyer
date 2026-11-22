/**
 * MAKING A JOB FROM A DRAFT (v6 · P4-1, docs/rebuild-v6/02-screens.md §3.7 «الحفظ»): `validateDraft` → `draftToJob` → a `Workflow` with the next number and `source: "ui"`, its first version,
 * and — for «هلق» — the request that makes it run now, asked the way the clock's own would be. A one-time job for a person is a task on the team's board instead. Nothing here
 * touches Meta and nothing is spent: a job is a description of work, and everything that changes Meta stays a change that waits for the owner.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { queueAssignee } from "@/core/handoff";
import { PERSON_REPEAT_REFUSAL, draftToJob, draftToTask, isPersonRepeat, isPersonTask, normalizeDraft, validateDraft, type JobDraft } from "@/core/job-draft";
import { findNameClash } from "@/core/job-map";
import { refuseIfPrivate } from "@/core/push-rows";
import { slotRef } from "@/core/slot-for";
import { ensureLayout } from "@/core/workflow-edit";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { loadDirectory } from "./directory";
import { HandoffRefused, createHandoff } from "./handoffs";
import { nextJobNumber, withNumberLock } from "./job-map";
import { createTask } from "./tasks";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Why a draft was not saved, in the owner's words, with the field it is about (the screen puts the sentence there). */
export class DraftRefused extends Error {
  constructor(message: string, public status = 400, public field?: string) {
    super(message);
  }
}

/**
 * The site's own recipes (docs/rebuild-v6/01-model.md §9) are built in P4-2. Until then a draft that wants one is refused plainly: a job the site «carries out itself» that nothing
 * carries out would only be a job that never runs.
 */
export const RECIPES_BUILT = false;

export type CreatedJob =
  | {
      kind: "job";
      key: string;
      number: number | null;
      name: string;
      href: string;
      /** «هلق»: did the request to run it go out? (false: the job is saved; the button on its page asks again) */
      asked: boolean | null;
    }
  | { kind: "task"; id: string; title: string; href: string };

/**
 * Saves a draft. Throws `DraftRefused` for anything the owner can fix (a time in the past, a name that is already a job, a person who is not in the directory). The number
 * is the next free one, given under the numbering lock; the job is made switched on, with the site as its clock (`wake = site`).
 */
export async function createJobFromDraft(draft: JobDraft, actor: Actor, now = new Date()): Promise<CreatedJob> {
  const d = normalizeDraft(draft);
  const check = validateDraft(d, now);
  if (!check.ok) throw new DraftRefused(check.message, 400, check.field);
  if (d.recipe && !RECIPES_BUILT) throw new DraftRefused("وصفات الموقع لسا ما انبنت — اختار حدا من الفريق يعملها", 400, "recipe");
  const private_ = refuseIfPrivate(d.name, ...d.steps.map((s) => s.text));
  if (private_) throw new DraftRefused(private_, 400, "steps");

  const who = (await loadDirectory()).find((e) => e.key === d.assigneeKey && e.active);
  if (!who) throw new DraftRefused("هالشخص أو الوكيل مش بدليل الفريق", 400, "assigneeKey");

  // a repeating job for a person would never be answered (a person cannot log a run): it is refused, not saved to be marked missed at every slot
  if (isPersonRepeat(d, who.kind)) throw new DraftRefused(PERSON_REPEAT_REFUSAL, 400, "assigneeKey");

  // a one-time job for a person is a task on the team's board, with its time
  if (isPersonTask(d, who.kind)) {
    const t = draftToTask(d, now);
    const task = await createTask({ title: t.title, ...(t.note ? { note: t.note } : {}), assignee: t.assignee, executor: "person", due_at: t.dueAt.toISOString() }, actor, "ui");
    return { kind: "task", id: task.id, title: task.title, href: "/tasks/team" };
  }

  // a name is one job (the map's own rule): the owner is told which one has it
  const names = await db.workflow.findMany({ where: { archivedAt: null, mergedInto: null }, select: { key: true, name: true } });
  const clash = findNameClash(names, d.name);
  if (clash) throw new DraftRefused(`في مهمة بنفس الاسم («${clash.name}») — غيّر الاسم، أو عدّل المهمة اللي موجودة`, 409, "name");

  const spec = draftToJob(d, now, { kind: who.kind });
  let key = "";
  for (let i = 0; i < 10; i++) {
    key = `wf-${randomBytes(4).toString("hex").slice(0, 6)}`;
    if (!(await db.workflow.findUnique({ where: { key } }))) break;
  }
  const graph = ensureLayout(spec.graph);
  const row = await withNumberLock(async (tx) =>
    tx.workflow.create({
      data: {
        key,
        name: spec.name,
        description: spec.description,
        schedule: spec.schedule,
        scheduleText: spec.scheduleText,
        kind: spec.kind,
        runsAt: spec.runsAt,
        endsAt: spec.endsAt,
        domain: spec.domain,
        executor: spec.executor,
        assigneeKey: spec.assigneeKey,
        dataSource: "mcp",
        permission: spec.permission,
        graph: json(graph),
        wake: spec.wake,
        notifyOn: spec.notifyOn,
        source: "ui",
        // what the owner wrote here is his: a push of the agent's map does not write over it
        ownerEdited: OWNER_FIELDS_WRITTEN,
        scheduleChangedAt: now,
        number: await nextJobNumber(tx),
      },
    }),
  );
  await db.workflowVersion.create({ data: { workflowId: row.id, version: 1, graph: json(graph), note: "من «مهمة جديدة»", createdBy: actor.id ?? actor.type } });
  await audit(actor, "workflow.create", { type: "workflow", id: row.id }, { after: { key, name: spec.name, from: "builder", kind: spec.kind, assignee: spec.assigneeKey } });

  let asked: boolean | null = null;
  if (spec.runNow && spec.runsAt) {
    // «هلق»: exactly the request the clock would make for this moment (the slot's own reference), so the run answers the slot and the one-off finishes when it is done
    try {
      await createHandoff({ workflow: key, kind: "manual_run", title: `شغّل «${spec.name}» هلق`.slice(0, 160), run_ref: slotRef(spec.runsAt), assignee: queueAssignee(spec.assigneeKey) }, actor, now, { scheduledFor: spec.runsAt, trigger: "schedule" });
      asked = true;
    } catch (e) {
      if (!(e instanceof HandoffRefused)) throw e;
      asked = false;
    }
  }
  return { kind: "job", key, number: row.number, name: row.name, href: `/tasks/${key}`, asked };
}

/** The columns the builder writes: they are the owner's from the first save (`Workflow.ownerEdited`), so a push of the agent's map never writes over them. */
const OWNER_FIELDS_WRITTEN = ["domain", "endsAt", "kind", "name", "runsAt", "schedule", "scheduleText"];
