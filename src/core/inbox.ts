/**
 * «بانتظارك»: ONE shape for every decision that waits for the owner (docs/rebuild/04-work.md §6). Pure: the sources (a Meta change, a
 * request from Claude, a handoff nobody can finish) are turned into the same `InboxItem`, sorted one way, counted one way — so the
 * card, the list, the red number in the menu and the Telegram link can never disagree. No database here: src/server/inbox.ts reads
 * the tables and calls these.
 */
import { isTeamMessage } from "./approval-rules";
import { inboxDomainsOf, type Capability, type RoleKey } from "./roles";

export const INBOX_KINDS = ["spend", "safety_net", "launch", "message", "order", "advice", "stuck", "creative", "stock", "other"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export type InboxDomain = "ads" | "ops" | "work";
export type InboxUrgency = "red" | "orange" | "yellow";

export type InboxActionKey = "approve" | "reject" | "later" | "send" | "edit" | "keep" | "cancel" | "retry" | "reassign" | "open" | "complete" | "merge" | "choose";

export interface InboxAction {
  key: InboxActionKey;
  /** An answer the agent wrote itself (`options` of its request): it is sent by this key, never squeezed into «موافق» or «رفض» (W-09). */
  option?: string;
  /** One or two words with a verb: «وافق» · «ارفض» · «أجّل». */
  label: string;
  variant: "primary" | "secondary" | "ghost";
  /** Asks «متأكد؟» first. */
  confirm?: boolean;
  /** The capability the person needs (docs/rebuild/05-permissions.md). */
  capability: Capability;
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

export type InboxSource = "change" | "approval" | "handoff" | "advice" | "order";

export const itemId = (source: InboxSource, rowId: string): string => `${source}:${rowId}`;
export function splitItemId(id: string): { source: InboxSource; rowId: string } | null {
  const m = /^(change|approval|handoff|advice|order):(.+)$/.exec(id);
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
  approve: (label = "وافق", capability: Capability = "owner_only"): InboxAction => ({ key: "approve", label, variant: "primary", capability }),
  reject: (label = "ارفض", capability: Capability = "owner_only"): InboxAction => ({ key: "reject", label, variant: "secondary", capability }),
  later: (capability: Capability = "owner_only"): InboxAction => ({ key: "later", label: "أجّل", variant: "ghost", capability }),
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
    actions: [A.approve(undefined, c.launch ? "owner_only" : "ads.approve_within_cap"), A.reject(undefined, c.launch ? "owner_only" : "ads.approve_within_cap"), A.open("جرّب أول")],
    ...(c.live === false ? { demo: true } : {}),
  };
}

/** The kind of a request from Claude: a message to send, stock, money, or anything else. A «message» that names money is money. */
export function kindOfApproval(a: Pick<ApprovalIn, "kind" | "amount">): InboxKind {
  if (a.kind === "send_message" && !(a.amount !== null && a.amount > 0)) return "message";
  if (a.kind === "stock") return "stock";
  if (a.amount !== null && a.amount > 0) return "spend";
  return "other";
}

const domainOfApproval = (a: ApprovalIn): InboxDomain => (a.kind === "stock" || isTeamMessage({ kind: a.kind, amount: a.amount, analysis: a.analysis }) ? "ops" : a.workflowKey ? "work" : "ads");

/**
 * The buttons of a request: ONE per option the agent wrote, in its order, each sent by its own key (W-09). The first is the main one («وافق» — or «ابعت» for a
 * message); an option whose key is `reject` is the refusal; any other option is an answer of its own — it is sent as an answer with its key, so the agent reads
 * exactly which one the owner chose. (v5 showed two buttons only: the third option could not be chosen and the second was always sent as a refusal.)
 */
export function optionActions(options: readonly { key: string; label: string }[], message: boolean, capability: Capability): InboxAction[] {
  const list = options.length ? options : [{ key: "approve", label: message ? "ابعت" : "وافق" }, { key: "reject", label: message ? "لا" : "ارفض" }];
  return list.slice(0, 5).map((o, i): InboxAction => {
    if (i === 0) return { key: message ? "send" : "approve", option: o.key, label: o.label, variant: "primary", capability };
    if (o.key === "reject") return { key: "reject", option: o.key, label: o.label, variant: "secondary", capability };
    return { key: "choose", option: o.key, label: o.label, variant: "secondary", capability };
  });
}

/** A request Claude made with `request_approval`. Its options are the answers (the first is the primary one); «أجّل» is always there. */
export function fromApproval(a: ApprovalIn): InboxItem {
  // who may answer is decided by what the request carries, not by the `kind` the agent wrote (the server decides the same way): a «message» with no text to show is the owner's
  const kind = kindOfApproval(a) === "message" && !isTeamMessage({ kind: a.kind, amount: a.amount, analysis: a.analysis }) ? "other" : kindOfApproval(a);
  const capability: Capability = kind === "message" ? "ops.send" : "owner_only";
  const actions: InboxAction[] = [...optionActions(a.options, kind === "message", capability), A.later(capability)];
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

export interface OrderIn {
  id: string;
  text: string;
  domain: string;
  /** a loosening order Claude carried, waiting for the owner's yes */
  pending: boolean;
  /** Claude asked to end this one (it is in force until the owner answers) */
  endRequested: boolean;
  source: string;
  createdAt: string;
}

/** A standing order that waits for the owner: a loosening one Claude carried (وافق · ارفض), or Claude's request to end a tightening one (انهِه · خلّيه). */
export function fromOrder(o: OrderIn): InboxItem {
  const end = o.endRequested && !o.pending;
  return {
    id: itemId("order", o.id),
    kind: "order",
    domain: o.domain === "ops" ? "ops" : o.domain === "all" ? "work" : "ads",
    title: end ? `Claude بدّه ينهي الأمر: «${o.text}»` : `أمر جديد بيرخّي: «${o.text}»`,
    why: end ? "إنهاء أمر بيشدّد ترخية، فبدّه موافقتك. الأمر فعّال لحد ما توافق." : "أمر بيرخّي (زيد/اسمح/ارجع) نقله Claude عن كلامك — ما بيشتغل إلا بموافقتك.",
    effect: null,
    from: { label: o.source === "mcp" ? "Claude" : "الموقع" },
    at: o.createdAt,
    urgency: "orange",
    expiresAt: null,
    actions: end ? [A.approve("انهِه"), A.reject("خلّيه")] : [A.approve(), A.reject()],
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
      { key: "complete", label: "خلصت", variant: "primary", capability: "work.control" },
      { key: "cancel", label: "ألغِها", variant: "ghost", confirm: true, capability: "work.control" },
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
export function inboxCount(items: readonly InboxItem[], can: (capability: Capability) => boolean = () => true): number {
  return items.filter((i) => i.actions.some((a) => can(a.capability))).length;
}

/** What this role may see in the inbox: only the areas it can look at (§3 «المجال»), and only an item it holds an action for or may at least open. */
export function inboxFor(items: readonly InboxItem[], role: RoleKey): InboxItem[] {
  const domains = inboxDomainsOf(role);
  return items.filter((i) => domains.includes(i.domain));
}

export const DOMAIN_AR: Record<InboxDomain, string> = { ads: "إعلانات", ops: "تشغيل", work: "الشغل" };
export const KIND_AR: Record<InboxKind, string> = {
  spend: "صرف",
  safety_net: "شبكة الأمان",
  launch: "إطلاق",
  message: "رسالة",
  order: "أمر",
  advice: "توصية",
  stuck: "واقفة",
  creative: "فيديو",
  stock: "مخزون",
  other: "قرار",
};

/** The address of an item's page — what Telegram and the ring screen link to. */
export const inboxHref = (id: string): string => `/inbox/${encodeURIComponent(id)}`;
