/**
 * THE ASSISTANT'S TOOLS (v3 · H). Names stay English, descriptions are Arabic (what the model reads). None of them can spend,
 * delete, approve or reach Meta:
 *
 *   read    get_numbers · get_ads · get_videos · get_tasks · get_day · get_changes · get_workflows · get_overview ·
 *           explain · calculate        — the screens' own loaders, so an answer is the dashboard's number
 *   write   create_task · update_task  — the team's task board (archived, never deleted)
 *           propose_change             — a ChangeSet from source «agent»: it ALWAYS waits for the owner's yes on the site
 *   draft   draft_workflow · draft_node · draft_prompt — nothing is saved: the panel shows a card and the owner opens it
 *
 * A tool never throws at the model: what is wrong with a call comes back in words (`isError`) so it can fix the call.
 * The loaders are injected (`ToolDeps`) so a test can stand in for the database.
 */
import { z } from "zod";
import { consultFacts } from "@/agents/consultant";
import { checkItems, findObject, kindOf } from "@/agents/preparer";
import {
  ASSISTANT_AGENT, RANGE_CHOICES, calculate, rangeQuery, resolveProduct, toolData, toolError,
  type Artifact, type AssistantTool, type RangeQuery, type Resolved, type ToolOutput,
} from "@/core/assistant";
import { addDays, ammanKey, isKey } from "@/core/dates";
import { SET_KEYS } from "@/core/numbers";
import { refuseIfPrivate } from "@/core/push-rows";
import { can } from "@/core/roles";
import { TASK_COLUMNS } from "@/core/tasks";
import { EdgeSchema, GraphSchema, NodeSchema, stepOrder } from "@/core/workflow";
import { addAfter, addNode, autoLayout, checkGraph, diffText, ensureLayout, graphDiff, setNode } from "@/core/workflow-edit";
import { ADS_SORTS, STATS_GUIDE, adsOutput, dayOutput, explainOutput, numbersOutput, tasksOutput, videosOutput, workflowsOutput, type NumbersLike } from "@/lib/assistant-views";
import { loadAdsTable, type AdsTableData } from "@/lib/ads-table";
import { loadDay, type DayData } from "@/lib/day-view";
import { fmt } from "@/lib/format";
import { loadNumbers } from "@/lib/numbers-view";
import { loadBoard, type BoardData } from "@/lib/videos-board";
import type { Actor } from "../audit";
import { HttpError, type Caller } from "../auth";
import { db } from "../db";
import { propose } from "../changes";
import { TASK_STATUSES, TaskCreateInput, TaskRefused, TaskUpdateInput, createTask, listTasks, updateTask, type TaskView } from "../tasks";
import { graphTexts, listWorkflows, type WorkflowCard } from "../workflows";

export interface ToolCtx {
  caller: Caller;
  now: Date;
  place: { key: string; label: string } | null;
}

export type Tool = AssistantTool<ToolCtx>;

export interface ChangeRow {
  id: string;
  sentence: string;
  kind: string;
  state: string;
  source: string;
  spendDeltaDaily: number;
  at: string;
}

export interface ProposeIn {
  sentence: string;
  items: { op: "pause" | "resume" | "set_budget"; object_type: "campaign" | "adset" | "ad"; object_id: string; daily_budget?: number }[];
}

export type Proposed = { ok: true; id: string; state: string; items: number; spendDeltaDaily: number; refused: string[] } | { ok: false; error: string };

export interface ToolDeps {
  products: () => Promise<{ code: string; name: string }[]>;
  numbers: (q: RangeQuery, now: Date) => Promise<NumbersLike>;
  ads: (q: RangeQuery, now: Date) => Promise<AdsTableData>;
  board: (now: Date) => Promise<BoardData>;
  day: (day: string, now: Date) => Promise<DayData>;
  tasks: (f: Parameters<typeof listTasks>[0], now: Date) => Promise<TaskView[]>;
  workflows: (now: Date) => Promise<WorkflowCard[]>;
  overview: (now: Date) => Promise<string[]>;
  changes: (state: "pending" | "recent", limit: number) => Promise<ChangeRow[]>;
  createTask: typeof createTask;
  updateTask: typeof updateTask;
  propose: (p: ProposeIn, caller: Caller) => Promise<Proposed>;
}

