/**
 * TASKS (v3 · E, v4 · A `list_tasks` / `update_task`): one place for «what waits for whom» — a person, an agent, Claude.
 * Archived, never deleted. The same validators serve the site and the MCP tools, and no task may carry a customer's
 * number or a key (the privacy filter reads every text).
 */
import { z } from "zod";
import type { Task } from "@prisma/client";
import { refuseIfPrivate } from "@/core/push-rows";
import { parseQuickAdd } from "@/core/tasks";
import { db } from "./db";
import { audit, type Actor } from "./audit";
import { quickAddBoardWords, resolveBoardKey } from "./ui-config";

export const TASK_STATUSES = ["new", "doing", "waiting_approval", "stalled", "done"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const when = z.string().trim().min(8).max(40).describe("وقت ISO أو تاريخ YYYY-MM-DD");

export const TaskCreateInput = z
  .object({
    title: text(200),
    note: text(1000).optional(),
    assignee: text(40).optional().describe("شخص أو وكيل: abdullah · hassan · laith · mohammad · hermes · muse · claude"),
    executor: text(40).optional().describe("claude · hermes · muse · n8n · person · system"),
    due_at: when.optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    board: text(40).optional().describe("main · confirmation · leak · basha · stock …"),
    link_type: text(30).optional().describe("workflow · approval · video · campaign · product"),
    link_id: text(80).optional(),
  })
  .strict();
export type TaskCreateT = z.infer<typeof TaskCreateInput>;

export const TaskUpdateInput = z
  .object({
    id: text(40),
    status: z.enum(TASK_STATUSES).optional(),
    note: text(1000).optional(),
    assignee: text(40).optional(),
    executor: text(40).optional(),
    due_at: when.nullable().optional().describe("null بيشيل الموعد"),
    priority: z.enum(TASK_PRIORITIES).optional(),
    archived: z.boolean().optional().describe("true بيأرشف المهمة (ما بتنحذف)"),
  })
  .strict();
export type TaskUpdateT = z.infer<typeof TaskUpdateInput>;

export interface TaskView {
  id: string;
  title: string;
  note: string | null;
  status: string;
  assignee: string | null;
  executor: string | null;
  dueAt: string | null;
  priority: string;
  board: string;
  linkType: string | null;
  linkId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export const taskView = (t: Task): TaskView => ({
  id: t.id,
  title: t.title,
  note: t.note,
  status: t.status,
  assignee: t.assignee,
  executor: t.executor,
  dueAt: t.dueAt?.toISOString() ?? null,
  priority: t.priority,
  board: t.board,
  linkType: t.linkType,
  linkId: t.linkId,
  source: t.source,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export class TaskRefused extends Error {}

function dueOf(s: string | undefined | null): Date | null | undefined {
  if (s === undefined) return undefined;
  if (s === null) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw new TaskRefused("due_at: وقت مش صحيح");
  return d;
}

export async function listTasks(f: { status?: string[]; assignee?: string; board?: string; limit?: number; includeArchived?: boolean; /** finished tasks only when they finished this recently */ doneWithinDays?: number } = {}, now = new Date()): Promise<TaskView[]> {
  const rows = await db.task.findMany({
    where: {
      ...(f.status?.length ? { status: { in: f.status } } : {}),
      ...(f.assignee ? { assignee: f.assignee } : {}),
      ...(f.board ? { board: f.board } : {}),
      ...(f.includeArchived ? {} : { archivedAt: null }),
      ...(f.doneWithinDays ? { OR: [{ status: { not: "done" } }, { updatedAt: { gte: new Date(now.getTime() - f.doneWithinDays * 86_400_000) } }] } : {}),
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(f.limit ?? 100, 300),
  });
  return rows.map(taskView);
}

export async function createTask(i: TaskCreateT, actor: Actor, source: "ui" | "mcp" | "workflow" | "assistant"): Promise<TaskView> {
  const refusal = refuseIfPrivate(i.title, i.note);
  if (refusal) throw new TaskRefused(refusal);
  // a board that was merged into another is that other: a task made for the old key lands where its tasks went
  const board = await resolveBoardKey(i.board ?? "main");
  const row = await db.task.create({
    data: { title: i.title, note: i.note ?? null, assignee: i.assignee ?? null, executor: i.executor ?? null, dueAt: dueOf(i.due_at) ?? null, priority: i.priority ?? "normal", status: i.status ?? "new", board, linkType: i.link_type ?? null, linkId: i.link_id ?? null, source },
  });
  await audit(actor, "task.create", { type: "task", id: row.id }, { after: { title: row.title, assignee: row.assignee, source } });
  return taskView(row);
}

/** Moves or edits a task. Returns null when there is no such task. */
export async function updateTask(i: TaskUpdateT, actor: Actor): Promise<TaskView | null> {
  const refusal = refuseIfPrivate(i.note);
  if (refusal) throw new TaskRefused(refusal);
  const before = await db.task.findUnique({ where: { id: i.id } });
  if (!before) return null;
  const row = await db.task.update({
    where: { id: i.id },
    data: {
      ...(i.status ? { status: i.status } : {}),
      ...(i.note !== undefined ? { note: i.note } : {}),
      ...(i.assignee ? { assignee: i.assignee } : {}),
      ...(i.executor ? { executor: i.executor } : {}),
      ...(i.priority ? { priority: i.priority } : {}),
      ...(i.due_at !== undefined ? { dueAt: dueOf(i.due_at) } : {}),
      ...(i.archived === undefined ? {} : { archivedAt: i.archived ? new Date() : null }),
    },
  });
  await audit(actor, "task.update", { type: "task", id: row.id }, { before: { status: before.status, assignee: before.assignee, archived: !!before.archivedAt }, after: { status: row.status, assignee: row.assignee, archived: !!row.archivedAt } });
  return taskView(row);
}

// ───────────────────────────── the board (v3 · E) ─────────────────────────────

/** «بكرا لميوز: …» → a task. The board the person is looking at is the default when the line names none. */
export async function quickAddTask(text: string, actor: Actor, opts: { board?: string } = {}, now = new Date()): Promise<TaskView> {
  const q = parseQuickAdd(text, now, await quickAddBoardWords());
  if (!q) throw new TaskRefused("اكتب شو بدك (مثلاً «بكرا لميوز: اعمل 4 هوكات»)");
  return createTask({ title: q.title.slice(0, 200), ...(q.assignee ? { assignee: q.assignee } : {}), ...(q.due_at ? { due_at: q.due_at } : {}), ...(q.priority ? { priority: q.priority } : {}), board: q.board ?? opts.board ?? "main" }, actor, "ui");
}

export const TaskBulkInput = z
  .object({
    ids: z.array(text(40)).min(1).max(100),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: text(40).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    board: text(40).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((i) => i.status || i.assignee || i.priority || i.board || i.archived !== undefined, "ولا تغيير مطلوب");
export type TaskBulkT = z.infer<typeof TaskBulkInput>;

/** The same change on many tasks at once (up to a hundred). Archiving is the only «removal»: nothing is deleted. */
export async function bulkUpdateTasks(i: TaskBulkT, actor: Actor): Promise<{ updated: number }> {
  const r = await db.task.updateMany({
    where: { id: { in: i.ids } },
    data: { ...(i.status ? { status: i.status } : {}), ...(i.assignee ? { assignee: i.assignee } : {}), ...(i.priority ? { priority: i.priority } : {}), ...(i.board ? { board: await resolveBoardKey(i.board) } : {}), ...(i.archived === undefined ? {} : { archivedAt: i.archived ? new Date() : null }) },
  });
  await audit(actor, "task.bulk_update", { type: "task", id: String(i.ids.length) }, { after: { ids: i.ids.slice(0, 20), status: i.status, assignee: i.assignee, priority: i.priority, board: i.board, archived: i.archived, updated: r.count } });
  return { updated: r.count };
}

const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/**
 * Two cards that are the same job become one: the kept one takes the notes of the others, the most urgent priority and the
 * earliest date; the others are archived with a note saying where they went. Nothing is lost and nothing is deleted.
 */
export async function mergeTasks(keepId: string, dropIds: string[], actor: Actor): Promise<TaskView> {
  const keep = await db.task.findUnique({ where: { id: keepId } });
  if (!keep) throw new TaskRefused("المهمة مش موجودة");
  const drops = await db.task.findMany({ where: { id: { in: dropIds.filter((id) => id !== keepId) } } });
  if (!drops.length) throw new TaskRefused("ما في شي لدمجه");
  const all = [keep, ...drops];
  const notes = [...new Set(all.map((t) => t.note).filter((n): n is string => !!n))];
  const priority = all.reduce((best, t) => ((PRIORITY_RANK[t.priority] ?? 1) > (PRIORITY_RANK[best] ?? 1) ? t.priority : best), keep.priority);
  const due = all.map((t) => t.dueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const [kept] = await db.$transaction([
    db.task.update({ where: { id: keep.id }, data: { note: notes.length ? notes.join("\n— ").slice(0, 1000) : null, priority, dueAt: due } }),
    ...drops.map((d) => db.task.update({ where: { id: d.id }, data: { archivedAt: new Date(), note: `مكرّرة — انضمّت لـ «${keep.title.slice(0, 120)}»` } })),
  ]);
  await audit(actor, "task.merge", { type: "task", id: keep.id }, { after: { kept: keep.id, merged: drops.map((d) => d.id) } });
  return taskView(kept);
}
