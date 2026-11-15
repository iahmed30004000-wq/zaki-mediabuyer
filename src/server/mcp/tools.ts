/**
 * THE TOOLS CLAUDE HAS HERE (v4 · A). Names stay English, descriptions are Arabic (that is what the model reads).
 * Twelve tools, none of which can spend, delete, or approve anything:
 *
 *   push_metrics · push_stock · push_videos   the numbers Claude read from Ads Manager, the OMS, the stock sheet, Drive
 *   log_run                                   a job run — it moves the matching workflow on الورك فلو
 *   request_approval · get_approvals          ask the owner, read his answer
 *   notify                                    a non-blocking alert (🔴 🟠 🟡)
 *   get_mode · get_rules                      is he awake · the rules to work by
 *   list_tasks · update_task · create_task    what waits for whom
 *
 * A tool never throws at the model: what is wrong with a call comes back in words (`isError`) so it can fix the call.
 */
import { z } from "zod";
import { MetricRow, StockRow, VideoRow, refuseIfPrivate } from "@/core/push-rows";
import type { ToolDef, ToolResult } from "@/core/mcp-rpc";
import type { Actor } from "../audit";
import { db } from "../db";
import { ApprovalInput, APPROVAL_STATUSES, Refused, listApprovals, requestApproval } from "../approvals";
import { currentMode } from "../mode";
import { createNotification, dispatchNotification } from "../notify";
import { applyMetrics, applyStock, applyVideos } from "../push";
import { getRules } from "../rules";
import { TASK_STATUSES, TaskCreateInput, TaskRefused, TaskUpdateInput, createTask, listTasks, updateTask } from "../tasks";
import { LogRunInput, RunRefused, UnknownJob, logRun } from "../workflows";
import { HANDOFF_STATUSES } from "@/core/handoff";
import { REQUEST_STATUSES } from "@/core/video-board";
import { VideoRequestComplete, claimVideoRequest, completeVideoRequest, listVideoRequests } from "../video-requests";
import { HandoffComplete, HandoffCreate, HandoffRefused, claimHandoff, completeHandoff, createHandoff, listHandoffs } from "../handoffs";

export interface McpCtx {
  tokenId: string;
  tokenName: string;
  actor: Actor;
}

const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text: data ? `${text}\n${JSON.stringify(data)}` : text, data });
const fail = (text: string): ToolResult => ({ text, isError: true });

const rowsOf = <T extends z.ZodTypeAny>(row: T, max: number, what: string) => z.object({ rows: z.array(row).min(1).max(max).describe(what) }).strict();
const looseRows = (max: number) => z.object({ rows: z.array(z.unknown()).min(1).max(max) }).strict();

const reportText = (what: string, applied: number, rejected: { index: number; error: string }[]) =>
  `${what}: انحفظ ${applied}${rejected.length ? ` · انرفض ${rejected.length} (${rejected.slice(0, 5).map((r) => `#${r.index}: ${r.error}`).join(" | ")})` : ""}`;

const PushMetricsLoose = z.object({ rows: z.array(z.unknown()).min(1).max(500), account_id: z.string().trim().min(1).max(64).optional() }).strict();
const PushMetricsAdvert = z
  .object({
    rows: z.array(MetricRow).min(1).max(500).describe("صفوف الأرقام. كل صف: التاريخ + المستوى + الرقم + أي أرقام عندك. الصف اللي فيه غلط بينرفض لحاله وباقي الصفوف بتنحفظ."),
    account_id: z.string().trim().min(1).max(64).optional().describe("الحساب الإعلاني act_… إذا الصفوف ما فيها account_id"),
  })
  .strict();

