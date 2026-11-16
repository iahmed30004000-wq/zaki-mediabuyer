/**
 * «بانتظارك», the server side: reads the tables that already exist (ChangeSet, Approval, Handoff — no new table) and turns every open
 * decision into one `InboxItem` (src/core/inbox.ts). The ACTIONS stay on the endpoints that already do them
 * (/api/changes/[id], /api/approvals/[id], /api/handoffs/[id]) — nothing new can spend money.
 */
import { handoffNeedsOwner, fromAdvice, fromApproval, fromOrder, fromChange, fromHandoff, sortInbox, splitItemId, type InboxDomain, type InboxItem } from "@/core/inbox";
import { isDemo } from "@/core/readiness";
import { loadChanges, type ChangeView } from "@/lib/changes-view";
import type { Caller } from "./auth";
import { db } from "./db";
import { listApprovals, type ApprovalView } from "./approvals";
import { listHandoffs } from "./handoffs";
import { closeLapsed } from "./orders";

const demo = () => isDemo(process.env);

function changeIn(c: ChangeView) {
  return { id: c.id, state: c.state, by: c.by, reasonCode: c.reasonCode, sentence: c.sentence, target: c.target, before: c.before, after: c.after, spendDeltaDaily: c.spendDeltaDaily, atIso: c.atIso ?? null, launch: c.launch ?? false, auto: c.auto, live: c.live };
}

const approvalIn = (a: ApprovalView) => a;

/** The jobs whose agent gave advice the owner has not answered (switched off, finished and archived ones are not asked about). */
async function adviceItems(): Promise<InboxItem[]> {
  const rows = await db.workflow.findMany({ where: { advice: { not: null }, decision: null, enabled: true, finishedAt: null, archivedAt: null }, orderBy: { number: "asc" } });
  return rows.map((r) => fromAdvice({ key: r.key, number: r.number, name: r.name, domain: r.domain === "ops" ? "ops" : "ads", advice: r.advice!, adviceText: r.adviceText, runsFrom: r.runsFrom, at: r.updatedAt.toISOString() }));
}

/** The standing orders that wait for the owner: a loosening one not yet approved, and an active one Claude asked to end. */
async function orderItems(): Promise<InboxItem[]> {
  await closeLapsed();
  const rows = await db.standingOrder.findMany({ where: { OR: [{ status: "pending" }, { status: "active", endRequestedAt: { not: null } }] }, orderBy: { createdAt: "desc" } });
  return rows.map((o) => fromOrder({ id: o.id, text: o.text, domain: o.domain, pending: o.status === "pending", endRequested: !!o.endRequestedAt, source: o.source, createdAt: (o.endRequestedAt ?? o.createdAt).toISOString() }));
}

/** Every open decision, in the order it should be read. `caller` is for the permission filter P10 adds; today the owner sees everything. */
export async function loadInbox(_caller: Caller, opts: { limit?: number; domain?: InboxDomain } = {}): Promise<InboxItem[]> {
  const [changes, approvals, handoffs, advice, orders] = await Promise.all([
    loadChanges(),
    demo() ? Promise.resolve([]) : listApprovals({ status: ["pending"] }),
    demo() ? Promise.resolve([]) : listHandoffs({ status: ["open", "claimed"] }),
    demo() ? Promise.resolve([]) : adviceItems(),
    demo() ? Promise.resolve([]) : orderItems(),
  ]);
  const items = [
    ...changes.filter((c) => c.state === "pending_approval").map((c) => fromChange(changeIn(c))),
    ...approvals.map((a) => fromApproval(approvalIn(a))),
    ...handoffs.filter(handoffNeedsOwner).map((h) => fromHandoff(h)),
    ...advice,
    ...orders,
  ];
  const sorted = sortInbox(opts.domain ? items.filter((i) => i.domain === opts.domain) : items);
  return opts.limit ? sorted.slice(0, opts.limit) : sorted;
}

/** What the owner put off, and when it comes back. */
export async function loadInboxLater(_caller: Caller): Promise<InboxItem[]> {
  if (demo()) return [];
  const rows = await listApprovals({ status: ["postponed"] });
  return rows.map((a) => fromApproval(approvalIn(a))).sort((a, b) => (a.postponedUntil ?? "").localeCompare(b.postponedUntil ?? ""));
}

export interface DoneItem {
  id: string;
  title: string;
  /** what happened: «وافقت» · «رفضت» · «تنفّذ» · «انرجع» · «فشل» · «انتهى وقته» */
  outcome: string;
  tone: "ok" | "neutral" | "danger";
  /** who decided: «إنت» · «قاعدة الخاسر» · «Claude» … */
  by: string;
  at: string;
  /** decided by a rule on its own (the safety net), not by the owner */
  auto: boolean;
  /** a change that ran and can be reverted */
  canRollback: boolean;
  href: string;
}

