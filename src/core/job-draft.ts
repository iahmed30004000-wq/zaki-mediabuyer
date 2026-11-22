/**
 * THE JOB DRAFT (v6 · P4-1, docs/rebuild-v6/02-screens.md §3.7–§3.8): what the owner builds on «مهمة جديدة» and edits on «تعديل الخطوات», as plain data — before any of it is saved.
 * Everything the screen and the server need to agree on is here, pure and tested: is the draft sound (`validateDraft`), the cron it means (`toCron`), the job it becomes
 * (`draftToJob`), the line of words that says it (`draftSentence`), and the way back from a drawing that already exists (`graphToDraft`).
 *
 * The steps are blocks standing on top of each other (a line, no drawing board): a step is a VERB and a text. The verb decides the kind of node it becomes; the node's label is
 * «<verb>: <text>», which is how the verb comes back out of a drawing. A step that is a «condition» says where «no» goes (`elseGoto`, a later step, or the end).
 * A drawing that is not a plain line (a fork that meets again, a wait on a clock, an orphan) is not understood as one: `graphToDraft` says so and the screen sends the
 * owner to the drawing board, which edits any drawing.
 *
 * Nothing here reads a database or a clock — `now` is always passed in. Nothing here talks to Meta, and no customer's data is in a draft.
 */
import { z } from "zod";
import { addDays, ammanClock, ammanInstant, ammanKey, isKey, keyMs } from "./dates";
import type { JobDomain, JobKind } from "./jobs";
import type { Executor, Permission, WfEdge, WfGraph, WfNode } from "./workflow";
import { autoLayout, graphDiff } from "./workflow-edit";

// ───────────────────────────── the words of the builder ─────────────────────────────

export const VERBS = ["read", "compare", "decide", "do", "wait_me", "tell", "ask"] as const;
export type Verb = (typeof VERBS)[number];

/** The kind of block, as the owner says it (the chips under the steps and the label of every block). */
export const VERB_AR: Record<Verb, string> = { read: "اقرا", compare: "قارن", decide: "قرّر", do: "نفّذ", wait_me: "استنى موافقتي", tell: "بلّغ", ask: "اطلب من حدا" };
/** What the text box of a block says while it is empty. */
export const VERB_HINT: Record<Verb, string> = {
  read: "اكتب شو تقرا",
  compare: "اكتب شو تقارن بشو",
  decide: "إذا…",
  do: "اكتب شو تنفّذ",
  wait_me: "وقّف هون لحد ما أوافق",
  tell: "اكتب مين تبلّغ وشو",
  ask: "اطلب من حدا تاني",
};
/** The chip's own wording («قرّر (إذا)» · «استنى موافقتي»), when it differs from the verb. */
export const VERB_CHIP: Record<Verb, string> = { ...VERB_AR, decide: "قرّر (إذا)" };

export const HOURLY_EVERY = [1, 2, 3, 4, 6] as const;
export type HourlyEvery = (typeof HOURLY_EVERY)[number];

export const NOTIFY_EVENTS = ["done", "stuck", "missed", "failed"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** «إيمتى أخبّرك؟» — the three choices of the fourth question, and what each one rings for. */
export const NOTIFY_PRESETS = [
  { key: "done", label: "لما تخلص", on: ["done", "stuck", "missed", "failed"] as NotifyEvent[], sentence: "بخبّرك لما تخلص أو توقف" },
  { key: "stop", label: "لما توقف أو تفوت", on: ["stuck", "missed", "failed"] as NotifyEvent[], sentence: "بخبّرك لما توقف أو تفوت" },
  { key: "important", label: "بس لو في شي مهم", on: ["missed", "failed"] as NotifyEvent[], sentence: "بخبّرك بس لو في شي مهم" },
] as const;
export type NotifyPresetKey = (typeof NOTIFY_PRESETS)[number]["key"];
export const DEFAULT_NOTIFY: NotifyEvent[] = ["stuck", "missed", "failed"];

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** Which of the three choices a list of events is (null: a list of its own — it came from somewhere else than the builder). */
export const presetOf = (on: readonly string[]): NotifyPresetKey | null => NOTIFY_PRESETS.find((p) => sameSet(p.on, on))?.key ?? null;

export const RECIPES = ["stock_alert", "daily_summary", "remind", "metric_watch"] as const;
export type RecipeName = (typeof RECIPES)[number];

export const MAX_STEPS = 20;
/** The label of a node is at most 120 characters and starts with «<verb>: » (at most 15): what is left is the text. */
export const MAX_STEP_TEXT = 100;
export const MAX_NAME = 120;
/** The key the site itself answers to (the «الموقع لحاله» of the first question): its jobs are recipes. */
export const SITE_KEY = "site";

const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
export const WEEKDAY_AR = DAY_AR;

// ───────────────────────────── the draft ─────────────────────────────

export type When =
  | { kind: "now" }
  | { kind: "once"; date: string; time: string }
  | { kind: "daily"; time: string }
  | { kind: "hourly"; from: string; to: string; everyHours: HourlyEvery }
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "window"; everyHours: HourlyEvery; until: string };
export type WhenKind = When["kind"];
export const WHEN_KINDS: readonly WhenKind[] = ["now", "once", "daily", "hourly", "weekly", "window"];

