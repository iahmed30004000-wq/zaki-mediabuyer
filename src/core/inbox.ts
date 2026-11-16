/**
 * «بانتظارك»: ONE shape for every decision that waits for the owner (docs/rebuild/04-work.md §6). Pure: the sources (a Meta change, a
 * request from Claude, a handoff nobody can finish) are turned into the same `InboxItem`, sorted one way, counted one way — so the
 * card, the list, the red number in the menu and the Telegram link can never disagree. No database here: src/server/inbox.ts reads
 * the tables and calls these.
 */

export const INBOX_KINDS = ["spend", "safety_net", "launch", "message", "order", "advice", "stuck", "creative", "stock", "other"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export type InboxDomain = "ads" | "ops" | "work";
export type InboxUrgency = "red" | "orange" | "yellow";

export type InboxActionKey = "approve" | "reject" | "later" | "send" | "edit" | "keep" | "cancel" | "retry" | "reassign" | "open" | "complete" | "merge";

export interface InboxAction {
  key: InboxActionKey;
  /** One or two words with a verb: «وافق» · «ارفض» · «أجّل». */
  label: string;
  variant: "primary" | "secondary" | "ghost";
  /** Asks «متأكد؟» first. */
  confirm?: boolean;
  /** The capability the person needs (docs/rebuild/05-permissions.md). */
  capability: string;
}

export interface InboxItem {
  /** `<source>:<rowId>` — «change:ck…» · «approval:ck…» · «handoff:ck…». */
  id: string;
  kind: InboxKind;
  domain: InboxDomain;
  /** One sentence. */
  title: string;
  why: string | null;
  effect: { moneyDeltaDaily?: number | null; moneyAfter?: number | null; people?: string[]; text?: string } | null;
  /** The message text, or the summary of the test. */
  preview?: string;
  from: { label: string; jobKey?: string } | null;
  /** ISO time it was raised. */
  at: string;
  urgency: InboxUrgency;
  /** ISO time it runs out, or null. */
  expiresAt: string | null;
  /** From 1 to 3; the first is the primary one. */
  actions: InboxAction[];
  /** Numbers shown on the card as label · value (from the request itself). */
  numbers?: { label: string; value: string }[];
  /** A postponed item and when it comes back (ISO). */
  postponedUntil?: string | null;
  /** A demo item (MOCK_MODE): pressing a button changes nothing. */
  demo?: boolean;
}

export type InboxSource = "change" | "approval" | "handoff" | "advice";

export const itemId = (source: InboxSource, rowId: string): string => `${source}:${rowId}`;
export function splitItemId(id: string): { source: InboxSource; rowId: string } | null {
  const m = /^(change|approval|handoff|advice):(.+)$/.exec(id);
  return m ? { source: m[1] as InboxSource, rowId: m[2]! } : null;
}

// ── the three sources, as they come from the loaders (structural: no server imports) ──

export interface ChangeIn {
  id: string;
  state: string;
  by: string;
  reasonCode: string;
  sentence: string;
  target: string;
  before: string;
  after: string;
  spendDeltaDaily: number;
  /** ISO time (the card shows its own readable one). */
  atIso?: string | null;
  /** «حملة جديدة»: a launch. */
  launch?: boolean;
  /** raised by the safety net / a rule, not by a person or an agent */
  auto?: boolean;
  /** false for the demo list */
  live?: boolean;
}

export interface ApprovalIn {
  id: string;
  title: string;
  why: string;
  numbers: { label: string; value: string }[];
  options: { key: string; label: string }[];
  amount: number | null;
  urgency: InboxUrgency;
  kind: string | null;
  source: string;
  workflowKey: string | null;
  expiresAt: string | null;
  postponedUntil: string | null;
  createdAt: string;
  /** what the agent sent with the request; for a message, `text` is what would be sent */
  analysis?: { text?: string; [k: string]: unknown } | null;
}

export interface HandoffIn {
  id: string;
  workflowKey: string;
  workflowName: string | null;
  kind: string;
  title: string;
  assignee: string;
  createdAt: string;
  waitingMin: number;
  context: { need?: string; lastError?: string };
}

const A = {
  approve: (label = "وافق"): InboxAction => ({ key: "approve", label, variant: "primary", capability: "inbox.decide" }),
  reject: (label = "ارفض"): InboxAction => ({ key: "reject", label, variant: "secondary", capability: "inbox.decide" }),
  later: (): InboxAction => ({ key: "later", label: "أجّل", variant: "ghost", capability: "inbox.decide" }),
  open: (label: string): InboxAction => ({ key: "open", label, variant: "ghost", capability: "inbox.view" }),
};

const urgencyOfChange = (c: ChangeIn): InboxUrgency => (c.launch || c.spendDeltaDaily > 0 ? "orange" : "yellow");

/** A ChangeSet that waits for the owner. Meta changes do not postpone: yes or no (and «جرّب أول» opens the card with the test). */
export function fromChange(c: ChangeIn): InboxItem {
  const kind: InboxKind = c.launch ? "launch" : c.auto ? "safety_net" : "spend";
  return {
    id: itemId("change", c.id),
    kind,
    domain: "ads",
    title: c.sentence,
    why: `${c.by} · ${c.reasonCode}`,
    effect: { moneyDeltaDaily: c.spendDeltaDaily || null, text: c.before !== "—" ? `${c.before} ← ${c.after}` : c.after },
    from: { label: c.by },
    at: c.atIso ?? new Date(0).toISOString(),
    urgency: urgencyOfChange(c),
    expiresAt: null,
    actions: [A.approve(), A.reject(), A.open("جرّب أول")],
    ...(c.live === false ? { demo: true } : {}),
  };
}

/** The kind of a request from Claude: a message to send, stock, money, or anything else. */
export function kindOfApproval(a: Pick<ApprovalIn, "kind" | "amount">): InboxKind {
  if (a.kind === "send_message") return "message";
  if (a.kind === "stock") return "stock";
  if (a.amount !== null && a.amount > 0) return "spend";
  return "other";
}

const domainOfApproval = (a: ApprovalIn): InboxDomain => (a.kind === "stock" || a.kind === "send_message" ? "ops" : a.workflowKey ? "work" : "ads");

/** A request Claude made with `request_approval`. Its options are the answers (the first is the primary one); «أجّل» is always there. */
export function fromApproval(a: ApprovalIn): InboxItem {
  const kind = kindOfApproval(a);
  const [first, second] = a.options;
  const actions: InboxAction[] =
    kind === "message"
      ? [{ key: "send", label: first?.label ?? "ابعت", variant: "primary", capability: "inbox.decide" }, A.reject(second?.label ?? "لا"), A.later()]
      : [A.approve(first?.label ?? "وافق"), A.reject(second?.label ?? "ارفض"), A.later()];
  return {
    id: itemId("approval", a.id),
    kind,
    domain: domainOfApproval(a),
    title: a.title,
    why: a.why,
    effect: a.amount !== null ? { moneyDeltaDaily: null, moneyAfter: a.amount } : null,
    ...(kind === "message" && typeof a.analysis?.text === "string" ? { preview: a.analysis.text } : {}),
    from: { label: a.source === "mcp" ? "Claude" : "الموقع", ...(a.workflowKey ? { jobKey: a.workflowKey } : {}) },
    at: a.createdAt,
    urgency: a.urgency,
    expiresAt: a.expiresAt,
    actions,
    numbers: a.numbers,
    postponedUntil: a.postponedUntil,
  };
}

export interface AdviceIn {
  /** the job's key */
  key: string;
  number: number | null;
  name: string;
  domain: "ads" | "ops";
  /** keep · merge · cancel · lighten · think */
  advice: string;
  adviceText: string | null;
  runsFrom: string | null;
  /** ISO — when the advice arrived (the job's last update) */
  at: string;
}

const ADVICE_VERB: Record<string, string> = { cancel: "ألغيها", merge: "ادمجها", keep: "خلّيها", lighten: "خفّفها", think: "فكّر فيها" };

/**
 * A job whose agent advised something the owner has not decided on. The advice comes first: «ألغيها» → [ألغيها · خلّيها], «ادمجها» → [ادمجها · خلّيها];
 * any other advice → [خلّيها · ألغيها]. The press goes to /api/work/decisions.
 */
export function fromAdvice(a: AdviceIn): InboxItem {
  const first: InboxAction = a.advice === "merge" ? { key: "merge", label: "ادمجها", variant: "primary", confirm: true, capability: "work.control" } : a.advice === "cancel" ? { key: "cancel", label: "ألغيها", variant: "primary", confirm: true, capability: "work.control" } : { key: "keep", label: "خلّيها", variant: "primary", capability: "work.control" };
  const keep: InboxAction = { key: "keep", label: "خلّيها", variant: first.key === "keep" ? "secondary" : "secondary", capability: "work.control" };
  const cancel: InboxAction = { key: "cancel", label: "ألغيها", variant: "ghost", confirm: true, capability: "work.control" };
  const actions = first.key === "keep" ? [first, cancel] : [first, keep];
  return {
    id: itemId("advice", a.key),
    kind: "advice",
    domain: a.domain === "ops" ? "ops" : "ads",
    title: `${a.number ? `${a.number} · ` : ""}${a.name} — توصية الوكيل: ${ADVICE_VERB[a.advice] ?? a.advice}`,
    why: a.adviceText,
    effect: null,
    from: { label: a.runsFrom ?? "Claude", jobKey: a.key },
    at: a.at,
    urgency: "yellow",
    expiresAt: null,
    actions,
  };
}

const PERSON = /^(?!claude|hermes|muse)/;
const FAILED_KINDS = new Set(["node_failed", "timeout", "missing_connection"]);

/** A handoff is a decision only when somebody has to step in: it is a person's, or it failed and has waited more than 30 minutes. */
export function handoffNeedsOwner(h: Pick<HandoffIn, "kind" | "assignee" | "waitingMin">): boolean {
  return PERSON.test(h.assignee) || (FAILED_KINDS.has(h.kind) && h.waitingMin > 30);
}

export function fromHandoff(h: HandoffIn): InboxItem {
  return {
    id: itemId("handoff", h.id),
    kind: "stuck",
    domain: "work",
    title: h.title,
    why: h.context.lastError ?? h.context.need ?? "واقفة وبدها حدا يكمّلها",
    effect: null,
    from: { label: h.workflowName ?? h.workflowKey, jobKey: h.workflowKey },
    at: h.createdAt,
    urgency: h.waitingMin > 180 ? "red" : "orange",
    expiresAt: null,
    actions: [
      { key: "complete", label: "خلصت", variant: "primary", capability: "inbox.decide" },
      { key: "cancel", label: "ألغِها", variant: "ghost", confirm: true, capability: "inbox.decide" },
    ],
  };
}

// ── order and count ──

const RANK: Record<InboxUrgency, number> = { red: 0, orange: 1, yellow: 2 };

/** Red first, then the one that runs out soonest, then the newest. */
export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  return [...items].sort((a, b) => {
    if (RANK[a.urgency] !== RANK[b.urgency]) return RANK[a.urgency] - RANK[b.urgency];
    const ea = t(a.expiresAt);
    const eb = t(b.expiresAt);
    if (!Number.isNaN(ea) || !Number.isNaN(eb)) {
      if (Number.isNaN(ea)) return 1;
      if (Number.isNaN(eb)) return -1;
      if (ea !== eb) return ea - eb;
    }
    return (t(b.at) || 0) - (t(a.at) || 0);
  });
}

/** The red number: the open items this person can decide on (an item with no action they may take is not counted). */
export function inboxCount(items: readonly InboxItem[], can: (capability: string) => boolean = () => true): number {
  return items.filter((i) => i.actions.some((a) => can(a.capability))).length;
}

export const DOMAIN_AR: Record<InboxDomain, string> = { ads: "إعلانات", ops: "تشغيل", work: "الشغل" };
export const KIND_AR: Record<InboxKind, string> = {
  spend: "صرف",
  safety_net: "شبكة الأمان",
  launch: "إطلاق",
  message: "رسالة",
  order: "أمر",
  advice: "توصية",
  stuck: "متوقفة",
  creative: "فيديو",
  stock: "مخزون",
  other: "قرار",
};

/** The address of an item's page — what Telegram and the ring screen link to. */
export const inboxHref = (id: string): string => `/inbox/${encodeURIComponent(id)}`;