export const TOOLS: ToolDef<McpCtx>[] = [
  {
    name: "push_metrics",
    title: "ابعت أرقام الإعلانات",
    description:
      "ابعت أرقام الإعلانات والطلبات الحقيقية اللي قريتها من مدير الإعلانات والـ OMS. كل صف = عنصر (حساب/حملة/مجموعة/إعلان/منتج) بيوم عمل عمّان. أي رقم ما ببعته بيضل متل ما هو، وإعادة البعت لنفس العنصر واليوم بتحدّث ما بتكرر. صف الإعلان: عدّاد طلباته الحقيقية (real_orders, confirmed, delivered…). صف المنتج (level=product): يوم المنتج الكامل لشاشة «الأرقام» — orders_in · unique_customers · confirmed · rejected · cancelled · waiting · reject_reasons · shipped_orders · shipped_pieces · out_for_delivery · delivered · returned · stuck · revenue_shipped · offer_breakdown · aov · stock_units (+ الصرف والـ pixel_purchases إذا عندك). الموقع بيحسب كل النسب لحاله — لا تبعت نسب. ممنوع أي بيانات زبون (اسم/هاتف/عنوان) — الصف بينرفض.",
    input: PushMetricsLoose,
    listSchema: PushMetricsAdvert,
    readOnly: false,
    run: async (a, ctx) => {
      const { rows, account_id } = a as z.infer<typeof PushMetricsLoose>;
      const r = await applyMetrics(rows, { actor: ctx.actor, source: "mcp", accountId: account_id });
      return ok(reportText("الأرقام", r.applied, r.rejected) + (r.warnings.length ? ` · تنبيه: ${r.warnings.join(" | ")}` : ""), { ...r });
    },
  },
  {
    name: "push_stock",
    title: "ابعت المخزون",
    description: "ابعت مخزون كل منتج وأيام التغطية. لما التغطية تنزل تحت حدود المخزون (🔴🟠🟡 بالقواعد) بيطلع تنبيه تلقائي للمالك وعبدالله ومحمد.",
    input: looseRows(100),
    listSchema: rowsOf(StockRow, 100, "صف لكل منتج"),
    readOnly: false,
    run: async (a, ctx) => {
      const r = await applyStock((a as { rows: unknown[] }).rows, { actor: ctx.actor, source: "mcp" });
      return ok(reportText("المخزون", r.applied, r.rejected) + (r.alerts ? ` · طلع ${r.alerts} تنبيه` : ""), { ...r });
    },
  },
  {
    name: "push_videos",
    title: "ابعت بنك الفيديوهات",
    description: "ابعت صفوف بنك الفيديوهات: رقم الـ JOB، اسم الفيديو (V…)، المنتج، رقم ملف Drive، رقم ملف السيناريو (scenario_file_id)، رقم فيديو ميتا، والحالة. بتتحدّث بنفس (JOB + الاسم). ممنوع تعديل الفيديوهات نفسها.",
    input: looseRows(300),
    listSchema: rowsOf(VideoRow, 300, "صف لكل فيديو"),
    readOnly: false,
    run: async (a, ctx) => {
      const r = await applyVideos((a as { rows: unknown[] }).rows, { actor: ctx.actor, source: "mcp" });
      return ok(reportText("الفيديوهات", r.applied, r.rejected), { ...r });
    },
  },
  {
    name: "log_run",
    title: "سجّل تشغيل",
    description:
      "سجّل تشغيل مهمة (مفتاح الورك فلو). بأول البدء ابعت status=running مع ref ثابت، وبعدين حدّث الخطوات (node/nodes) وبالآخر ok أو failed مع summary سطر وحد وأرقام. الورك فلو عند المالك بيتحرك لحظياً (الخطوط والخطوات). الجواب بيقلك إذا المالك طفّا هالمهمة (enabled=false) — وقتها وقّف.",
    input: LogRunInput,
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const r = await logRun(a as z.infer<typeof LogRunInput>, ctx.actor, "mcp");
        const note = r.workflow.enabled ? "" : " ⚠️ المالك طفّا هالورك فلو (enabled=false) — لا تكمّل.";
        return ok(`${r.created ? "سُجّل" : "تحدّث"} تشغيل «${r.workflow.name}» — ${r.run.status}.${note}`, { run: r.run, workflow: r.workflow });
      } catch (e) {
        if (e instanceof UnknownJob) return fail(`المفتاح مش معروف. المفاتيح: ${e.known.join("، ")}. أو ابعت create_if_missing=true لورك فلو جديد.`);
        if (e instanceof RunRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "request_approval",
    title: "اطلب موافقة المالك",
    description:
      "اطلب قرار من المالك: عنوان، سطر ليش، الأرقام الأساسية، المبلغ، الخيارات، والاستعجال (red بيرنّ التلفون وهو صاحي · orange إشعار بصوت · yellow صامت بـ «اليوم»). ابعت ref ثابت حتى ما يتكرر الطلب لو أعدت المحاولة. الجواب فيه رقم الطلب؛ اقرأ القرار بعدين بـ get_approvals ونفّذ بالتشغيل الجاي. ما بتنفّذ أي صرف قبل ما يوافق.",
    input: ApprovalInput,
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const r = await requestApproval(a as z.infer<typeof ApprovalInput>, ctx.actor);
        const how = { ring: "رنّ التلفون", notify: "إشعار بصوت", silent: "صامت (بيظهر بـ اليوم)", queue: "المالك نايم — بيطلع بكرت صباح الخير", already: "موجود من قبل (نفس الـ ref)" }[r.delivery];
        return ok(`${r.created ? "انبعت" : "الطلب موجود"}: «${r.approval.title}» — ${how}. رقمه ${r.approval.id}`, { approval: r.approval, delivery: r.delivery });
      } catch (e) {
        if (e instanceof Refused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "get_approvals",
    title: "اقرا قرارات المالك",
    description: "اقرا الطلبات المفتوحة وقرارات آخر 48 ساعة: approved (موافق) · rejected (رفض) · postponed (مأجّل لـ postponed_until) · cancelled (ألغاه) · expired (انتهى بلا جواب) · pending (لسا). نفّذ جوّا القواعد بس على اللي انوافق عليه، ولا تعيد طلب انرفض.",
    input: z
      .object({
        status: z.array(z.enum(APPROVAL_STATUSES)).max(6).optional(),
        ids: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
        since: z.string().trim().min(8).max(40).optional().describe("وقت ISO — بس اللي تغيّر بعده"),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    readOnly: true,
    run: async (a) => {
      const i = a as { status?: string[]; ids?: string[]; since?: string; limit?: number };
      const since = i.since ? new Date(i.since) : undefined;
      if (since && Number.isNaN(since.getTime())) return fail("since: وقت مش صحيح");
      const list = await listApprovals({ status: i.status, ids: i.ids, since, limit: i.limit });
      return ok(`${list.length} طلب`, { approvals: list });
    },
  },
  {
    name: "notify",
    title: "نبّه",
    description: "تنبيه ما بيوقف شغلك: 🔴 red · 🟠 orange · 🟡 yellow، ولمين (owner أو abdullah أو mohammad…). الأحمر والبرتقالي بيطلعوا على تيليجرام لما المالك صاحي؛ الأصفر بيظهر بـ «اليوم» بس. ابعت key ثابت حتى ما يتكرر نفس التنبيه.",
    input: z
      .object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(600).optional(),
        urgency: z.enum(["red", "orange", "yellow"]),
        audience: z.string().trim().min(1).max(30).optional().describe("الافتراضي owner"),
        href: z.string().trim().max(200).optional().describe("مسار بالموقع، مثلاً /ads"),
        key: z.string().trim().min(1).max(100).optional().describe("نفس المفتاح = نفس التنبيه"),
      })
      .strict(),
    readOnly: false,
    run: async (a) => {
      const i = a as { title: string; body?: string; urgency: "red" | "orange" | "yellow"; audience?: string; href?: string; key?: string };
      const refusal = refuseIfPrivate(i.title, i.body);
      if (refusal) return fail(refusal);
      if (i.href && !i.href.startsWith("/")) return fail("href: مسار داخلي بيبدأ بـ /");
      const n = await createNotification({ ...i, source: "mcp" });
      const d = n.created ? await dispatchNotification(n.id) : { delivered: true, reason: "موجود من قبل" };
      return ok(`${n.created ? "انحفظ" : "موجود"} التنبيه — ${d.delivered ? "وصل" : (d.reason ?? "ما انبعت")}`, { id: n.id, created: n.created, delivered: d.delivered, reason: "reason" in d ? d.reason : undefined });
    },
  },
  {
    name: "get_mode",
    title: "المالك صاحي ولا نايم؟",
    description: "اقراها قبل أي شي بدو المالك: صاحي (awake) أو نايم (asleep)، وقائمة «صلاحيات الليل» (المهام المسموحة وهو نايم مع سقف كل وحدة). وهو نايم: لا ترنّ، وأي شي بدو موافقته بيستنى للصبح إلا لو نوعه (kind) من اللي بيصحّوه.",
    input: z.object({}).strict(),
    readOnly: true,
    run: async () => {
      const m = await currentMode();
      const queued = await db.approval.count({ where: { status: "pending" } });
      return ok(m.mode === "awake" ? "المالك صاحي" : "المالك نايم — لا ترنّ", { mode: m.mode, switch: m.switch, since: m.since, schedule: m.schedule, night_permissions: m.nightPermissions, wake_kinds: m.wakeKinds, pending_approvals: queued });
    },
  },
  {
    name: "get_rules",
    title: "قواعد الحملات",
    description: "القواعد الحالية (الإصدار الأخير دايماً): الأرقام والنصوص الـ 14. اقراها بأول كل تشغيل. إذا في أرقام ناقصة (missing) قول للمالك بدل ما تخمّن — وما تنفّذ قاعدة رقمها ناقص.",
    input: z.object({}).strict(),
    readOnly: true,
    run: async () => {
      const r = await getRules();
      return ok(`القواعد v${r.version}${r.missing.length ? ` — ناقص ${r.missing.length} رقم` : ""}`, { version: r.version, updated_at: r.updatedAt, rules: r.rules, text: r.text, missing: r.missing });
    },
  },
  {
    name: "list_tasks",
    title: "المهام",
    description: "اقرا المهام: بالحالة (new · doing · waiting_approval · stalled · done)، المسؤول، اللوحة. المهام المؤرشفة ما بتطلع.",
    input: z.object({ status: z.array(z.enum(TASK_STATUSES)).max(5).optional(), assignee: z.string().trim().min(1).max(40).optional(), board: z.string().trim().min(1).max(40).optional(), limit: z.number().int().min(1).max(300).optional() }).strict(),
    readOnly: true,
    run: async (a) => {
      const list = await listTasks(a as Parameters<typeof listTasks>[0]);
      return ok(`${list.length} مهمة`, { tasks: list });
    },
  },
  {
    name: "update_task",
    title: "حرّك مهمة",
    description: "غيّر حالة مهمة أو مسؤولها أو موعدها، أو أرشفها (archived=true — ما بتنحذف أبداً).",
    input: TaskUpdateInput,
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const t = await updateTask(a as z.infer<typeof TaskUpdateInput>, ctx.actor);
        return t ? ok(`تحدّثت «${t.title}» — ${t.status}`, { task: t }) : fail("المهمة مش موجودة");
      } catch (e) {
        if (e instanceof TaskRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "create_task",
    title: "مهمة جديدة",
    description: "أنشئ مهمة (مثلاً طلب هوكات من هيرمز أو دفعة فيديوهات من ليث) مع مسؤول وموعد وربط (link_type/link_id). تتبّع الطلب بعدها بـ update_task.",
    input: TaskCreateInput,
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const t = await createTask(a as z.infer<typeof TaskCreateInput>, ctx.actor, "mcp");
        return ok(`انعملت مهمة «${t.title}»`, { task: t });
      } catch (e) {
        if (e instanceof TaskRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "get_handoffs",
    title: "شو مسلَّم إلك؟",
    description:
      "اقرا طابور التسليم: شغل المالك ضغط عليه «شغّل هلق»، أو خطوة وقفت وبدها حدا يكمّلها. كل بند فيه شو المطلوب والخطوات والمدخلات وآخر خطأ ومعرّف التشغيل (run_ref). الافتراضي: المفتوح والمأخود المسلَّم لـ Claude. اقراها بأول كل تشغيل وبين المهام.",
    input: z
      .object({
        assignee: z.string().trim().min(1).max(40).optional().describe("الافتراضي claude (كل أنواع Claude). أو hermes · muse · مفتاح شخص"),
        status: z.array(z.enum(HANDOFF_STATUSES)).max(4).optional().describe("الافتراضي open + claimed"),
        workflow: z.string().trim().min(1).max(60).optional(),
      })
      .strict(),
    readOnly: true,
    run: async (a) => {
      const q = a as { assignee?: string; status?: (typeof HANDOFF_STATUSES)[number][]; workflow?: string };
      const list = await listHandoffs({ assignee: q.assignee ?? "claude", status: q.status, workflow: q.workflow });
      return ok(list.length ? `في ${list.length} مسلَّم: ${list.slice(0, 5).map((h) => `«${h.title}» (${h.workflowKey})`).join("، ")}` : "ما في شي مسلَّم هلأ.", { handoffs: list });
    },
  },
  {
    name: "claim_handoff",
    title: "خذ تسليم",
    description: "خذ تسليم قبل ما تبلّش فيه — الورك فلو بيصير «عم يشتغل» والمالك بيشوف إنه عندك. اللي أخدها قبلك بيجيك خطأ.",
    input: z.object({ id: z.string().trim().min(1).max(40) }).strict(),
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const h = await claimHandoff((a as { id: string }).id, ctx.tokenName, ctx.actor);
        return ok(`أخدت «${h.title}». نفّذ الخطوات وسجّلها بـ log_run (job=${h.workflowKey}, ref=${h.runRef}) وبعدين complete_handoff.`, { handoff: h });
      } catch (e) {
        if (e instanceof HandoffRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "complete_handoff",
    title: "جاوب تسليم",
    description:
      "جاوب تسليم: سطر شو انعمل (note) وأرقام النتيجة (result). تشغيل طلبه المالك بيخلص (ok) بالجواب؛ خطوة واقفة بتتفكّ وتكمّل إنت (أو قول run_status=ok/failed). ما في صرف ولا موافقة هون — اللي بدو موافقة المالك بيروح request_approval.",
    input: HandoffComplete.extend({ id: z.string().trim().min(1).max(40) }).strict(),
    readOnly: false,
    run: async (a, ctx) => {
      const { id, ...rest } = a as { id: string } & z.infer<typeof HandoffComplete>;
      try {
        const r = await completeHandoff(id, rest, ctx.tokenName, ctx.actor);
        return ok(`انجاوب «${r.handoff.title}» — التشغيل ${r.run?.status ?? "—"}.`, { handoff: r.handoff, run: r.run });
      } catch (e) {
        if (e instanceof HandoffRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "create_handoff",
    title: "سلّم شغلة",
    description:
      "إذا خطوة وقفت (فشلت، انتهت مهلتها، ناقصها ربط، بدها جواب) ولا تقدر تكمّلها: سلّمها بدل ما تخليها تضيع — مع شو المطلوب بالضبط، آخر خطأ، والمدخلات (بلا بيانات زبائن). بتظهر عند المالك «متوقف — Claude بيكمّلها» وبيقدر يعطيها لحدا تاني.",
    input: HandoffCreate,
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const r = await createHandoff(a as z.infer<typeof HandoffCreate>, ctx.actor);
        return ok(`${r.created ? "انسلّمت" : "موجودة من قبل"}: «${r.handoff.title}» لـ ${r.handoff.assigneeLabel}. رقمها ${r.handoff.id}`, { handoff: r.handoff });
      } catch (e) {
        if (e instanceof UnknownJob) return fail(`المفتاح مش معروف. المفاتيح: ${e.known.join("، ")}`);
        if (e instanceof HandoffRefused || e instanceof RunRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "get_video_requests",
    title: "شو مطلوب من الفيديوهات؟",
    description:
      "اقرا طلبات الفيديوهات (هوكات جديدة، سيناريو جديد، فيديو للتيست، فيديو تعبان) اللي المالك أو الكود طلبها وبانتظار هيرمز. كل طلب فيه JOB الفيديو وملف السيناريو وأرقامه. الافتراضي: المطلوبة والعند هيرمز. بدل REST: نفس الطابور.",
    input: z
      .object({
        status: z.array(z.enum(REQUEST_STATUSES)).max(6).optional().describe("الافتراضي asked + with_hermes"),
        product: z.string().trim().min(1).max(40).optional().describe("رمز المنتج"),
      })
      .strict(),
    readOnly: true,
    run: async (a) => {
      const q = a as { status?: (typeof REQUEST_STATUSES)[number][]; product?: string };
      const list = await listVideoRequests({ status: q.status ?? ["asked", "with_hermes"], product: q.product });
      return ok(list.length ? `في ${list.length} طلب فيديو: ${list.slice(0, 5).map((r) => `«${r.kindLabel}: ${r.label}»`).join("، ")}` : "ما في طلبات فيديو هلأ.", { requests: list });
    },
  },
  {
    name: "claim_video_request",
    title: "خذ طلب فيديو",
    description: "خذ طلب فيديو قبل ما تبلّش — بيصير «عند هيرمز» باسمك. اللي أخده قبلك بيجيه خطأ.",
    input: z.object({ id: z.string().trim().min(1).max(40) }).strict(),
    readOnly: false,
    run: async (a, ctx) => {
      try {
        const r = await claimVideoRequest((a as { id: string }).id, ctx.tokenName, ctx.actor);
        return ok(`أخدت «${r.kindLabel}: ${r.label}». لما تخلص: complete_video_request.`, { request: r });
      } catch (e) {
        if (e instanceof HandoffRefused) return fail(e.message);
        throw e;
      }
    },
  },
  {
    name: "complete_video_request",
    title: "جاوب طلب فيديو",
    description: "جاوب طلب فيديو: سطر شو انعمل (note)، أرقام النتيجة (result)، والفيديوهات اللي طلعت (new_videos: job · v_name · ملف الفيديو والسيناريو) — بتنضاف للبنك «جاهز». ما في صرف ولا ميتا هون.",
    input: VideoRequestComplete.extend({ id: z.string().trim().min(1).max(40) }).strict(),
    readOnly: false,
    run: async (a, ctx) => {
      const { id, ...rest } = a as { id: string } & z.infer<typeof VideoRequestComplete>;
      try {
        const r = await completeVideoRequest(id, rest, ctx.tokenName, ctx.actor);
        return ok(`انجاوب «${r.kindLabel}: ${r.label}» — ${r.statusLabel}.`, { request: r });
      } catch (e) {
        if (e instanceof HandoffRefused) return fail(e.message);
        throw e;
      }
    },
  },
];

/** What every client is told on connecting: how to work with this server. */
export const SERVER_INSTRUCTIONS = [
  "هاد سيرفر الميديا باير. ابعتله الأرقام اللي قريتها (push_metrics · push_stock · push_videos)، وسجّل كل تشغيل (log_run)، واسأل المالك (request_approval) واقرا جوابه (get_approvals).",
  "قبل أي شي بدو المالك: get_mode (صاحي/نايم). وبأول كل تشغيل: get_rules — اشتغل على آخر نسخة، وإذا رقم ناقص قول للمالك ولا تخمّن.",
  "لا بتبعت أبداً اسم زبون أو هاتفه أو عنوانه (بينرفض). الصرف والتصنيع ورفع السقف وأي شي برّا القواعد: قرار المالك — اطلبه بـ request_approval ولا تنفّذه قبل ما يوافق.",
  "المالك بيضغط «شغّل هلق» على ورك فلو، وأي خطوة بتوقف: بتنزل بطابور التسليم. اقرا get_handoffs بأول كل تشغيل، خذ البند (claim_handoff)، نفّذه وسجّله بـ log_run، وجاوب بـ complete_handoff. خطوة وقفت عندك: create_handoff بدل ما تخليها.",
  "طلبات الفيديوهات (هوكات · سيناريو · تيست · فيديو تعبان): get_video_requests ← claim_video_request ← complete_video_request (مع new_videos لما يطلع فيديو جاهز).",
  "كل نداء مسجّل. استعمل ref/key ثابت حتى لو أعدت المحاولة ما يتكرر شي.",
].join("\n");