export interface DraftStep {
  verb: Verb;
  text: string;
  /** only for «قرّر»: where «no» goes — a later step (its place in the list, from 0), or «end» (the default: the job ends) */
  elseGoto?: number | "end";
}

export interface JobDraft {
  /** it is suggested from the first step, and the owner may change it */
  name: string;
  domain: JobDomain;
  /** `Actor.key` — the one who carries it out — or «site» (a recipe) */
  assigneeKey: string;
  when: When;
  steps: DraftStep[];
  notifyOn: NotifyEvent[];
  recipe?: { name: RecipeName; params: Record<string, unknown> };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "الساعة بصيغة 09:30");
const every = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)]);

/** The shape of a draft that comes from outside (the form, the API): nothing else gets in. The MEANING of it (is the time in the past?) is `validateDraft`'s. */
export const JobDraftSchema = z
  .object({
    name: z.string().max(MAX_NAME * 2),
    domain: z.enum(["ads", "ops"]),
    assigneeKey: z.string().max(40),
    when: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("now") }).strict(),
      z.object({ kind: z.literal("once"), date: z.string().max(10), time: z.string().max(5) }).strict(),
      z.object({ kind: z.literal("daily"), time: z.string().max(5) }).strict(),
      z.object({ kind: z.literal("hourly"), from: z.string().max(5), to: z.string().max(5), everyHours: every }).strict(),
      z.object({ kind: z.literal("weekly"), days: z.array(z.number().int()).max(14), time: z.string().max(5) }).strict(),
      z.object({ kind: z.literal("window"), everyHours: every, until: z.string().max(40) }).strict(),
    ]),
    steps: z
      .array(z.object({ verb: z.enum(VERBS), text: z.string().max(MAX_STEP_TEXT * 3), elseGoto: z.union([z.number().int(), z.literal("end")]).optional() }).strict())
      .max(MAX_STEPS),
    notifyOn: z.array(z.enum(NOTIFY_EVENTS)).max(4),
    recipe: z.object({ name: z.enum(RECIPES), params: z.record(z.string(), z.unknown()) }).strict().optional(),
  })
  .strict();

/** The empty draft the builder starts from. */
export function emptyDraft(over: Partial<JobDraft> = {}): JobDraft {
  return { name: "", domain: "ads", assigneeKey: "", when: { kind: "daily", time: "09:30" }, steps: [], notifyOn: [...DEFAULT_NOTIFY], ...over };
}

/** The end of today on the Amman clock (23:59) — or of tomorrow when that is less than half an hour away. An ISO instant. */
export function endOfDay(now: Date): string {
  const today = ammanKey(now);
  const end = ammanInstant(today, "23:59")!;
  return (end.getTime() - now.getTime() > 30 * 60_000 ? end : ammanInstant(addDays(today, 1), "23:59")!).toISOString();
}

/** An instant as the two boxes of a form show it, on the Amman clock («2026-11-23» and «09:30»). Null when it is not an instant. */
export function splitInstant(iso: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const c = ammanClock(at);
  return { date: ammanKey(at), time: `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}` };
}

/** The two boxes of a form (a day and a time on the Amman clock) as one instant (ISO); null while either is not filled in. */
export const joinInstant = (date: string, time: string): string | null => ammanInstant(date, time)?.toISOString() ?? null;

/**
 * A sound `when` of a kind, for the moment the owner presses its tile: tomorrow for a one-time moment, the next day's weekday for a weekly one, the end of the day for a period.
 * The time he already chose (on another tile) is kept when there is one.
 */
export function defaultWhen(kind: WhenKind, now: Date, prev?: When): When {
  const keptTime = prev && "time" in prev ? prev.time : undefined;
  const tomorrow = addDays(ammanKey(now), 1);
  switch (kind) {
    case "now":
      return { kind };
    case "once":
      return { kind, date: tomorrow, time: keptTime ?? "09:00" };
    case "daily":
      return { kind, time: keptTime ?? "09:30" };
    case "hourly":
      return prev?.kind === "hourly" ? prev : { kind, from: "10:00", to: "22:00", everyHours: prev && "everyHours" in prev ? prev.everyHours : 2 };
    case "weekly":
      return { kind, days: [new Date(keyMs(tomorrow)).getUTCDay()], time: keptTime ?? "09:30" };
    case "window":
      return { kind, everyHours: prev && "everyHours" in prev ? prev.everyHours : 2, until: endOfDay(now) };
  }
}

