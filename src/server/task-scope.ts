/**
 * The routes that change several tasks by id (bulk · merge · the values of a card) check the caller's scope before they touch anything (v6 · P3, S-19):
 * a team lead who holds `tasks.manage` may change the tasks of their own team, never another team's. The rule is `core/task-scope.ts`.
 */
import { OUT_OF_SCOPE_SENTENCE, tasksOutOfScope } from "@/core/task-scope";
import { HttpError, type Caller } from "./auth";
import { db } from "./db";
import { taskKeysFor } from "./directory";

/** Throws 403 when any of the tasks is outside the caller's scope (everything is in scope for a role that sees all). Nothing has been written by then. */
export async function assertTasksInScope(caller: Caller, ids: readonly string[]): Promise<void> {
  const keys = await taskKeysFor(caller);
  if (keys === null || !ids.length) return;
  const rows = await db.task.findMany({ where: { id: { in: [...ids] } }, select: { id: true, assignee: true } });
  if (tasksOutOfScope(ids, rows, keys).length) throw new HttpError(403, OUT_OF_SCOPE_SENTENCE);
}