// ───────────────────────────── the real loaders ─────────────────────────────

const STATE_LABEL: Record<string, string> = {
  pending_approval: "بانتظار موافقتك",
  simulated: "مسجّل بس — الحساب بوضع مستشار",
  executed: "تنفّذ",
  rolled_back: "انرجع",
  rejected: "انرفض",
  failed: "فشل",
};

async function accountOf(type: string, id: string): Promise<string | null> {
  if (type === "campaign") return (await db.campaign.findUnique({ where: { metaId: id }, select: { account: { select: { metaId: true } } } }))?.account.metaId ?? null;
  if (type === "adset") return (await db.adSet.findUnique({ where: { metaId: id }, select: { campaign: { select: { account: { select: { metaId: true } } } } } }))?.campaign.account.metaId ?? null;
  if (type === "ad") return (await db.ad.findUnique({ where: { metaId: id }, select: { adSet: { select: { campaign: { select: { account: { select: { metaId: true } } } } } } } }))?.adSet.campaign.account.metaId ?? null;
  return null;
}

/** The code's check of what the model proposed, then the change service: source «agent», so it waits for a person whatever the level. */
async function proposeReal(p: ProposeIn, caller: Caller): Promise<Proposed> {
  const checked = await checkItems(
    p.items.map((i) => ({ op: i.op, object_type: i.object_type, object_id: i.object_id, ...(i.daily_budget === undefined ? {} : { after: { daily_budget: i.daily_budget } }) })),
    findObject,
  );
  if (!checked.items.length) return { ok: false, error: ["ما طلع ولا تغيير صالح", ...checked.refused].join(" · ") };
  const accounts = new Set<string>();
  for (const i of checked.items) {
    const a = await accountOf(i.objectType, i.objectId);
    if (a) accounts.add(a);
  }
  if (accounts.size > 1) return { ok: false, error: "التغييرات لأكتر من حساب إعلاني — اقترح كل حساب لحاله" };
  const cs = await propose(
    { source: "agent", sourceRef: `assistant:${caller.id}`, reasonCode: "S11", sentence: `من المساعد: ${p.sentence}`.slice(0, 300), kind: kindOf(checked.items), accountMetaId: [...accounts][0] ?? null, items: checked.items },
    { type: "agent", id: ASSISTANT_AGENT },
  );
  return { ok: true, id: cs.id, state: cs.state, items: checked.items.length, spendDeltaDaily: Number(cs.spendDeltaDaily), refused: checked.refused };
}

export const defaultDeps: ToolDeps = {
  products: async () => (await db.productEconomics.findMany({ select: { productCode: true, name: true }, orderBy: { productCode: "asc" } })).map((p) => ({ code: p.productCode, name: p.name })),
  numbers: (q, now) => loadNumbers(q, now),
  ads: (q, now) => loadAdsTable(q, now),
  board: (now) => loadBoard(now),
  day: (day, now) => loadDay(day, now),
  tasks: (f, now) => listTasks(f, now),
  workflows: (now) => listWorkflows(now),
  overview: (now) => consultFacts(now),
  changes: async (state, limit) => {
    const rows = await db.changeSet.findMany({
      where: state === "pending" ? { state: { in: ["pending_approval", "simulated"] } } : { state: { in: ["executed", "rolled_back", "rejected", "failed"] }, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, sentence: true, kind: true, state: true, source: true, spendDeltaDaily: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, sentence: r.sentence, kind: r.kind, state: r.state, source: r.source, spendDeltaDaily: Number(r.spendDeltaDaily), at: r.createdAt.toISOString() }));
  },
  createTask,
  updateTask,
  propose: proposeReal,
};

// ───────────────────────────── helpers ─────────────────────────────

const rangeShape = {
  range: z.enum(RANGE_CHOICES).optional().describe("today · yesterday · last7 · last30 · custom (الافتراضي today). «امبارح» = yesterday، «هالأسبوع» = last7."),
  from: z.string().trim().max(10).optional().describe("لـ custom: YYYY-MM-DD"),
  to: z.string().trim().max(10).optional().describe("لـ custom: YYYY-MM-DD (فاضي = نفس from: يوم واحد)"),
};

