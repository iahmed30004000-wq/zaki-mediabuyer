/**
 * WHOSE TASKS A PERSON MAY TOUCH — the one rule behind every route that changes a task by its id (v6 · P3, S-19). A role that looks after its own tasks (or its team's)
 * holds `tasks.manage` or `tasks.own`; the capability says WHAT it may do, this says to WHOM. `keys` are the assignee keys of the person's scope
 * (`taskKeysFor`: `null` = everybody's). A task with no assignee belongs to nobody's scope, so a scoped person cannot touch it. Pure.
 */

export interface TaskOwnerRow {
  id: string;
  assignee: string | null;
}

/** The ids that are NOT in the scope: a task that does not exist, one with nobody on it, or one of somebody outside `keys`. Everything is in scope when `keys` is null. */
export function tasksOutOfScope(ids: readonly string[], rows: readonly TaskOwnerRow[], keys: readonly string[] | null): string[] {
  if (keys === null) return [];
  const owner = new Map(rows.map((r) => [r.id, r.assignee]));
  return [...new Set(ids)].filter((id) => {
    const a = owner.get(id);
    return !a || !keys.includes(a);
  });
}

/** The sentence for the person who asked for a task that is not theirs. */
export const OUT_OF_SCOPE_SENTENCE = "هاي مهمة مش مهمتك";
