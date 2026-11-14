/**
 * TASKS (v3 · E, v4 · A `list_tasks` / `update_task`): one place for «what waits for whom» — a person, an agent, Claude.
 * Archived, never deleted. The same validators serve the site and the MCP tools, and no task may carry a customer's
 * number or a key (the privacy filter reads every text).
 */
import { z } from "zod";
import type { Task } from "@prisma/client";
import { refuseIfPrivate } from "@/core/push-rows";
import { db } from "./db";
import { audit, type Actor } from "./audit";

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

export async function listTasks(f: { status?: string[]; assignee?: string; board?: string; limit?: number; includeArchived?: boolean } = {}): Promise<TaskView[]> {
  const rows = await db.task.findMany({
    where: { ...(f.status?.length ? { status: { in: f.status } } : {}), ...(f.assignee ? { assignee: f.assignee } : {}), ...(f.board ? { board: f.board } : {}), ...(f.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(f.limit ?? 100, 300),
  });
  return rows.map(taskView);
}

export async function createTask(i: TaskCreateT, actor: Actor, source: "ui" | "mcp" | "workflow" | "assistant"): Promise<TaskView> {
  const refusal = refuseIfPrivate(i.title, i.note);
  if (refusal) throw new TaskRefused(refusal);
  const row = await db.task.create({
    data: { title: i.title, note: i.note ?? null, assignee: i.assignee ?? null, executor: i.executor ?? null, dueAt: dueOf(i.due_at) ?? null, priority: i.priority ?? "normal", status: i.status ?? "new", board: i.board ?? "main", linkType: i.link_type ?? null, linkId: i.link_id ?? null, source },
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