const OUTCOME: Record<string, { text: string; tone: DoneItem["tone"] }> = {
  approved: { text: "وافقت", tone: "ok" },
  rejected: { text: "رفضت", tone: "neutral" },
  cancelled: { text: "انلغى", tone: "neutral" },
  expired: { text: "انتهى وقته", tone: "neutral" },
  executed: { text: "تنفّذ", tone: "ok" },
  rolled_back: { text: "انرجع", tone: "neutral" },
  failed: { text: "فشل", tone: "danger" },
};

/** The last 30 days of decisions: the owner's answers and what the rules did by themselves. */
export async function loadInboxDone(_caller: Caller, opts: { days?: number; autoOnly?: boolean } = {}): Promise<DoneItem[]> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const [changes, approvals] = await Promise.all([
    loadChanges(),
    demo() ? Promise.resolve([]) : listApprovals({ status: ["approved", "rejected", "cancelled", "expired"], since, limit: 200 }),
  ]);
  const fromChanges: DoneItem[] = changes
    .filter((c) => c.state !== "pending_approval")
    .map((c) => {
      const o = OUTCOME[c.state] ?? { text: c.state, tone: "neutral" as const };
      return { id: `change:${c.id}`, title: c.sentence, outcome: o.text, tone: o.tone, by: c.auto ? c.by : "إنت", at: c.atIso ?? c.at, auto: c.auto, canRollback: c.state === "executed" && c.live, href: `/inbox/${encodeURIComponent(`change:${c.id}`)}` };
    });
  const fromApprovals: DoneItem[] = approvals.map((a) => {
    const o = OUTCOME[a.status] ?? { text: a.status, tone: "neutral" as const };
    return { id: `approval:${a.id}`, title: a.title, outcome: o.text, tone: o.tone, by: a.decidedBy ?? "إنت", at: a.decidedAt ?? a.createdAt, auto: false, canRollback: false, href: `/inbox/${encodeURIComponent(`approval:${a.id}`)}` };
  });
  const all = [...fromChanges, ...fromApprovals].sort((a, b) => b.at.localeCompare(a.at));
  return opts.autoOnly ? all.filter((d) => d.auto) : all;
}

export interface InboxLookup {
  state: "open" | "later" | "done" | "missing";
  item: InboxItem | null;
  /** for a decided one: what happened */
  outcome?: string;
}

/** One item by its id (`approval:…`): open, put off, already decided — or not there. Telegram and the ring screen open this. */
export async function getInboxItem(caller: Caller, id: string): Promise<InboxLookup> {
  const parts = splitItemId(id);
  if (!parts) return { state: "missing", item: null };
  const open = (await loadInbox(caller)).find((i) => i.id === id);
  if (open) return { state: "open", item: open };
  const later = (await loadInboxLater(caller)).find((i) => i.id === id);
  if (later) return { state: "later", item: later };
  if (parts.source === "approval" && !demo()) {
    const [a] = await listApprovals({ ids: [parts.rowId] });
    if (a) return { state: "done", item: fromApproval(approvalIn(a)), outcome: OUTCOME[a.status]?.text ?? a.status };
  }
  if (parts.source === "advice" && !demo()) {
    const done = await db.workflow.findUnique({ where: { key: parts.rowId } });
    if (done && done.decision) return { state: "done", item: fromAdvice({ key: done.key, number: done.number, name: done.name, domain: done.domain === "ops" ? "ops" : "ads", advice: done.advice ?? "keep", adviceText: done.adviceText, runsFrom: done.runsFrom, at: done.updatedAt.toISOString() }), outcome: done.decision === "cancel" ? "ألغيتها" : done.decision === "merge" ? "دمجتها" : "خلّيتها" };
  }
  if (parts.source === "change") {
    const c = (await loadChanges()).find((x) => x.id === parts.rowId);
    if (c) return { state: "done", item: fromChange(changeIn(c)), outcome: OUTCOME[c.state]?.text ?? c.state };
  }
  return { state: "missing", item: null };
}

/** The red number beside «بانتظارك»: cheap (counts, no rows), the same conditions as `loadInbox`. */
export async function countInbox(): Promise<number> {
  try {
    if (demo()) return (await loadChanges()).filter((c) => c.state === "pending_approval").length;
    const [changes, asks, handoffs, advice, orders] = await Promise.all([
      db.changeSet.count({ where: { state: { in: ["pending_approval", "simulated"] } } }),
      db.approval.count({ where: { status: "pending" } }),
      listHandoffs({ status: ["open", "claimed"], limit: 200 }),
      db.workflow.count({ where: { advice: { not: null }, decision: null, enabled: true, finishedAt: null, archivedAt: null } }),
      db.standingOrder.count({ where: { OR: [{ status: "pending" }, { status: "active", endRequestedAt: { not: null } }] } }),
    ]);
    return changes + asks + handoffs.filter(handoffNeedsOwner).length + advice + orders;
  } catch {
    // a database that does not answer must not break every page: no number is shown
    return 0;
  }
}
