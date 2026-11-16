/**
 * WORKFLOWS (v3 · F, v4 · E) — the work that runs, as the owner sees it: a graph of nodes (a trigger, steps, a
 * condition, an approval gate, a wait, a notification), who executes each one, how risky it is, and — while a run
 * is going — the live state of every node. Pure: the graph, its validation, the states, and the seeded jobs.
 *
 * Permission badges (every node and every workflow carries one):
 *   green   no approval needed (reading, reporting)
 *   yellow  runs alone but only inside a rule and a cap (the rule is shown with it)
 *   red     needs the owner's explicit yes first
 *   black   forbidden to agents: payments, deletes, logging out, CAPTCHAs, tokens, the n8n «ورك فلو n8n الرئيسي» workflow
 */
import { z } from "zod";

export const NODE_TYPES = ["trigger", "step", "condition", "approval", "wait", "notify"] as const;
export const EXECUTORS = ["claude_task", "claude_mcp", "claude_desktop", "claude_api", "hermes", "muse", "n8n", "telegram", "http", "person", "system"] as const;
/** The doers the site itself may run (D35): n8n, an HTTP address, Telegram. Lives here, with the other executors, so a screen can ask without loading node:crypto. */
export const SITE_EXECUTORS = ["n8n", "http", "telegram"] as const;
export type SiteExecutor = (typeof SITE_EXECUTORS)[number];
export const isSiteExecutor = (x: string | undefined): x is SiteExecutor => !!x && (SITE_EXECUTORS as readonly string[]).includes(x);

export const PERMISSIONS = ["green", "yellow", "red", "black"] as const;
export const DATA_SOURCES = ["api", "mcp", "manual"] as const;
export const NODE_STATUSES = ["waiting", "running", "done", "failed", "handoff", "approval"] as const;
export const RUN_STATUSES = ["running", "ok", "failed", "waiting", "skipped"] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type Executor = (typeof EXECUTORS)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type DataSource = (typeof DATA_SOURCES)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];

export const EXECUTOR_AR: Record<Executor, string> = {
  claude_task: "Claude (مهمة مجدولة)",
  claude_mcp: "Claude (MCP)",
  claude_desktop: "Claude Desktop",
  claude_api: "Claude API",
  hermes: "هيرمز",
  muse: "ميوز",
  n8n: "n8n",
  telegram: "بوت تيليجرام",
  http: "HTTP API",
  person: "شخص",
  system: "النظام",
};

export const PERMISSION_AR: Record<Permission, string> = { green: "أخضر — بلا موافقة", yellow: "أصفر — بقاعدة وسقف", red: "أحمر — بموافقتك أول", black: "أسود — ممنوع على الوكلاء" };

export const NodeSchema = z
  .object({
    id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "المعرّف حروف إنجليزية وأرقام بس"),
    type: z.enum(NODE_TYPES),
    label: z.string().trim().min(1).max(120),
    executor: z.enum(EXECUTORS).optional(),
    assignee: z.string().trim().max(40).optional(),
    permission: z.enum(PERMISSIONS).optional(),
    dataSource: z.enum(DATA_SOURCES).optional(),
    prompt: z.string().max(8000).optional(),
    inputs: z.string().max(500).optional(),
    outputs: z.string().max(500).optional(),
    destination: z.string().max(300).optional().describe("وين بتوصل النتيجة وعلى شو"),
    desc: z.string().trim().max(300).optional().describe("شو بيعمل هالفرع بكلام المالك"),
    timeoutS: z.number().int().min(1).max(86_400).optional(),
    retries: z.number().int().min(0).max(10).optional(),
    fallback: z.string().max(300).optional(),
    target: z.string().trim().max(200).optional().describe("الهدف لما المنفّذ n8n (اسم الـ webhook) أو http (رابط https) — الموقع بينفّذ بس من قائمتك المسموحة"),
    disabled: z.boolean().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict();
export type WfNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: z.string().max(60).optional() }).strict();
export type WfEdge = z.infer<typeof EdgeSchema>;

