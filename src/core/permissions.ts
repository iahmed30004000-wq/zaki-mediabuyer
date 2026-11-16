/**
 * «مين بيقدر شو» (docs/rebuild/05-permissions.md §1, §7): ONE view that reads the four systems that decide it — the role of a person (`roles.ts`), the level
 * of each ad account (`autonomy.ts`), the scopes of each agent's token (`token-scopes.ts`) and the fixed limits (§6) — and prints the truth, never a copy
 * written by hand. Pure. Every cell is one of three: ✓ by itself · ⏳ with the owner's approval from the site · ✕ forbidden. An agent's cell also says whether the SITE
 * enforces it (a door it passes through: ChangeSet, approvals, the scopes) or it is an INSTRUCTION to the agent (what it does outside the site, through
 * its own Meta token) — the screen never pretends to enforce what it cannot.
 */
import { CAPABILITIES, can, type Capability, type RoleKey, ROLES } from "./roles";
import { toolAllowed, type McpScope } from "./token-scopes";

export type CellState = "self" | "approval" | "no";
export type CellBasis = "enforced" | "instruction" | "locked";
export interface Cell {
  state: CellState;
  basis: CellBasis;
  /** one short line shown on touch */
  note?: string;
}

export interface RoleRow {
  key: string;
  label: string;
  /** a hard limit (§6): the boxes are not buttons */
  locked: boolean;
  cells: Record<RoleKey, Cell>;
}
export interface Section<R> {
  title: string;
  rows: R[];
}

interface RoleAction {
  key: string;
  label: string;
  cap: Capability;
  /** a role that may only PROPOSE this reaches the owner's approval instead of «no» */
  proposeVia?: Capability;
  locked?: boolean;
  group: "ads" | "ops" | "work";
}

const ROLE_ACTIONS: readonly RoleAction[] = [
  { key: "ads.view", label: "يشوف لوحة الإعلانات (مع الصرف)", cap: "ads.view", group: "ads" },
  { key: "money.view", label: "يشوف الأرباح والتكاليف ونقط التعادل", cap: "money.view", group: "ads" },
  { key: "ads.propose", label: "يقترح تغيير أو إطلاق أو طلب فيديو", cap: "ads.propose", group: "ads" },
  { key: "ads.pause", label: "يوقّف ويخفّض (أمان) والإيقاف الكامل", cap: "ads.pause", group: "ads" },
  { key: "ads.approve_within_cap", label: "يوافق على زيادة ضمن السقف", cap: "ads.approve_within_cap", group: "ads" },
  { key: "ads.connect", label: "يربط حساب فيسبوك أو يستورد ملف", cap: "ads.connect", group: "ads" },
  { key: "spend_over_cap", label: "الصرف فوق السقف", cap: "owner_only", proposeVia: "ads.propose", locked: true, group: "ads" },
  { key: "new_campaign", label: "حملة جديدة", cap: "owner_only", proposeVia: "ads.propose", locked: true, group: "ads" },
  { key: "rules", label: "القواعد والسقوف ومستوى الحساب", cap: "owner_only", locked: true, group: "ads" },
  { key: "ops.view", label: "يشوف لوحة التشغيل (القمع، الشحن، المخزون)", cap: "ops.view", group: "ops" },
  { key: "ops.people", label: "يشوف أرقام كل موظف باسمه", cap: "ops.people", group: "ops" },
  { key: "ops.send", label: "يوافق على رسالة أو نصيحة للفريق", cap: "ops.send", group: "ops" },
  { key: "tasks.manage", label: "ينشئ ويوزّع مهام أي حدا", cap: "tasks.manage", group: "ops" },
  { key: "tasks.own", label: "يشوف ويحدّث مهامه", cap: "tasks.own", group: "ops" },
  { key: "orders.restrict", label: "يسجّل أمر ساري بيشدّد", cap: "orders.restrict", group: "ops" },
  { key: "order_relax", label: "الأمر اللي بيرخّي", cap: "owner_only", locked: true, group: "ops" },
  { key: "work.view", label: "يشوف خريطة المهام والتقارير (لمجالاته)", cap: "work.view", group: "work" },
  { key: "work.control", label: "يشغّل أو يطفي مهمة، ويقرّر على ورقة القرار", cap: "work.control", group: "work" },
  { key: "inbox.view", label: "يشوف القرارات بمجالاته", cap: "inbox.view", group: "work" },
  { key: "assistant.use", label: "يسأل المساعد", cap: "assistant.use", group: "work" },
  { key: "settings.view", label: "يشوف الإعدادات (قراءة)", cap: "settings.view", group: "work" },
  { key: "team", label: "الفريق والصلاحيات والتوكنات والربط", cap: "owner_only", locked: true, group: "work" },
];

const GROUP_AR = { ads: "الإعلانات", ops: "التشغيل والفريق", work: "الشغل والنظام" } as const;

function roleCell(role: RoleKey, a: RoleAction): Cell {
  if (can(role, a.cap)) return { state: "self", basis: a.locked ? "locked" : "enforced" };
  if (a.proposeVia && can(role, a.proposeVia)) return { state: "approval", basis: "locked", note: "بيقترح، والمالك بيوافق من الموقع" };
  return { state: "no", basis: a.locked ? "locked" : "enforced" };
}