/** The draft as it is saved: texts trimmed, the days in order, «end» left out (it is what no `elseGoto` means), and `elseGoto` only where a step can have one. */
export function normalizeDraft(d: JobDraft): JobDraft {
  const steps: DraftStep[] = d.steps.map((s) => {
    const out: DraftStep = { verb: s.verb, text: s.text.trim() };
    if (s.verb === "decide" && typeof s.elseGoto === "number") out.elseGoto = s.elseGoto;
    return out;
  });
  const when: When = d.when.kind === "weekly" ? { ...d.when, days: [...new Set(d.when.days)].sort((a, b) => a - b) } : d.when;
  return { ...d, name: d.name.trim(), when, steps };
}

/** A name for the job, from its first step: «اقرا المخزون». Empty while no step has a text. */
export function suggestName(steps: readonly DraftStep[]): string {
  const first = steps.find((s) => s.text.trim());
  if (!first) return "";
  return `${VERB_AR[first.verb]} ${first.text.trim()}`.slice(0, 60).trim();
}

// ───────────────────────────── is it sound ─────────────────────────────

export type DraftCheck = { ok: true } | { ok: false; field: string; message: string };
const bad = (field: string, message: string): DraftCheck => ({ ok: false, field, message });

const ACTOR_KEY = /^[a-z][a-z0-9_-]{1,31}$/;
const isHour = (v: unknown): v is string => typeof v === "string" && hhmm.safeParse(v).success;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Is this draft one the site may save? The first thing wrong is returned, with the field it is about (`when.date` · `steps[2].text`) and a sentence for the owner.
 * The checks go in the order of the screen (who · when · steps · who is told · the name), so the first message is about the first thing to fix. A time that has passed is refused («مرة وحدة بالماضي»); so is a step that points backwards. The checks that need the directory (does this person exist?) are the server's.
 */
export function validateDraft(d: JobDraft, now: Date): DraftCheck {
  if (!ACTOR_KEY.test(d.assigneeKey)) return bad("assigneeKey", "اختار مين بدّه يعملها");

  const w = d.when;
  switch (w.kind) {
    case "now":
      break;
    case "once": {
      if (!isKey(w.date)) return bad("when.date", "اختار اليوم");
      if (!isHour(w.time)) return bad("when.time", "اختار الساعة");
      const at = ammanInstant(w.date, w.time);
      if (!at || at.getTime() <= now.getTime()) return bad("when.date", "هالموعد فات — اختار وقت جاي");
      break;
    }
    case "daily":
      if (!isHour(w.time)) return bad("when.time", "اختار الساعة");
      break;
    case "hourly":
      if (!isHour(w.from) || !isHour(w.to)) return bad("when.from", "اختار ساعة البداية وساعة النهاية");
      if (minutesOf(w.from) > minutesOf(w.to)) return bad("when.to", "ساعة النهاية لازم تكون بعد ساعة البداية");
      if (!(HOURLY_EVERY as readonly number[]).includes(w.everyHours)) return bad("when.everyHours", "اختار كل قديش");
      break;
    case "weekly":
      if (!Array.isArray(w.days) || !w.days.length) return bad("when.days", "اختار يوم على الأقل");
      if (w.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) return bad("when.days", "يوم مش مفهوم");
      if (!isHour(w.time)) return bad("when.time", "اختار الساعة");
      break;
    case "window": {
      if (!(HOURLY_EVERY as readonly number[]).includes(w.everyHours)) return bad("when.everyHours", "اختار كل قديش");
      const until = Date.parse(w.until);
      if (Number.isNaN(until)) return bad("when.until", "اختار متى بتخلص");
      if (until <= now.getTime()) return bad("when.until", "نهاية الفترة فاتت — اختار وقت جاي");
      break;
    }
    default:
      return bad("when", "اختار إيمتى");
  }

  if (d.assigneeKey === SITE_KEY && !d.recipe) return bad("assigneeKey", "الموقع لحاله بينفّذ وصفاته الجاهزة بس — اختار وصفة أو اختار حدا تاني");
  if (d.recipe) {
    if (d.assigneeKey !== SITE_KEY) return bad("recipe", "الوصفة بينفّذها الموقع لحاله");
    if (!(RECIPES as readonly string[]).includes(d.recipe.name)) return bad("recipe", "وصفة مش معروفة");
  } else if (!d.steps.length) return bad("steps", "ضيف خطوة وحدة على الأقل");

  const steps = validateSteps(d.steps);
  if (!steps.ok) return steps;
  if (!Array.isArray(d.notifyOn) || d.notifyOn.some((e) => !(NOTIFY_EVENTS as readonly string[]).includes(e))) return bad("notifyOn", "إيمتى أخبّرك؟ اختار واحد من الثلاثة");
  // the name and the kind come last: they are the last panel of the screen, and the name is suggested from the steps, so a draft with no steps is told about the steps first
  if (!d.name.trim()) return bad("name", "اكتب اسم للمهمة");
  if (d.name.trim().length > MAX_NAME) return bad("name", `الاسم لحد ${MAX_NAME} حرف`);
  if (d.domain !== "ads" && d.domain !== "ops") return bad("domain", "اختار نوعها: إعلانات أو فريق وتشغيل");
  return { ok: true };
}