export const GraphSchema = z
  .object({ nodes: z.array(NodeSchema).min(1).max(60), edges: z.array(EdgeSchema).max(120) })
  .strict()
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    for (const n of g.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `المعرّف ${n.id} مكرر` });
      ids.add(n.id);
    }
    for (const e of g.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: "custom", message: `الرابط ${e.from} ← ${e.to} بيشير لعقدة مش موجودة` });
    }
  });
export type WfGraph = z.infer<typeof GraphSchema>;

export interface NodeState {
  status: NodeStatus;
  at: string;
  note?: string;
}
export type NodeStates = Record<string, NodeState>;

/** The nodes in the order they run (a topological order that keeps the drawn order for ties); a loop's rest is appended. */
export function stepOrder(g: WfGraph): WfNode[] {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const out: WfNode[] = [];
  const left = [...g.nodes];
  while (left.length) {
    const i = left.findIndex((n) => (indeg.get(n.id) ?? 0) === 0);
    const n = i === -1 ? left[0]! : left[i]!;
    left.splice(i === -1 ? 0 : i, 1);
    out.push(n);
    for (const e of g.edges) if (e.from === n.id) indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
  }
  return out;
}

/** New states with `updates` applied on top (a state that was not mentioned stays). */
export function mergeNodeStates(prev: NodeStates, updates: { id: string; status: NodeStatus; note?: string }[], at: string, known?: Set<string>): NodeStates {
  const next: NodeStates = { ...prev };
  for (const u of updates) {
    if (known && !known.has(u.id)) continue;
    next[u.id] = { status: u.status, at, ...(u.note ? { note: u.note.slice(0, 200) } : {}) };
  }
  return next;
}

/**
 * What the canvas shows when a run reports only its status: a finished run ends with every node done; a failed one
 * turns the running node red; a run that waits turns its running node into the gate it is stuck at; a run that just
 * started has its trigger done and the next node running — so a caller that only says «started» still makes it move.
 */
export function settleStates(g: WfGraph, states: NodeStates, status: RunStatus, at: string): NodeStates {
  const order = stepOrder(g).filter((n) => !n.disabled);
  const next: NodeStates = { ...states };
  const terminal = (s?: NodeState) => s?.status === "done" || s?.status === "failed";
  if (status === "ok") {
    for (const n of order) if (!terminal(next[n.id])) next[n.id] = { status: "done", at };
  } else if (status === "failed") {
    const running = order.filter((n) => next[n.id]?.status === "running");
    if (running.length) for (const n of running) next[n.id] = { ...next[n.id]!, status: "failed", at };
    else {
      const first = order.find((n) => !terminal(next[n.id]));
      if (first) next[first.id] = { status: "failed", at };
    }
  } else if (status === "waiting") {
    for (const n of order) if (next[n.id]?.status === "running") next[n.id] = { ...next[n.id]!, status: n.type === "approval" ? "approval" : "handoff", at };
  } else if (status === "running" && !Object.keys(next).length) {
    const [first, second] = order;
    if (first) next[first.id] = { status: "done", at };
    if (second) next[second.id] = { status: "running", at };
  }
  return next;
}

// ───────────────────────────── the seeded jobs ─────────────────────────────

export interface SeedWorkflow {
  key: string;
  name: string;
  description: string;
  /** five-field cron on the Amman clock, or null (by hand / by event) */
  schedule: string | null;
  executor: Executor;
  permission: Permission;
  graph: WfGraph;
}

const chain = (nodes: WfNode[]): WfGraph => ({ nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) });
const trigger = (label: string): WfNode => ({ id: "start", type: "trigger", label, executor: "system", permission: "green" });
const claude = (id: string, label: string, destination: string, permission: Permission = "green", extra: Partial<WfNode> = {}): WfNode => ({ id, type: "step", label, executor: "claude_mcp", dataSource: "mcp", permission, destination, ...extra });
const notify = (destination: string): WfNode => ({ id: "notify", type: "notify", label: "تبليغ المالك", executor: "claude_mcp", permission: "green", destination });

