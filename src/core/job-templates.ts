/**
 * THE SIX TEMPLATES of «مهمة جديدة ← من قالب» (v6 · P4-1, docs/rebuild-v6/02-screens.md §3.7): six drafts that are already half built. A press on one opens «ركّبها» filled in, and
 * the owner changes what he wants. They carry no number, no name of a person and no rule of the owner's — only the shape of the work. Pure: the clock is a parameter.
 */
import { addDays, ammanKey } from "./dates";
import { DEFAULT_NOTIFY, emptyDraft, endOfDay, suggestName, type JobDraft } from "./job-draft";

export const TEMPLATE_KEYS = ["round", "check", "watch", "daily_report", "remind", "videos"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface JobTemplate {
  key: TemplateKey;
  title: string;
  /** the line under the title on the tile */
  hint: string;
  build: (now: Date) => JobDraft;
}

/** Tomorrow on the Amman clock (a one-time template starts with a day that has not passed). */
const tomorrow = (now: Date) => addDays(ammanKey(now), 1);

const make = (d: Omit<JobDraft, "name" | "notifyOn"> & { notifyOn?: JobDraft["notifyOn"] }): JobDraft => {
  const draft = emptyDraft({ ...d, notifyOn: d.notifyOn ?? [...DEFAULT_NOTIFY] });
  return { ...draft, name: suggestName(draft.steps) };
};

export const JOB_TEMPLATES: readonly JobTemplate[] = [
  {
    key: "round",
    title: "جولة بموعد",
    hint: "اقرا ← قرّر ← نفّذ ← بلّغ",
    build: (now) =>
      make({
        domain: "ads",
        assigneeKey: "claude",
        when: { kind: "daily", time: "09:30" },
        steps: [
          { verb: "read", text: "اقرا أرقام اليوم" },
          { verb: "decide", text: "إذا في شي بيحتاج إجراء", elseGoto: 3 },
          { verb: "do", text: "نفّذ اللي بتسمح فيه القواعد" },
          { verb: "tell", text: "بلّغني بالنتيجة" },
        ],
      }),
  },
  {
    key: "check",
    title: "فحص وتنبيه",
    hint: "اقرا ← إذا تحت الحد ← بلّغ",
    build: (now) =>
      make({
        domain: "ops",
        assigneeKey: "claude",
        when: { kind: "daily", time: "09:30" },
        steps: [
          { verb: "read", text: "اقرا المخزون" },
          { verb: "decide", text: "إذا منتج تحت حد الأمان" },
          { verb: "tell", text: "بلّغني باسم المنتج وكم باقي" },
        ],
      }),
  },
  {
    key: "watch",
    title: "مراقبة لفترة",
    hint: "كل ساعتين لآخر اليوم",
    build: (now) =>
      make({
        domain: "ads",
        assigneeKey: "claude",
        when: { kind: "window", everyHours: 2, until: endOfDay(now) },
        steps: [
          { verb: "read", text: "اقرا الرقم اللي بدك تراقبه" },
          { verb: "compare", text: "قارنه بالمرة اللي قبل" },
          { verb: "tell", text: "بلّغني لو تغيّر كتير" },
        ],
      }),
  },
  {
    key: "daily_report",
    title: "تقرير يومي",
    hint: "اجمع ← اكتب ← ابعت",
    build: (now) =>
      make({
        domain: "ads",
        assigneeKey: "claude",
        when: { kind: "daily", time: "21:00" },
        steps: [
          { verb: "read", text: "اجمع أرقام اليوم" },
          { verb: "do", text: "اكتب تقرير قصير" },
          { verb: "tell", text: "ابعت التقرير" },
        ],
      }),
  },
  {
    key: "remind",
    title: "تذكير شخص",
    hint: "بوقت محدد، مرة وحدة",
    build: (now) =>
      make({
        domain: "ops",
        // the person is the owner's to choose: no name is guessed
        assigneeKey: "",
        when: { kind: "once", date: tomorrow(now), time: "10:00" },
        steps: [{ verb: "do", text: "اكتب شو لازم ينعمل" }],
      }),
  },
  {
    key: "videos",
    title: "طلب فيديوهات",
    hint: "لهيرمز أو لفريق الإنتاج",
    build: (now) =>
      make({
        domain: "ads",
        assigneeKey: "hermes",
        when: { kind: "now" },
        steps: [
          { verb: "ask", text: "اطلب فيديوهات جديدة للمنتج (اكتب اسمه)" },
          { verb: "wait_me", text: "استنى موافقتي قبل ما ينرفعوا" },
          { verb: "tell", text: "بلّغني لما يجهزوا" },
        ],
      }),
  },
];

/** The draft a template starts from (null for a key that is not one of the six). */
export function templateDraft(key: string, now: Date): JobDraft | null {
  return JOB_TEMPLATES.find((t) => t.key === key)?.build(now) ?? null;
}