/** People: the actions in three groups, a cell per role. */
export function roleMatrix(): Section<RoleRow>[] {
  return (["ads", "ops", "work"] as const).map((g) => ({
    title: GROUP_AR[g],
    rows: ROLE_ACTIONS.filter((a) => a.group === g).map((a) => ({ key: a.key, label: a.label, locked: !!a.locked, cells: Object.fromEntries(ROLES.map((r) => [r, roleCell(r, a)])) as Record<RoleKey, Cell> })),
  }));
}

// ── agents ──

export interface AgentIn {
  key: string;
  name: string;
  /** the scopes of every live token this agent holds (empty = no token) */
  tokenScopes: string[][];
}
export interface AccountIn {
  name: string;
  /** autonomy level 0–3 */
  level: number;
}

export interface AgentRow {
  key: string;
  label: string;
  locked: boolean;
  cells: Record<string, Cell>;
}

const DOOR_ROWS: readonly { key: string; label: string; scope: McpScope; probe: string; tools: string }[] = [
  { key: "door.read", label: "يقرا القواعد والمهام والطلبات", scope: "mcp:read", probe: "get_rules", tools: "get_rules · get_mode · get_approvals · list_tasks…" },
  { key: "door.push", label: "يدفع الأرقام والمخزون والفيديوهات", scope: "mcp:push", probe: "push_metrics", tools: "push_metrics · push_stock · push_videos · push_jobs" },
  { key: "door.run", label: "يسجّل تشغيلات", scope: "mcp:run", probe: "log_run", tools: "log_run" },
  { key: "door.ask", label: "يطلب موافقة ويبعت إشعار ويسجّل أمر", scope: "mcp:ask", probe: "request_approval", tools: "request_approval · notify · record_order · end_order" },
  { key: "door.tasks", label: "ينشئ ويحدّث مهام", scope: "mcp:tasks", probe: "create_task", tools: "create_task · update_task" },
  { key: "door.handoff", label: "يمسك الطلبات الواقفة", scope: "mcp:handoff", probe: "claim_handoff", tools: "claim_handoff · complete_handoff · create_handoff" },
  { key: "door.videos", label: "يمسك طلبات الفيديو", scope: "mcp:videos", probe: "claim_video_request", tools: "claim_video_request · complete_video_request" },
];

/** What an agent may call through the site, from its tokens: ✓ when any live token carries the tool, ✕ when it has no token or none carries it. */
function doorCell(a: AgentIn, probe: string): Cell {
  if (!a.tokenScopes.length) return { state: "no", basis: "enforced", note: "ما معه توكن" };
  return a.tokenScopes.some((sc) => toolAllowed(sc, probe)) ? { state: "self", basis: "enforced" } : { state: "no", basis: "enforced", note: "التوكن ما فيه هالنطاق" };
}

/** The highest autonomy level among the accounts, and a word on which one (the cell says it). */
function topLevel(accounts: readonly AccountIn[]): { level: number; note: string } {
  if (!accounts.length) return { level: 0, note: "ما في حساب مربوط" };
  const best = accounts.reduce((m, x) => (x.level > m.level ? x : m), accounts[0]!);
  return { level: best.level, note: accounts.length === 1 ? `المستوى ${best.level}` : `أعلى مستوى ${best.level} (${best.name})` };
}

/** Agents: the doors their tokens open, then what each does on Meta by the account's level — and the limits that never move. */
export function agentMatrix(agents: readonly AgentIn[], accounts: readonly AccountIn[]): Section<AgentRow>[] {
  const { level, note } = topLevel(accounts);
  const row = (key: string, label: string, locked: boolean, f: (a: AgentIn) => Cell): AgentRow => ({ key, label, locked, cells: Object.fromEntries(agents.map((a) => [a.key, f(a)])) });
  return [
    { title: "شو بيمرّ من الموقع (التوكن)", rows: DOOR_ROWS.map((d) => row(d.key, d.label, false, (a) => ({ ...doorCell(a, d.probe), note: doorCell(a, d.probe).note ?? d.tools }))) },
    {
      title: "شو بيعمل على ميتا (مستوى الحساب)",
      rows: [
        row("meta.pause", "يوقّف ويخفّض (أمان)", false, () => (level >= 1 ? { state: "self", basis: "instruction", note: `${note} — تعليمة للوكيل` } : { state: "approval", basis: "instruction", note })),
        row("meta.scale", "يكبّر ضمن السقف", false, () => (level >= 2 ? { state: "self", basis: "instruction", note: `${note} — تعليمة للوكيل` } : level === 1 ? { state: "approval", basis: "instruction", note } : { state: "no", basis: "instruction", note })),
        row("meta.over", "صرف فوق السقف · حملة جديدة", true, () => ({ state: "approval", basis: "locked", note: "دايماً بموافقة المالك من الموقع" })),
        row("meta.message", "رسالة للفريق", false, () => ({ state: "approval", basis: "enforced", note: "request_approval من نوع رسالة" })),
        row("meta.order_tighten", "أمر ساري بيشدّد", false, () => ({ state: "self", basis: "enforced" })),
        row("meta.order_relax", "أمر ساري بيرخّي", true, () => ({ state: "approval", basis: "locked", note: "للمالك بس" })),
        row("meta.never", "دفع · شراء · تحويل · حذف · اشتراك", true, () => ({ state: "no", basis: "locked", note: "ولا وكيل" })),
      ],
    },
  ];
}

/** How many capabilities the table holds (the test pins it at eighteen). */
export const CAPABILITY_COUNT = CAPABILITIES.length;
