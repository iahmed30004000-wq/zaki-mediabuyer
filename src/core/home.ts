/**
 * THE HOME, AS DECISIONS (v6 · P5, docs/rebuild-v6/02-screens.md §2) — pure. Which sections a role is given, where «كل الأرقام» leads it, and what goes into the first section
 * («بدّها منك»): the decisions that wait, the runs that stopped or were missed, and the alerts that ask something of him — in that order, the first three shown and the rest counted.
 * Nothing here reads a table or a clock.
 */
import { canOpenPath, can, type RoleKey } from "./roles";

export interface HomePlan {
  /** the decisions of the areas this role may look at (`inbox.view`) */
  decisions: boolean;
  /** the screens of «المهام»: the stopped and missed runs, the live ones, who is working, what comes today and the last results */
  tasks: boolean;
  /** the numbers of «وين كنا وكيف صرنا» (every role that has a home reads the ads' own numbers; the money ones are stripped on the server) */
  numbers: boolean;
  /** where «كل الأرقام» leads this role: the numbers summary (`/numbers`), or the ads when the role has no numbers place; null: nowhere it may open */
  numbersHref: string | null;
}

/** The sections of the home a role is given. */
export function homePlan(role: RoleKey): HomePlan {
  const href = ["/numbers", "/ads"].find((h) => canOpenPath(role, h)) ?? null;
  return { decisions: can(role, "inbox.view"), tasks: canOpenPath(role, "/tasks"), numbers: true, numbersHref: href };
}

/** An alert that asks something of him: red and orange ones; an informational one is only told, in a quiet line, and is not counted. */
export const asksSomething = (a: { tone: "danger" | "warn" | "info" }): boolean => a.tone === "danger" || a.tone === "warn";

/** A red alert is never pushed off the screen by the cap: it is always shown. */
export const isUrgent = (a: { tone: "danger" | "warn" | "info" }): boolean => a.tone === "danger";

export type NeedItem<D, S, A> = { kind: "decision"; item: D } | { kind: "stuck"; item: S } | { kind: "alert"; item: A };

export interface NeedsOut<D, S, A> {
  /** everything that waits for him: the number beside the title */
  total: number;
  /** the first `limit`, decisions first, then the runs, then the alerts */
  shown: NeedItem<D, S, A>[];
  /** how many of each kind there are in all, and how many were left out of `shown` */
  counts: { decisions: number; stuck: number; alerts: number };
  left: { decisions: number; stuck: number; alerts: number };
  /** the orange alerts that did not fit in `shown`: the page lists them behind «كل التنبيهات», it never hides them */
  leftAlerts: A[];
}

/** How many items the first section shows before the links («كل القرارات» · «كل اللي واقف»). */
export const NEEDS_SHOWN = 3;

/**
 * What waits for him, in one list. A decision comes before a stopped run, and a stopped run before an alert: a decision is the thing only he can do, a stopped run is something
 * somebody must unblock, an alert is a sentence. `alerts` are the orange ones that ask something of him, counted under the cap with the rest; `urgent` are the red ones, which the cap never
 * cuts: they all come after the capped items. The informational ones are not passed in.
 */
export function needsOf<D, S, A>(input: { decisions: readonly D[]; stuck: readonly S[]; alerts: readonly A[]; urgent?: readonly A[] }, limit = NEEDS_SHOWN): NeedsOut<D, S, A> {
  const urgent = input.urgent ?? [];
  const capped: NeedItem<D, S, A>[] = [
    ...input.decisions.map((item) => ({ kind: "decision" as const, item })),
    ...input.stuck.map((item) => ({ kind: "stuck" as const, item })),
    ...input.alerts.map((item) => ({ kind: "alert" as const, item })),
  ];
  const cut = capped.slice(0, Math.max(0, limit));
  const shown: NeedItem<D, S, A>[] = [...cut, ...urgent.map((item) => ({ kind: "alert" as const, item }))];
  const shownOf = (k: NeedItem<D, S, A>["kind"]) => cut.filter((i) => i.kind === k).length;
  const counts = { decisions: input.decisions.length, stuck: input.stuck.length, alerts: input.alerts.length + urgent.length };
  return {
    total: capped.length + urgent.length,
    shown,
    counts,
    left: { decisions: counts.decisions - shownOf("decision"), stuck: counts.stuck - shownOf("stuck"), alerts: input.alerts.length - shownOf("alert") },
    leftAlerts: input.alerts.slice(shownOf("alert")),
  };
}