/** The steps of a draft alone (the edit screen has no «when» and no name): at most 20, each with a verb and a text, and a «no» that only skips forward. An empty list is allowed here — a recipe has none. */
export function validateSteps(steps: readonly DraftStep[]): DraftCheck {
  if (steps.length > MAX_STEPS) return bad("steps", `لحد ${MAX_STEPS} خطوة`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const at = `steps[${i}]`;
    if (!(VERBS as readonly string[]).includes(s.verb)) return bad(`${at}.verb`, `الخطوة ${i + 1}: نوع مش مفهوم`);
    const text = s.text.trim();
    if (!text) return bad(`${at}.text`, `اكتب نص الخطوة ${i + 1}`);
    if (text.length > MAX_STEP_TEXT) return bad(`${at}.text`, `نص الخطوة ${i + 1} لحد ${MAX_STEP_TEXT} حرف`);
    if (s.elseGoto !== undefined) {
      if (s.verb !== "decide") return bad(`${at}.elseGoto`, `الخطوة ${i + 1}: «وإلا» بس لخطوة «قرّر»`);
      // the next step is where «yes» goes: «no» must skip at least one, and never go back
      if (s.elseGoto !== "end" && (!Number.isInteger(s.elseGoto) || s.elseGoto <= i + 1 || s.elseGoto >= steps.length)) return bad(`${at}.elseGoto`, `الخطوة ${i + 1}: «وإلا» لازم تروح لخطوة بعد اللي بعدها، أو للنهاية`);
    }
  }
  return { ok: true };
}

// ───────────────────────────── when → cron ─────────────────────────────

/** The minute a window starts at: a few minutes after the draft is saved, so the first run is not already in the past when the clock looks. */
export const WINDOW_START_LEAD_MIN = 5;

/**
 * The cron (five fields, Amman clock) a «when» means; null for «now» and «once» (they have a moment, not a cron). A window needs `now`: it runs every N hours
 * counted from a few minutes after the draft is saved, and its end is the job's `endsAt`. A `when` that fails `validateDraft` has no cron (null).
 */
export function toCron(when: When, now: Date): string | null {
  switch (when.kind) {
    case "now":
    case "once":
      return null;
    case "daily": {
      if (!isHour(when.time)) return null;
      const [h, m] = [Number(when.time.slice(0, 2)), Number(when.time.slice(3, 5))];
      return `${m} ${h} * * *`;
    }
    case "hourly": {
      if (!isHour(when.from) || !isHour(when.to) || !(HOURLY_EVERY as readonly number[]).includes(when.everyHours)) return null;
      const from = minutesOf(when.from);
      const span = minutesOf(when.to) - from;
      if (span < 0) return null;
      const fromHour = Math.floor(from / 60);
      // the last hour that still fits before the end (from 10:30 to 22:00 every 2: 10:30 … 20:30, not 22:30)
      const lastHour = fromHour + Math.floor(span / (when.everyHours * 60)) * when.everyHours;
      const hours = lastHour === fromHour ? `${fromHour}` : when.everyHours === 1 ? `${fromHour}-${lastHour}` : `${fromHour}-${lastHour}/${when.everyHours}`;
      return `${from % 60} ${hours} * * *`;
    }
    case "weekly": {
      if (!isHour(when.time) || !Array.isArray(when.days) || !when.days.length || when.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) return null;
      const days = [...new Set(when.days)].sort((a, b) => a - b).join(",");
      return `${Number(when.time.slice(3, 5))} ${Number(when.time.slice(0, 2))} * * ${days}`;
    }
    case "window": {
      if (!(HOURLY_EVERY as readonly number[]).includes(when.everyHours)) return null;
      const start = ammanClock(new Date(now.getTime() + WINDOW_START_LEAD_MIN * 60_000));
      // 1, 2, 3, 4 and 6 all divide 24: the same hours come round every day
      const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => (h - start.hour) % when.everyHours === 0);
      return `${start.minute} ${when.everyHours === 1 ? "*" : hours.join(",")} * * *`;
    }
  }
}

const everyWords = (n: number) => (n === 1 ? "كل ساعة" : n === 2 ? "كل ساعتين" : `كل ${n} ساعات`);