const label = (p: { code: string; name: string }) => `${p.name} (${p.code})`;

function productError(q: string, r: Extract<Resolved<{ code: string; name: string }>, { ok: false }>): ToolOutput {
  return r.reason === "many"
    ? toolError(`«${q}» بيطابق أكتر من منتج: ${r.candidates.map(label).join("، ")}. اسأل المالك أي واحد.`)
    : toolError(`ما لقيت منتج «${q}». المنتجات: ${r.candidates.map(label).join("، ")}.`);
}

/** A product named by the model → the product, or a tool error that says what the names are. */
async function pickProduct(deps: ToolDeps, q: string | undefined): Promise<{ ok: true; product: { code: string; name: string } | null } | { ok: false; out: ToolOutput }> {
  if (!q?.trim()) return { ok: true, product: null };
  const r = resolveProduct(q, await deps.products());
  return r.ok ? { ok: true, product: r.item } : { ok: false, out: productError(q, r) };
}

function dayOf(v: string | undefined, now: Date): string | null {
  const today = ammanKey(now);
  if (!v || v === "today") return today;
  if (v === "yesterday") return addDays(today, -1);
  return isKey(v) ? v : null;
}

const COLUMN_LABEL: Record<string, string> = Object.fromEntries(TASK_COLUMNS.map((c) => [c.key, c.label]));
const money = (v: number) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v), "$")}`;

/** A refusal of the privacy filter or a validator is a sentence for the model, not an exception. */
async function guarded(fn: () => Promise<ToolOutput>): Promise<ToolOutput> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TaskRefused) return toolError(e.message);
    if (e instanceof HttpError && e.status < 500) return toolError(e.message);
    console.error("[assistant] tool failed", e);
    return toolError("صار خطأ بالأداة — جرّب كمان مرة أو بصيغة تانية");
  }
}

const DraftNode = NodeSchema.omit({ x: true, y: true, disabled: true, dataSource: true });
const issueTexts = (g: Parameters<typeof checkGraph>[0]) => checkGraph(g).map((i) => i.text);

const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

// ───────────────────────────── the tools ─────────────────────────────

export function makeTools(over: Partial<ToolDeps> = {}): Tool[] {
  const deps: ToolDeps = { ...defaultDeps, ...over };

  return [
    {
      name: "get_numbers",
      access: "read",
      status: "عم أجيب الأرقام…",
      description: `أرقام شاشة «الأرقام» بالضبط (نفس اللي بيشوفها المالك): الصرف، الطلبات الحقيقية، تكلفة الطلب الحقيقي، المؤكد، الشحن، الأموال المتوقعة، المخزون… للمجموع ولكل منتج ولأي فترة. استعملها لأي سؤال عن رقم، وانسخ حقل display متل ما هو. المفاتيح: ${STATS_GUIDE}`,
      input: z
        .object({
          ...rangeShape,
          product: z.string().trim().max(60).optional().describe("كود المنتج أو اسمه (مثلاً TIN01 أو «الطنين»). فاضي = المجموع وكل المنتجات"),
          stats: z.array(z.enum(SET_KEYS)).max(12).optional().describe("أي أرقام بالمفاتيح. فاضي = الأساسية (الصرف، الطلبات، التكلفة، المؤكد، الشحن، الربح المتوقع)"),
          compare: z.boolean().optional().describe("true = ضيف مقارنة كل رقم بالفترة اللي قبلها وبمعدّل آخر 7 أيام"),
        })
        .strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const args = a as { range?: (typeof RANGE_CHOICES)[number]; from?: string; to?: string; product?: string; stats?: (typeof SET_KEYS)[number][]; compare?: boolean };
          const r = rangeQuery(args, ctx.now);
          if (!r.ok) return toolError(r.error);
          const p = await pickProduct(deps, args.product);
          if (!p.ok) return p.out;
          return numbersOutput(await deps.numbers(r.q, ctx.now), { q: r.q, product: p.product, stats: args.stats, compare: args.compare });
        }),
    },
    {
      name: "get_ads",
      access: "read",
      status: "عم أقرا الإعلانات…",
      description: "جدول الإعلانات: حملات · مجموعات · إعلانات، كل سطر بصرفه وطلباته الحقيقية وتكلفة الطلب الحقيقي والتأكيد والربح التقديري وميزانيته اليومية ورقمه (id) — الرقم هو اللي بتحتاجه propose_change. الافتراضي: الشغّال بس، مرتّب بالصرف، 8 أسطر.",
      input: z
        .object({
          ...rangeShape,
          product: z.string().trim().max(60).optional().describe("كود المنتج أو اسمه"),
          level: z.enum(["campaign", "adset", "ad"]).optional().describe("حملات · مجموعات · إعلانات (فاضي = الكل)"),
          status: z.enum(["active", "all"]).optional().describe("active (الافتراضي) أو all مع الموقوف"),
          sort: z.enum(ADS_SORTS).optional().describe("spend (الافتراضي) · costPerOrder (الأرخص أول) · orders · profit"),
          limit: z.number().int().min(1).max(15).optional(),
        })
        .strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const args = a as { range?: (typeof RANGE_CHOICES)[number]; from?: string; to?: string; product?: string; level?: "campaign" | "adset" | "ad"; status?: "active" | "all"; sort?: (typeof ADS_SORTS)[number]; limit?: number };
          const r = rangeQuery(args, ctx.now);
          if (!r.ok) return toolError(r.error);
          const p = await pickProduct(deps, args.product);
          if (!p.ok) return p.out;
          return adsOutput(await deps.ads(r.q, ctx.now), { q: r.q, product: p.product, level: args.level, status: args.status, sort: args.sort, limit: args.limit });
        }),
    },
    {
      name: "get_videos",
      access: "read",
      status: "عم أقرا لوحة الفيديوهات…",
      description: "لوحة الفيديوهات لكل منتج: كم فيديو بالبنك من 50، الرابحين (الأرخص طلب حقيقي فوق حد الصرف الأدنى)، كم تعبان، وكم طلب مفتوح عند هيرمز.",
      input: z.object({ product: z.string().trim().max(60).optional().describe("كود المنتج أو اسمه (فاضي = كل المنتجات)") }).strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const board = await deps.board(ctx.now);
          const q = (a as { product?: string }).product;
          if (!q?.trim()) return videosOutput(board, { product: null });
          const r = resolveProduct(q, board.products);
          return r.ok ? videosOutput(board, { product: r.item }) : productError(q, r);
        }),
    },
    {
      name: "get_tasks",
      access: "read",
      status: "عم أقرا المهام…",
      description: "مهام الفريق (آخر 14 يوم للمنتهية): العنوان والحالة والمسؤول والموعد والأولوية — ورقم كل مهمة (id) لتعدّلها بـ update_task. الافتراضي: كل المفتوحة.",
      input: z
        .object({
          status: z.array(z.enum(TASK_STATUSES)).max(5).optional().describe("new · doing · waiting_approval · stalled · done"),
          assignee: z.string().trim().max(40).optional().describe("abdullah · hassan · laith · mohammad · hermes · muse · claude"),
          board: z.string().trim().max(40).optional().describe("main · confirmation · leak · basha · stock"),
          limit: z.number().int().min(1).max(30).optional(),
        })
        .strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const f = a as { status?: string[]; assignee?: string; board?: string; limit?: number };
          return tasksOutput(await deps.tasks({ status: f.status, assignee: f.assignee, board: f.board, limit: f.limit ?? 30, doneWithinDays: 14 }, ctx.now));
        }),
    },
    {
      name: "get_day",
      access: "read",
      status: "عم أجيب إنجاز اليوم…",
      description: "إنجاز يوم واحد (توقيت عمّان): شو انعمل (تشغيلات، قرارات، مهام خلصت، فيديوهات تحرّكت) وشو مخطّط — مكتوب أسطر من الكود. استعملها لـ «لخّصلي يوم كذا» و«شو خلّصنا».",
      input: z.object({ day: z.string().trim().max(10).optional().describe("today (الافتراضي) · yesterday · أو YYYY-MM-DD") }).strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const day = dayOf((a as { day?: string }).day, ctx.now);
          if (!day) return toolError("اليوم لازم today أو yesterday أو YYYY-MM-DD");
          return dayOutput(await deps.day(day, ctx.now));
        }),
    },
    {
      name: "get_changes",
      access: "read",
      status: "عم أقرا التغييرات…",
      description: "تغييرات الحملات: «pending» = اللي بانتظار موافقة المالك أو اقتراح مسجّل · «recent» = اللي صار آخر 3 أيام (تنفّذ/انرجع/انرفض/فشل) مع سبب كل واحد. استعملها لـ «ليش وقف…» و«شو بانتظاري».",
      input: z.object({ state: z.enum(["pending", "recent"]).optional().describe("الافتراضي pending"), limit: z.number().int().min(1).max(20).optional() }).strict(),
      run: (a) =>
        guarded(async () => {
          const q = a as { state?: "pending" | "recent"; limit?: number };
          const rows = await deps.changes(q.state ?? "pending", q.limit ?? 10);
          return toolData(
            {
              count: rows.length,
              changes: rows.map((r) => ({ id: r.id, sentence: r.sentence, kind: r.kind, state: STATE_LABEL[r.state] ?? r.state, from: r.source, daily_spend_effect: { value: r.spendDeltaDaily, display: money(r.spendDeltaDaily) }, at: r.at })),
            },
            { sources: [{ id: "changes", label: "المهام ← بانتظار موافقتك", href: "/tasks" }], facts: [{ label: q.state === "recent" ? "تغييرات آخر 3 أيام" : "تغييرات بانتظارك", value: String(rows.length), raw: rows.length, source: "changes" }] },
          );
        }),
    },
    {
      name: "get_workflows",
      access: "read",
      status: "عم أقرا الورك فلو…",
      description: "الورك فلو: بدون key = القائمة (المفتاح، شغّال؟، جدولته، آخر حالة). مع key = رسم واحد: خطواته (id · type · label · executor) ووصلاته — اللي بتحتاجه لتقترح خطوة بـ draft_node.",
      input: z.object({ key: z.string().trim().max(60).optional() }).strict(),
      run: (a, ctx) => guarded(async () => workflowsOutput(await deps.workflows(ctx.now), (a as { key?: string }).key || undefined)),
    },
    {
      name: "get_overview",
      access: "read",
      status: "عم أجمع الصورة الكاملة…",
      description: "صورة عامة من الكود: مستوى كل حساب وسقفه، آخر 7 أيام لكل منتج (صرف، مؤكد، تكلفة المؤكد، سقف التكبير، ربح)، التغييرات بانتظار المالك، قرارات الأمان آخر 24 ساعة، التنبيهات، وخطة الأسبوع. للأسئلة العامة («كيف الوضع؟»).",
      input: z.object({}).strict(),
      run: (_a, ctx) =>
        guarded(async () => {
          const lines = await deps.overview(ctx.now);
          return toolData({ lines }, { sources: [{ id: "overview", label: "نظرة عامة (من الكود)", href: "/" }], facts: lines.slice(0, 12).map((l) => ({ label: l, value: "", raw: null, source: "overview" })) });
        }),
    },
    {
      name: "explain",
      access: "read",
      status: "عم أقرا الدليل…",
      description: "شرح شاشة (شو هاي الصفحة، الخطوة الجاية، أجزاءها) و/أو معادلة رقم («قاعدة الاحتساب»: معادلته ومصدره ومعناه). بدون أي وسيط: شرح الصفحة اللي المالك فيها هلأ.",
      input: z
        .object({
          place: z.enum(["today", "ads", "videos", "tasks", "workflow", "done", "settings"]).optional().describe("مفتاح الصفحة"),
          term: z.string().trim().max(60).optional().describe("اسم الرقم أو مفتاحه، مثلاً «تكلفة الطلب الحقيقي» أو costPerOrder"),
        })
        .strict(),
      run: (a, ctx) => guarded(async () => explainOutput(a as { place?: string; term?: string }, ctx.place?.key ?? null)),
    },
    {
      name: "calculate",
      access: "read",
      status: "عم أحسب…",
      description: "حسبة بالكود: + − × ÷ وأقواس على أرقام (من نتائج الأدوات: حقل value). لأي فرق أو نسبة أو مجموع. ما تحسب بعقلك أبداً.",
      input: z.object({ expression: z.string().trim().min(1).max(200).describe("مثلاً: (4.15 - 3.8) / 3.8 * 100") }).strict(),
      run: (a) =>
        guarded(async () => {
          const expression = (a as { expression: string }).expression;
          const r = calculate(expression);
          if (!r.ok) return toolError(r.error);
          return toolData({ expression, result: r.value, display: r.text }, { sources: [{ id: "calc", label: "حسبة الكود" }], facts: [{ label: `حسبة: ${expression}`, value: r.text, raw: r.value, source: "calc" }] });
        }),
    },
    {
      name: "create_task",
      access: "write",
      status: "عم أعمل المهمة…",
      description: "أنشئ مهمة على لوحة المهام (مثلاً «بكرا لميوز: اعمل 4 هوكات»): عنوان، ومسؤول، وموعد. بتنفّذ فوراً لما المالك يطلب. ما تحط أي رقم هاتف أو بيانات زبون.",
      input: TaskCreateInput,
      run: (a, ctx) =>
        guarded(async () => {
          if (ctx.caller.demo) return toolError("المساعد ما بيكتب بالوضع التجريبي (بدون تسجيل دخول).");
          const t = await deps.createTask(a as z.infer<typeof TaskCreateInput>, { type: "user", id: ctx.caller.id } satisfies Actor, "assistant");
          const art: Artifact = { kind: "task_created", id: t.id, title: t.title, assignee: t.assignee, dueAt: t.dueAt, href: "/tasks" };
          return toolData({ ok: true, id: t.id, title: t.title, assignee: t.assignee, due: t.dueAt?.slice(0, 10) ?? null, status: t.status }, { artifacts: [art], sources: [{ id: "tasks:board", label: "المهام", href: "/tasks" }] });
        }),
    },
    {
      name: "update_task",
      access: "write",
      status: "عم أحدّث المهمة…",
      description: "غيّر حالة مهمة أو مسؤولها أو موعدها أو أولويتها، أو أرشفها (archived=true — ما بتنحذف). الرقم (id) من get_tasks أو create_task.",
      input: TaskUpdateInput,
      run: (a, ctx) =>
        guarded(async () => {
          if (ctx.caller.demo) return toolError("المساعد ما بيكتب بالوضع التجريبي (بدون تسجيل دخول).");
          const i = a as z.infer<typeof TaskUpdateInput>;
          const t = await deps.updateTask(i, { type: "user", id: ctx.caller.id } satisfies Actor);
          if (!t) return toolError("المهمة مش موجودة — جيب الرقم من get_tasks");
          const parts = [i.status ? `الحالة ← ${COLUMN_LABEL[i.status] ?? i.status}` : "", i.assignee ? `المسؤول ← ${i.assignee}` : "", i.due_at === null ? "بلا موعد" : i.due_at ? `الموعد ← ${i.due_at.slice(0, 10)}` : "", i.priority ? `الأولوية ← ${i.priority}` : "", i.archived ? "انأرشفت" : "", i.note !== undefined ? "الملاحظة تغيّرت" : ""].filter(Boolean);
          const art: Artifact = { kind: "task_updated", id: t.id, title: t.title, change: parts.join(" · ") || "تحدّثت", href: "/tasks" };
          return toolData({ ok: true, id: t.id, title: t.title, status: t.status }, { artifacts: [art], sources: [{ id: "tasks:board", label: "المهام", href: "/tasks" }] });
        }),
    },
    {
      name: "propose_change",
      access: "write",
      status: "عم أجهّز الاقتراح…",
      description:
        "اقترح تغيير على حملة/مجموعة/إعلان: pause (إيقاف) · resume (تشغيل) · set_budget (ميزانية يومية جديدة، ±50% من الحالية كحد أقصى، للحملة أو المجموعة). الأرقام (object_id) من get_ads. هاد اقتراح بس: بيروح «المهام ← بانتظار موافقتك» وما بيتنفّذ إلا بموافقة المالك على الموقع — ما تقول «تم» أبداً. اشرح بالجملة (sentence) السبب بالأرقام.",
      input: z
        .object({
          sentence: z.string().trim().min(5).max(280).describe("سطر واحد: شو بدك ولماذا (بالأرقام اللي رجعت من الأدوات)"),
          items: z
            .array(
              z
                .object({
                  op: z.enum(["pause", "resume", "set_budget"]),
                  object_type: z.enum(["campaign", "adset", "ad"]),
                  object_id: z.string().trim().min(1).max(64).describe("الرقم (id) من get_ads"),
                  daily_budget: z.number().positive().max(10000).optional().describe("للـ set_budget بس: الميزانية اليومية الجديدة بالدولار"),
                })
                .strict(),
            )
            .min(1)
            .max(5),
        })
        .strict(),
      run: (a, ctx) =>
        guarded(async () => {
          if (ctx.caller.demo) return toolError("المساعد ما بيكتب بالوضع التجريبي (بدون تسجيل دخول).");
          const p = a as ProposeIn;
          const r = await deps.propose(p, ctx.caller);
          if (!r.ok) return toolError(r.error);
          const stateLabel = STATE_LABEL[r.state] ?? r.state;
          const art: Artifact = { kind: "change_proposed", id: r.id, state: r.state, stateLabel, sentence: p.sentence, items: r.items, spendDeltaDaily: r.spendDeltaDaily, href: "/tasks" };
          return toolData(
            { ok: true, id: r.id, state: stateLabel, items: r.items, daily_spend_effect: { value: r.spendDeltaDaily, display: money(r.spendDeltaDaily) }, dropped: r.refused, executed: false, note: "هاد اقتراح — ما انتنفّذ شي. المالك بيوافق من الموقع." },
            { artifacts: [art], sources: [{ id: "changes", label: "المهام ← بانتظار موافقتك", href: "/tasks" }] },
          );
        }),
    },
    {
      name: "draft_workflow",
      access: "read",
      status: "عم أرسم المسودة…",
      description:
        "ارسم مسودة ورك فلو جديد: خطوات (id إنجليزي قصير، type، label، executor، permission، prompt…) ووصلات من ← إلى. ما بيتحفظ شي — بتظهر للمالك بطاقة ويفتحها بالمحرر ويراجعها ويحفظها. بداية واحدة (trigger)، وبوّابة موافقة (approval) أحمر قبل أي خطوة بتصرف أو بتغيّر شي على الحملات. ما تحط أي مبلغ أو بيانات زبون.",
      input: z
        .object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).optional(),
          nodes: z.array(DraftNode).min(1).max(30),
          edges: z.array(EdgeSchema).max(60),
        })
        .strict(),
      run: (a) =>
        guarded(async () => {
          const i = a as { name: string; description?: string; nodes: z.infer<typeof DraftNode>[]; edges: z.infer<typeof EdgeSchema>[] };
          const parsed = GraphSchema.safeParse({ nodes: i.nodes, edges: i.edges });
          if (!parsed.success) return toolError(`الرسم مش صحيح: ${parsed.error.issues.slice(0, 3).map((x) => x.message).join(" · ")}`);
          const refusal = refuseIfPrivate(i.name, i.description, ...graphTexts(parsed.data));
          if (refusal) return toolError(refusal);
          const graph = autoLayout(parsed.data);
          const issues = issueTexts(graph);
          const summary = `${graph.nodes.length} خطوة · ${graph.edges.length} وصلة`;
          const art: Artifact = { kind: "workflow_draft", name: i.name, description: i.description ?? "", graph, summary, issues };
          return toolData({ ok: true, saved: false, summary, warnings: issues, note: "المسودة ظهرت للمالك بطاقة — هو بيفتحها بالمحرر ويحفظها." }, { artifacts: [art] });
        }),
    },
    {
      name: "draft_node",
      access: "read",
      status: "عم أجهّز الخطوة…",
      description: "اقترح خطوة جديدة على ورك فلو موجود (المفتاح من get_workflows). بتنحط بعد الخطوة after_node_id وبتنوصل فيها، وإذا ما حطيته بتنحط بآخر الرسم وبتنوصل بآخر خطوة. ما بيتحفظ شي: المالك بيفتح الرسم وفيه الخطوة كمسودة ويراجع ويحفظ.",
      input: z
        .object({
          workflow_key: z.string().trim().min(1).max(60),
          after_node_id: z.string().trim().max(40).optional().describe("id الخطوة اللي بتجي بعدها (من get_workflows)"),
          node: DraftNode.omit({ id: true }),
        })
        .strict(),
      run: (a, ctx) =>
        guarded(async () => {
          const i = a as { workflow_key: string; after_node_id?: string; node: Omit<z.infer<typeof DraftNode>, "id"> };
          const cards = await deps.workflows(ctx.now);
          const card = cards.find((c) => c.key === i.workflow_key);
          if (!card) return toolError(`ما في ورك فلو بالمفتاح «${i.workflow_key}». المفاتيح: ${cards.map((c) => c.key).join("، ")}`);
          const base = ensureLayout(card.graph);
          const anchor = i.after_node_id ?? (i.node.type === "trigger" ? undefined : stepOrder(base).at(-1)?.id);
          const added = anchor ? addAfter(base, anchor, i.node.type) : addNode(base, i.node.type);
          if (!added.ok) return toolError(added.error);
          const { type: _type, ...fields } = i.node;
          void _type;
          const set = setNode(added.graph, added.id!, fields);
          if (!set.ok) return toolError(set.error);
          const refusal = refuseIfPrivate(...graphTexts(set.graph));
          if (refusal) return toolError(refusal);
          const issues = issueTexts(set.graph);
          const afterLabel = anchor ? base.nodes.find((n) => n.id === anchor)?.label : undefined;
          const summary = `خطوة «${i.node.label}»${afterLabel ? ` بعد «${afterLabel}»` : ""} — ${diffText(graphDiff(base, set.graph))}`;
          const art: Artifact = { kind: "node_draft", workflowKey: card.key, workflowName: card.name, graph: set.graph, summary, issues };
          return toolData({ ok: true, saved: false, new_node_id: added.id, summary, warnings: issues, note: "الخطوة ظهرت للمالك بطاقة — هو بيفتح الرسم وفيها كمسودة ويحفظ." }, { artifacts: [art], sources: [{ id: `workflow:${card.key}`, label: `الورك فلو · ${card.name}`, href: `/workflow/${card.key}` }] });
        }),
    },
    {
      name: "draft_prompt",
      access: "read",
      status: "عم أكتب البرومبت…",
      description: "اكتب برومبت (لخطوة ورك فلو، أو طلب لهيرمز/ميوز، أو وكيل) كبطاقة قابلة للنسخ. المتغيرات بين {{ }} مثل {{product}} و{{date}}. ما بيتحفظ شي. ما تحط أي مبلغ أو بيانات زبون أو مفتاح.",
      input: z.object({ title: z.string().trim().min(1).max(80), text: z.string().trim().min(10).max(6000) }).strict(),
      run: (a) =>
        guarded(async () => {
          const i = a as { title: string; text: string };
          const refusal = refuseIfPrivate(i.title, i.text);
          if (refusal) return toolError(refusal);
          const variables = [...new Set([...i.text.matchAll(VAR)].map((m) => m[1]!))];
          const bad = variables.filter((v) => !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(v));
          if (bad.length) return toolError(`أسماء المتغيرات لازم حروف إنجليزية وأرقام و _ و . بس: ${bad.join("، ")}`);
          const art: Artifact = { kind: "prompt_draft", title: i.title, text: i.text, variables };
          return toolData({ ok: true, saved: false, variables, note: "البرومبت ظهر للمالك بطاقة قابلة للنسخ." }, { artifacts: [art] });
        }),
    },
  ];
}

/** Used by the loop to check «may this person run a write tool». */
export const canWrite = (caller: Caller) => can(caller.role, "propose_change");