/**
 * The work Claude does today, as editable workflows (v4 · E) plus the rest of the v1 list. No amount of money is written
 * here — what a step may spend is the owner's rule (the rules page), shown beside it; tests/workflow.test.ts holds that.
 */
export const SEED_WORKFLOWS: SeedWorkflow[] = [
  {
    key: "daily-check",
    name: "الفحص اليومي",
    description: "كل يوم الساعة 10:43: قراءة مدير الإعلانات والـ OMS ومقارنتها بالقواعد. تنبيهات بس — ولا تغيير بالنهار.",
    schedule: "43 10 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([
      trigger("الساعة 10:43"),
      claude("read", "قراءة مدير الإعلانات والـ OMS", "الميديا باير ← الإعلانات (push_metrics)", "green", { inputs: "مدير الإعلانات · الـ OMS", outputs: "أرقام اليوم وآخر 3 أيام كاملة" }),
      claude("check", "مقارنة الأرقام بالقواعد", "تنبيهات بـ «اليوم»", "green", { outputs: "قائمة التنبيهات" }),
      notify("اليوم + تيليجرام"),
    ]),
  },
  {
    key: "night-round",
    name: "جولة الإعلانات الليلية",
    description: "الساعة 00:35: الوقت الوحيد اللي بيصير فيه تغيير. بتطبّق القواعد: إيقاف، تكبير ضمن السقف، وأي شي برّا القواعد بيرجع لموافقتك.",
    schedule: "35 0 * * *",
    executor: "claude_mcp",
    permission: "yellow",
    graph: chain([
      trigger("الساعة 00:35"),
      claude("read", "قراءة آخر 3 أيام كاملة", "الميديا باير ← الإعلانات", "green", { outputs: "تكلفة الطلب الحقيقي لكل مجموعة وإعلان" }),
      { id: "judge", type: "condition", label: "فوق نقطة التعادل؟ تحت الهدف؟", executor: "claude_mcp", permission: "green" },
      claude("pause", "إيقاف حسب القواعد", "مدير الإعلانات + سجل الجولة", "yellow", { inputs: "قاعدة الإيقاف", fallback: "تنبيه للمالك إذا ما انفّذ" }),
      claude("scale", "تكبير ضمن السقف", "مدير الإعلانات + سجل الجولة", "yellow", { inputs: "قاعدة التكبير والسقف" }),
      { id: "gate", type: "approval", label: "أي شي برّا القواعد (رفع السقف…)", executor: "claude_mcp", permission: "red", destination: "الميديا باير ← المهام ← بانتظار موافقتك" },
      notify("ملخص الجولة ← «صباح الخير»"),
    ]),
  },
  {
    key: "product-tests",
    name: "اختبارات المنتجات الجديدة",
    description: "الساعة 00:17: متابعة اختبار كل منتج جديد حسب قاعدة الاختبار (أول يوم بيتجاهل، ثم الحكم بالأيام).",
    schedule: "17 0 * * *",
    executor: "claude_mcp",
    permission: "yellow",
    graph: chain([
      trigger("الساعة 00:17"),
      claude("read", "قراءة أرقام الاختبارات", "الميديا باير ← الإعلانات ← الاختبارات", "green"),
      claude("judge", "الحكم حسب قاعدة الاختبار", "سجل الاختبار", "yellow", { inputs: "قاعدة اختبار المنتج الجديد" }),
      notify("اليوم"),
    ]),
  },
  {
    key: "video-collection",
    name: "جمع الفيديوهات",
    description: "الساعة 23:13: قراءة فيديوهات المنتجات الجاهزة من Drive وإدخالها ببنك الفيديوهات. قراءة بس — ولا تعديل على الفيديوهات.",
    schedule: "13 23 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([
      trigger("الساعة 23:13"),
      claude("read", "قراءة مجلدات الفيديوهات النهائية", "Drive (قراءة بس)", "green"),
      claude("push", "تسجيلها ببنك الفيديوهات", "الميديا باير ← الفيديوهات (push_videos)", "green", { outputs: "فيديوهات جديدة بالبنك" }),
      notify("اليوم"),
    ]),
  },
  {
    key: "team-round",
    name: "جولة الفريق",
    description: "كل ساعة من 10 لـ 22: متابعة مهام الفريق وشو واقف، وتحويل الواقف لمهمة بالمهام.",
    schedule: "0 10-22 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([
      trigger("كل ساعة 10 – 22"),
      claude("read", "قراءة مهام Workspace والمحادثة", "Zaki Workspace (قراءة)", "green"),
      claude("tasks", "تحديث المهام الواقفة", "الميديا باير ← المهام", "green", { outputs: "مهام متوقفة ومين بيكمّلها" }),
    ]),
  },
  {
    key: "manager-comment",
    name: "تعليق المدير",
    description: "الساعة 21:55: تعليق اليوم للمدير بالأرقام.",
    schedule: "55 21 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([trigger("الساعة 21:55"), claude("write", "كتابة تعليق اليوم", "المدير", "green", { inputs: "أرقام اليوم" }), notify("المدير")]),
  },
  {
    key: "review-fixes",
    name: "تصليح تبويب المراجعة",
    description: "إعلانات انرفضت: قراءة سبب الرفض وتجهيز مسودة الطعن. الطعن نفسه بإيد شخص — مش بإيد الوكيل.",
    schedule: null,
    executor: "claude_mcp",
    permission: "yellow",
    graph: chain([
      { id: "start", type: "trigger", label: "يدوي أو بعد رفض", executor: "system", permission: "green" },
      claude("read", "قراءة الإعلانات المرفوضة وأسبابها", "الميديا باير ← الإعلانات ← الصحة", "green"),
      claude("draft", "تجهيز مسودة الطعن", "الميديا باير ← الصحة (مسودة)", "green"),
      { id: "person", type: "step", label: "الطعن والإرسال", executor: "person", assignee: "owner", permission: "red", destination: "مدير الإعلانات" },
    ]),
  },
  {
    key: "hermes-requests",
    name: "طلبات الهوكات والسيناريوهات لهيرمز",
    description: "رابح تعبان ← طلب هوكات. رابح جديد ← طلب سيناريوهات. كل طلب بيمشي: طلب ← عند هيرمز ← جاهز ← مرفوع ← بالتيست ← النتيجة.",
    schedule: null,
    executor: "hermes",
    permission: "green",
    graph: chain([
      { id: "start", type: "trigger", label: "رابح تعبان أو رابح جديد", executor: "system", permission: "green" },
      claude("task", "تجهيز الطلب (JOB + السيناريو + الأرقام)", "الميديا باير ← المهام", "green"),
      { id: "hermes", type: "step", label: "هيرمز بينفّذ الطلب", executor: "hermes", permission: "green", destination: "الميديا باير ← الفيديوهات" },
      notify("اليوم"),
    ]),
  },
  {
    key: "tinnitus-experiment",
    name: "تجربة عرض الطنين (5 أيام)",
    description: "تجربة مدتها 5 أيام: متابعة يومية، وحكم بالنهاية من الطلبات الحقيقية.",
    schedule: null,
    executor: "claude_mcp",
    permission: "yellow",
    graph: chain([
      { id: "start", type: "trigger", label: "يدوي — يوم التجربة", executor: "system", permission: "green" },
      claude("track", "متابعة يومية", "الميديا باير ← الإعلانات ← الاختبارات", "green"),
      claude("verdict", "الحكم بآخر يوم", "سجل الاختبار", "yellow"),
      notify("اليوم"),
    ]),
  },
  {
    key: "leak-plan",
    name: "متابعة خطة سدّ التسريب",
    description: "الساعة 11:15: متابعة أرقام خطة سدّ التسريب (طلبات ما انتأكدت أو ما انسلّمت).",
    schedule: "15 11 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([trigger("الساعة 11:15"), claude("read", "قراءة أرقام التأكيد والتسليم", "الـ OMS (قراءة)", "green"), claude("report", "تحديث لوحة سدّ التسريب", "الميديا باير ← المهام (لوحة سد التسريب)", "green"), notify("المالك")]),
  },
  {
    key: "basha-parcels",
    name: "قائمة طرود الباشا",
    description: "قائمة الطرود المتأخرة والمرتجعة مع الباشا، للمتابعة.",
    schedule: null,
    executor: "claude_mcp",
    permission: "green",
    graph: chain([{ id: "start", type: "trigger", label: "يدوي أو بجولة الشحنات", executor: "system", permission: "green" }, claude("read", "قراءة طرود الباشا", "الـ OMS (قراءة)", "green"), claude("list", "تجهيز القائمة", "الميديا باير ← المهام (لوحة الباشا والمرتجعات)", "green")]),
  },
  {
    key: "breakeven-refresh",
    name: "تحديث نقطة التعادل الأسبوعي",
    description: "مراجعة أسبوعية لنقطة التعادل لكل منتج من الأرقام الحقيقية. أي تغيير بالقواعد بيرجع لموافقتك.",
    schedule: null,
    executor: "claude_mcp",
    permission: "yellow",
    graph: chain([
      { id: "start", type: "trigger", label: "أسبوعياً (حدّد الوقت)", executor: "system", permission: "green" },
      claude("calc", "حساب التعادل من الأرقام الحقيقية", "اقتراح للمالك", "green"),
      { id: "gate", type: "approval", label: "تغيير نقطة التعادل بالقواعد", executor: "claude_mcp", permission: "red", destination: "الميديا باير ← المهام ← بانتظار موافقتك" },
    ]),
  },
  {
    key: "shipments-check",
    name: "فحص الشحنات كل ساعتين",
    description: "من 11:07 لـ 21:07 كل ساعتين: متابعة الشحنات المتأخرة والمرتجعات.",
    schedule: "7 11-21/2 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([trigger("11:07 – 21:07 كل ساعتين"), claude("read", "قراءة حالة الشحنات", "الـ OMS (قراءة)", "green"), claude("flag", "تحويل المتأخر لمهمة", "الميديا باير ← المهام", "green")]),
  },
  {
    key: "stock-alerts",
    name: "تنبيهات المخزون",
    description: "كل 4 ساعات من 9:30: قراءة مخزون كل منتج من الـ OMS ومقارنته بحد الأمان، وتنبيه المالك لما منتج يقرب يخلص.",
    schedule: "30 9-21/4 * * *",
    executor: "claude_mcp",
    permission: "green",
    graph: chain([trigger("09:30 – 21:30 كل 4 ساعات"), claude("read", "قراءة مخزون المنتجات", "الـ OMS (قراءة)", "green"), claude("compare", "مقارنته بحد الأمان", "الميديا باير ← التنبيهات", "green"), notify("المالك")]),
  },
  {
    key: "girls-training",
    name: "تدريب بنات التأكيد (الخميس)",
    description: "الخميس 11:20: جلسة تدريب فريق التأكيد عن طريق ميوز.",
    schedule: "20 11 * * 4",
    executor: "muse",
    permission: "green",
    graph: chain([trigger("الخميس 11:20"), { id: "muse", type: "step", label: "ميوز بيدرّب فريق التأكيد", executor: "muse", permission: "green", destination: "فريق التأكيد" }, notify("المالك")]),
  },
  {
    key: "one-off-verdicts",
    name: "أحكام لمرة وحدة",
    description: "حكم على إعلان أو منتج بطلب المالك، من الأرقام الحقيقية.",
    schedule: null,
    executor: "claude_mcp",
    permission: "green",
    graph: chain([{ id: "start", type: "trigger", label: "بطلب المالك", executor: "system", permission: "green" }, claude("read", "قراءة الأرقام", "الميديا باير", "green"), claude("verdict", "كتابة الحكم", "المالك", "green")]),
  },
];