/** «كل يوم 09:30» — the schedule in the owner's words, with the clock the way he types it (24 hours). */
export function whenWords(when: When): string {
  switch (when.kind) {
    case "now":
      return "هلق";
    case "once": {
      const day = isKey(when.date) ? DAY_AR[new Date(keyMs(when.date)).getUTCDay()] : "";
      return `مرة وحدة: ${day} ${when.date} ${when.time}`.replace(/\s+/g, " ").trim();
    }
    case "daily":
      return `كل يوم ${when.time}`;
    case "hourly":
      return `${everyWords(when.everyHours)} من ${when.from} لـ${when.to}`;
    case "weekly": {
      const days = [...new Set(when.days)].sort((a, b) => a - b);
      if (days.length === 7) return `كل يوم ${when.time}`;
      return `كل ${days.map((x) => DAY_AR[x] ?? "").join(" و")} ${when.time}`;
    }
    case "window": {
      const at = new Date(when.until);
      if (Number.isNaN(at.getTime())) return `${everyWords(when.everyHours)} لفترة`;
      const c = ammanClock(at);
      return `${everyWords(when.everyHours)} لحد ${ammanKey(at)} ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
    }
  }
}

const countWords = (n: number) => (n === 1 ? "خطوة وحدة" : n === 2 ? "خطوتين" : n <= 10 ? `${n} خطوات` : `${n} خطوة`);

/** What the events the owner chose mean, in one clause: «بخبّرك لما توقف أو تفوت». */
export function notifyWords(on: readonly string[]): string {
  const key = presetOf(on);
  if (key) return NOTIFY_PRESETS.find((p) => p.key === key)!.sentence;
  return on.length ? "بخبّرك حسب اللي اخترته" : "بلا إشعارات";
}

/** «الموقع لحاله · كل يوم 09:30 · 3 خطوات · بخبّرك لما توقف أو تفوت» — the bar under the builder. `names` turns a key into the name the team directory shows. */
export function draftSentence(d: JobDraft, names: Readonly<Record<string, string>> = {}): string {
  const who = d.assigneeKey === SITE_KEY ? "الموقع لحاله" : (names[d.assigneeKey] ?? d.assigneeKey);
  const steps = d.recipe ? "وصفة جاهزة" : countWords(d.steps.length);
  return [who || "مين؟", whenWords(d.when), steps, notifyWords(d.notifyOn)].join(" · ");
}

// ───────────────────────────── draft → job ─────────────────────────────

const AGENT_KEYS = ["hermes", "muse"];

/** The executor (the old word for «who carries it out») that goes with an assignee. `kind` is what the directory says about it; without it the keys the code has always known decide. */
export function executorOfAssignee(key: string, kind?: "agent" | "person"): Executor {
  if (key === SITE_KEY) return "system";
  if (key.startsWith("claude")) return "claude_mcp";
  if (AGENT_KEYS.includes(key)) return key as Executor;
  return kind === "agent" ? "claude_mcp" : "person";
}

/** Which a verb makes: a step · a condition · an approval gate · a notification. */
const NODE_OF: Record<Verb, WfNode["type"]> = { read: "step", compare: "step", decide: "condition", do: "step", wait_me: "approval", tell: "notify", ask: "step" };
/** The permission badge of a step by its verb: what it reads is free; what it does runs inside the rules; a gate needs the owner's yes. */
const PERMISSION_OF: Record<Verb, Permission> = { read: "green", compare: "green", decide: "green", do: "yellow", wait_me: "red", tell: "green", ask: "green" };
const VERB_OF_TYPE: Partial<Record<WfNode["type"], Verb>> = { step: "do", condition: "decide", approval: "wait_me", notify: "tell" };

const labelOf = (s: DraftStep) => `${VERB_AR[s.verb]}: ${s.text.trim()}`;
const PREFIX = new RegExp(`^(${VERBS.map((v) => VERB_AR[v]).join("|")}): (.+)$`, "s");

/** The step a node is: the verb written in its label when the node is the kind that verb makes, else the verb of its kind («نفّذ» for a plain step) and the whole label as the text. */
export function nodeToStep(n: WfNode): DraftStep | null {
  const hit = PREFIX.exec(n.label);
  const verb = (VERBS as readonly string[]).find((v) => VERB_AR[v as Verb] === hit?.[1]) as Verb | undefined;
  if (verb && NODE_OF[verb] === n.type) return { verb, text: hit![2]!.trim() };
  const plain = VERB_OF_TYPE[n.type];
  return plain ? { verb: plain, text: n.label.trim() } : null;
}

function freshNode(s: DraftStep, id: string, executor: Executor): WfNode {
  const type = NODE_OF[s.verb];
  return {
    id,
    type,
    label: labelOf(s),
    executor: s.verb === "ask" ? "person" : executor,
    ...(type === "step" ? { dataSource: s.verb === "ask" ? ("manual" as const) : ("mcp" as const) } : {}),
    permission: PERMISSION_OF[s.verb],
    ...(type === "approval" ? { destination: "المهام ← بدها موافقتك" } : {}),
  };
}

/** Which steps of an existing drawing a draft keeps: `ids[i]` is the node the i-th block came from (null for a block that is new). */
export interface KeepSteps {
  base: WfGraph;
  ids: readonly (string | null)[];
}

/**
 * The drawing of a draft's steps: a trigger, then a node per step in a line. «قرّر» has a «نعم» line to the step after it and a «لا» line to its `elseGoto` (none: the job ends).
 * With `keep` (editing a drawing that exists) a block that came from a node and was not changed IS that node (its id, its executor, its permission, its switch);
 * a block whose text or verb changed keeps the node's id and what is still true of it; a new block takes the first free `s<n>`.
 */
export function draftGraph(steps: readonly DraftStep[], opts: { executor: Executor; triggerLabel: string; keep?: KeepSteps }): WfGraph {
  const { executor, keep } = opts;
  const byId = new Map(keep?.base.nodes.map((n) => [n.id, n]));
  const used = new Set<string>(keep ? keep.base.nodes.map((n) => n.id) : []);
  const keptTrigger = keep?.base.nodes.find((n) => n.type === "trigger");
  const trigger: WfNode = keptTrigger ?? { id: "start", type: "trigger", label: opts.triggerLabel.slice(0, 120), executor: "system", permission: "green" };
  let counter = 0;
  const nextId = () => {
    let id: string;
    do id = `s${++counter}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  const nodes: WfNode[] = [trigger];
  const ids: string[] = [];
  steps.forEach((s, i) => {
    const step: DraftStep = { ...s, text: s.text.trim() };
    const from = keep?.ids[i] ? byId.get(keep.ids[i]!) : undefined;
    let node: WfNode;
    if (from) {
      const was = nodeToStep(from);
      if (was && was.verb === step.verb && was.text === step.text) node = { ...from };
      else if (from.type === NODE_OF[step.verb]) node = { ...from, label: labelOf(step), ...(was?.verb !== step.verb ? { permission: PERMISSION_OF[step.verb] } : {}) };
      else node = freshNode(step, from.id, executor);
    } else node = freshNode(step, keep ? nextId() : `s${i + 1}`, executor);
    ids.push(node.id);
    nodes.push(node);
  });
  // a line the drawing already had keeps its own look (a «نعم» it never named stays unnamed) — as long as it still means the same thing
  const edges: WfEdge[] = [];
  const line = (from: string, to: string, role: "plain" | "yes" | "no") => {
    const want = role === "no" ? "لا" : role === "yes" ? "نعم" : undefined;
    const had = keep?.base.edges.find((e) => e.from === from && e.to === to && (role === "no" ? e.label === "لا" : role === "yes" ? e.label === undefined || e.label === "نعم" : e.label === undefined));
    edges.push(had ? { ...had } : { from, to, ...(want ? { label: want } : {}) });
  };
  if (ids.length) line(trigger.id, ids[0]!, "plain");
  steps.forEach((s, i) => {
    const next = ids[i + 1];
    if (s.verb === "decide") {
      if (next) line(ids[i]!, next, "yes");
      if (typeof s.elseGoto === "number" && ids[s.elseGoto]) line(ids[i]!, ids[s.elseGoto]!, "no");
    } else if (next) line(ids[i]!, next, "plain");
  });
  return { nodes, edges };
}

/**
 * The drawing to save after an edit: when the steps and the lines are the ones the drawing had, it is that drawing as it was (nobody moved anything, so no new version of a
 * layout); when they changed, it is laid out again top to bottom — the new steps have no place yet.
 */
export function settleLayout(prev: WfGraph, next: WfGraph): WfGraph {
  const d = graphDiff(prev, next);
  const same = !d.addedNodes.length && !d.removedNodes.length && !d.changedNodes.length && !d.addedEdges && !d.removedEdges;
  return same ? prev : autoLayout(next);
}

/** What a draft becomes: the columns of a `Workflow` (minus its key and number, which the site gives), ready to write. */
export interface JobSpec {
  name: string;
  description: string | null;
  domain: JobDomain;
  kind: JobKind;
  schedule: string | null;
  scheduleText: string;
  runsAt: Date | null;
  endsAt: Date | null;
  graph: WfGraph;
  /** who wakes it: the site asks the one who carries it out (`site`), or the site carries it out itself (`site_run`: a recipe) */
  wake: "site" | "site_run";
  assigneeKey: string;
  executor: Executor;
  permission: Permission;
  notifyOn: NotifyEvent[];
  recipe: RecipeName | null;
  recipeParams: Record<string, unknown> | null;
  /** «هلق»: a request to run it goes out at once, the way the clock's own would at that moment */
  runNow: boolean;
}

const RANK: Record<Permission, number> = { green: 0, yellow: 1, red: 2, black: 3 };

/**
 * The job a draft means. The draft must have passed `validateDraft` (the server does that first); a bad one is not made into something that looks fine, it throws.
 * `now` is the moment of saving («هلق» is that moment; a window counts from it). `kind` is what the team directory says the assignee is.
 */
export function draftToJob(input: JobDraft, now: Date, opts: { kind?: "agent" | "person" } = {}): JobSpec {
  const d = normalizeDraft(input);
  const check = validateDraft(d, now);
  if (!check.ok) throw new Error(`draftToJob: ${check.field}: ${check.message}`);
  const w = d.when;
  const executor = executorOfAssignee(d.assigneeKey, opts.kind);
  const graph = draftGraph(d.steps, { executor, triggerLabel: whenWords(w) });
  const permission = graph.nodes.reduce<Permission>((top, n) => (RANK[n.permission ?? "green"] > RANK[top] ? (n.permission ?? "green") : top), "green");
  const base = { name: d.name, description: null, domain: d.domain, graph, assigneeKey: d.assigneeKey, executor, permission, notifyOn: d.notifyOn, scheduleText: whenWords(w) };
  const recipe = { recipe: d.recipe?.name ?? null, recipeParams: d.recipe?.params ?? null };
  const wake = d.recipe ? ("site_run" as const) : ("site" as const);
  if (w.kind === "now") return { ...base, ...recipe, wake, kind: "once", schedule: null, runsAt: now, endsAt: null, runNow: true };
  if (w.kind === "once") return { ...base, ...recipe, wake, kind: "once", schedule: null, runsAt: ammanInstant(w.date, w.time), endsAt: null, runNow: false };
  if (w.kind === "window") return { ...base, ...recipe, wake, kind: "window", schedule: toCron(w, now), runsAt: null, endsAt: new Date(w.until), runNow: false };
  return { ...base, ...recipe, wake, kind: "recurring", schedule: toCron(w, now), runsAt: null, endsAt: null, runNow: false };
}

/** A one-time job for a person is a task on the team's board with its time, not a job with runs (a repeating one stays a job). */
export const isPersonTask = (d: Pick<JobDraft, "when" | "recipe">, assigneeKind: "agent" | "person"): boolean => assigneeKind === "person" && !d.recipe && (d.when.kind === "now" || d.when.kind === "once");

/** The task a one-time job for a person is: the name, the steps as lines of the note, the time it is due. */
export function draftToTask(input: JobDraft, now: Date): { title: string; note: string | null; assignee: string; dueAt: Date } {
  const d = normalizeDraft(input);
  const check = validateDraft(d, now);
  if (!check.ok) throw new Error(`draftToTask: ${check.field}: ${check.message}`);
  const note = d.steps.map((s, i) => `${i + 1}. ${VERB_AR[s.verb]}: ${s.text}`).join("\n").slice(0, 1000);
  const w = d.when;
  return { title: d.name.slice(0, 200), note: note || null, assignee: d.assigneeKey, dueAt: w.kind === "once" ? ammanInstant(w.date, w.time)! : now };
}

// ───────────────────────────── drawing → draft ─────────────────────────────

export type StepsRead =
  | { ok: true; steps: DraftStep[]; ids: string[]; /** the steps the owner switched off (their switch stays as it is) */ off: boolean[] }
  | { ok: false; reason: string };

/** The message of a drawing that is not a plain line (the edit screen shows it, with the link to the drawing board). */
export const OLD_BOARD_NOTE = "هالمهمة معدّلة باللوحة القديمة";

/**
 * Reads a drawing as a line of steps — or says why it is not one. A line: one trigger; every step has one way out (a condition has two: «نعم» to the next and «لا» to a later
 * step); every node is on it once; no loop; no wait on a clock. The steps come out in the order they run, with the id of the node each one is.
 */
export function graphToSteps(g: WfGraph): StepsRead {
  const no = (reason: string): StepsRead => ({ ok: false, reason });
  const triggers = g.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) return no("مش واضح منين بتبدأ");
  if (g.nodes.some((n) => n.type === "wait")) return no("فيها خطوة انتظار بوقت");
  const out = new Map<string, WfEdge[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) out.get(e.from)?.push(e);

  const order: WfNode[] = [];
  const elseOf = new Map<string, string>();
  const seen = new Set<string>([triggers[0]!.id]);
  let cur: WfNode = triggers[0]!;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (;;) {
    const edges = out.get(cur.id) ?? [];
    let primary: WfEdge | undefined;
    if (cur.type === "condition") {
      const no_ = edges.filter((e) => e.label === "لا");
      const rest = edges.filter((e) => e.label !== "لا");
      if (no_.length > 1 || rest.length > 1 || edges.length > 2) return no("فيها تفرّع");
      if (no_.length === 1) {
        if (!rest.length) return no("فيها تفرّع");
        elseOf.set(cur.id, no_[0]!.to);
      }
      primary = rest[0];
    } else {
      if (edges.length > 1) return no("فيها تفرّع");
      primary = edges[0];
    }
    if (!primary) break;
    const next = byId.get(primary.to);
    if (!next || seen.has(next.id)) return no("فيها دورة أو رابط مش مفهوم");
    seen.add(next.id);
    order.push(next);
    cur = next;
  }
  if (seen.size !== g.nodes.length) return no("فيها خطوات مش موصولة بالباقي");

  const steps: DraftStep[] = [];
  for (const n of order) {
    const s = nodeToStep(n);
    if (!s) return no("فيها نوع خطوة مش مفهوم");
    steps.push(s);
  }
  const at = new Map(order.map((n, i) => [n.id, i]));
  for (const [id, to] of elseOf) {
    const i = at.get(id)!;
    const j = at.get(to);
    // «لا» must skip at least one step and never go back: anything else is a drawing of its own
    if (j === undefined || j <= i + 1) return no("فيها تفرّع");
    steps[i]!.elseGoto = j;
  }
  return { ok: true, steps, ids: order.map((n) => n.id), off: order.map((n) => !!n.disabled) };
}

/**
 * The draft of a job that exists: the job's own fields (`rest`) with the steps of its drawing. The way back of `draftToJob` — what `draftToJob(d).graph` draws, this reads
 * as `d` again (up to `normalizeDraft`). Not a plain line: the reason, in words.
 */
export function graphToDraft(g: WfGraph, rest: Omit<JobDraft, "steps">): { ok: true; draft: JobDraft; ids: string[]; off: boolean[] } | { ok: false; reason: string } {
  const r = graphToSteps(g);
  return r.ok ? { ok: true, draft: { ...rest, steps: r.steps }, ids: r.ids, off: r.off } : r;
}

// ───────────────────────────── editing the blocks ─────────────────────────────
// Every change the builder makes to a list of steps is a function that returns a NEW list: the «وإلا» of a condition follows the step it pointed at when steps move, and
// points at the end when that step is gone. The screen only draws; the rules are tested here.

/** A new block at the end of the list (a condition's «وإلا» starts as the end). */
export function addStep(steps: readonly DraftStep[], verb: Verb, text = ""): DraftStep[] {
  if (steps.length >= MAX_STEPS) return [...steps];
  return [...steps.map((s) => ({ ...s })), { verb, text }];
}

/** The same list with the text of one block changed. */
export function setStepText(steps: readonly DraftStep[], at: number, text: string): DraftStep[] {
  return steps.map((s, i) => (i === at ? { ...s, text } : { ...s }));
}

/** The same list with the «وإلا» of one condition set (a number, or «end»). */
export function setElse(steps: readonly DraftStep[], at: number, to: number | "end"): DraftStep[] {
  return steps.map((s, i) => {
    if (i !== at || s.verb !== "decide") return { ...s };
    const { elseGoto: _drop, ...rest } = s;
    void _drop;
    return to === "end" ? rest : { ...rest, elseGoto: to };
  });
}

/** The list after its blocks move: `map` says where the block at `i` goes (null: it is gone). A condition's «وإلا» follows the block it pointed at. */
function remap(steps: readonly DraftStep[], map: (i: number) => number | null): DraftStep[] {
  const placed = steps.flatMap((s, i) => {
    const at = map(i);
    return at === null ? [] : [{ s: { ...s }, at }];
  });
  placed.sort((a, b) => a.at - b.at);
  return placed.map(({ s }, k) => {
    if (s.verb !== "decide" || typeof s.elseGoto !== "number") return s;
    const to = map(s.elseGoto);
    const { elseGoto: _drop, ...rest } = s;
    void _drop;
    // the step it pointed at is gone, or no longer comes after the one after this: «no» ends the job
    return to === null || to <= k + 1 ? rest : { ...rest, elseGoto: to };
  });
}

/** Moves a block up (−1) or down (+1). The list is the same when it is already at the edge. */
export function moveStep(steps: readonly DraftStep[], at: number, by: -1 | 1): DraftStep[] {
  const to = at + by;
  if (at < 0 || at >= steps.length || to < 0 || to >= steps.length) return steps.map((s) => ({ ...s }));
  return remap(steps, (i) => (i === at ? to : i === to ? at : i));
}

/** Removes a block; the conditions that pointed at it now end the job, the ones that pointed past it point one earlier. */
export function removeStep(steps: readonly DraftStep[], at: number): DraftStep[] {
  if (at < 0 || at >= steps.length) return steps.map((s) => ({ ...s }));
  return remap(steps, (i) => (i === at ? null : i > at ? i - 1 : i));
}

/** The same moves for the ids that travel with the blocks of an edited drawing (`graphToSteps`' `ids`): keep the two lists in step. */
export function moveItem<T>(list: readonly T[], at: number, by: -1 | 1): T[] {
  const to = at + by;
  if (at < 0 || at >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[at], out[to]] = [out[to]!, out[at]!];
  return out;
}
export const removeItem = <T>(list: readonly T[], at: number): T[] => list.filter((_, i) => i !== at);
