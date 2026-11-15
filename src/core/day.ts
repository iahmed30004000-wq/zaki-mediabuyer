/**
 * THE DAY (v3 · G «الإنجاز»), pure: what was done on a day — runs, decisions, answers, closed tasks, videos, handovers — and
 * what is planned for one, each as a line, grouped by who did it (or will). The lines are written by the code from rows
 * that already exist; nobody types the day in. Nothing here reads a database or a clock.
 */
import { addDays, ammanKey, keyMs } from "./dates";
import { assigneeName } from "./tasks";

export type ItemKind = "run" | "decision" | "approval" | "task" | "video" | "handoff" | "scheduled" | "due" | "expiry";
export type Tone = "ok" | "warn" | "danger";

export interface DayItem {
  /** ISO instant */
  at: string;
  /** who: owner · claude · system · hermes · muse · n8n · a person's key */
  actor: string;
  kind: ItemKind;
  text: string;
  /** the numbers of the line, short: «3 تنبيهات» · «+8$ باليوم» */
  numbers?: string[];
  tone?: Tone;
  href?: string;
}

export interface DayGroup {
  key: string;
  label: string;
  items: DayItem[];
}

const ACTORS: Record<string, string> = { owner: "المالك", claude: "Claude", system: "النظام (قواعد وأمان)", agent: "وكيل", n8n: "n8n" };
export const actorLabel = (key: string, names: Record<string, string> = {}): string => names[key] ?? ACTORS[key] ?? assigneeName(key) ?? key;

/** [midnight, next midnight) of an Amman day, as instants (Amman is UTC+3 all year). */
export function dayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(keyMs(day) - 3 * 3_600_000);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

export type DayState = "past" | "today" | "future";
export function dayState(day: string, now: Date): DayState {
  const today = ammanKey(now);
  return day < today ? "past" : day === today ? "today" : "future";
}

const WEEKDAY = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** «اليوم» · «امبارح» · «بكرا» · or the weekday and date. */
export function dayTitle(day: string, now: Date): string {
  const today = ammanKey(now);
  const wd = WEEKDAY[new Date(keyMs(day)).getUTCDay()]!;
  const [, m, d] = day.split("-");
  const date = `${wd} ${Number(d)}/${Number(m)}`;
  if (day === today) return `اليوم · ${date}`;
  if (day === addDays(today, -1)) return `امبارح · ${date}`;
  if (day === addDays(today, 1)) return `بكرا · ${date}`;
  return date;
}

const RANK: Record<string, number> = { owner: 0, claude: 1, system: 2 };

/** One group per who, the owner first, then Claude, the system, then the rest by name; each group in time order. */
export function groupItems(items: DayItem[], names: Record<string, string> = {}): DayGroup[] {
  const by = new Map<string, DayItem[]>();
  for (const i of items) by.set(i.actor, [...(by.get(i.actor) ?? []), i]);
  return [...by.entries()]
    .map(([key, list]) => ({ key, label: actorLabel(key, names), items: list.sort((a, b) => a.at.localeCompare(b.at)) }))
    .sort((a, b) => (RANK[a.key] ?? 9) - (RANK[b.key] ?? 9) || a.label.localeCompare(b.label, "ar"));
}

export const countItems = (groups: DayGroup[]) => groups.reduce((n, g) => n + g.items.length, 0);

// ───────────────────────────── lines from rows ─────────────────────────────

/** A run's numbers, as short «name value» pieces (the first few the job reported). */
export function metricsText(metrics: Record<string, unknown> | null | undefined, max = 3): string[] {
  return Object.entries(metrics ?? {})
    .filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.length <= 24))
    .slice(0, max)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
}

const RUN_AR: Record<string, string> = { ok: "خلص ✓", failed: "فشل ✗", skipped: "تخطّى", running: "عم يشتغل", waiting: "متوقف — بانتظار" };

export function runItem(r: { name: string; status: string; at: string; summary: string | null; metrics: Record<string, unknown> | null; source: string }): DayItem {
  const actor = r.source === "worker" ? "system" : r.source === "n8n" ? "n8n" : "claude";
  return {
    at: r.at,
    actor,
    kind: "run",
    text: `${r.name} — ${RUN_AR[r.status] ?? r.status}${r.summary ? `: ${r.summary}` : ""}`,
    numbers: metricsText(r.metrics),
    tone: r.status === "failed" ? "danger" : r.status === "waiting" ? "warn" : r.status === "ok" ? "ok" : undefined,
    href: "/workflow",
  };
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 100) / 100}$ باليوم`;

/**
 * An executed change, credited to whoever decided it: a person who approved it (or asked for it) → the owner; a rule or the
 * kill switch that acted by itself → the system; an agent's proposal nobody approved → «وكيل».
 */
export function decisionItem(c: { source: string; sentence: string; at: string; spendDeltaDaily: number; approvedBy?: string | null }): DayItem {
  const byAPerson = !!c.approvedBy && !c.approvedBy.startsWith("level-");
  const actor = byAPerson || c.source === "user" || c.source === "telegram" ? "owner" : c.source === "agent" ? "agent" : "system";
  return { at: c.at, actor, kind: "decision", text: c.sentence, numbers: c.spendDeltaDaily ? [signed(c.spendDeltaDaily)] : [], href: "/tasks" };
}

const APPROVAL_AR: Record<string, string> = { approved: "وافق على", rejected: "رفض", postponed: "أجّل", cancelled: "ألغى" };
export function approvalItem(a: { status: string; title: string; at: string; amount: number | null }): DayItem | null {
  const verb = APPROVAL_AR[a.status];
  if (!verb) return null;
  return { at: a.at, actor: "owner", kind: "approval", text: `${verb}: ${a.title}`, numbers: a.amount ? [`${a.amount}$`] : [], tone: a.status === "rejected" ? "warn" : undefined, href: "/tasks#approval" };
}

export function taskDoneItem(t: { title: string; at: string; assignee: string | null }): DayItem {
  return { at: t.at, actor: t.assignee ?? "owner", kind: "task", text: `خلّص: ${t.title}`, tone: "ok", href: "/tasks" };
}

const VIDEO_AR: Record<string, string> = { ready: "جاهز", uploaded: "انرفع لميتا", live: "شغّال", tired: "تعب" };
export function videoItem(v: { vName: string; job: string; status: string; at: string }): DayItem | null {
  const s = VIDEO_AR[v.status];
  return s ? { at: v.at, actor: "claude", kind: "video", text: `فيديو ${v.vName} (${v.job}): ${s}`, href: "/videos" } : null;
}

export function handoffItem(h: { title: string; assignee: string; at: string; note: string | null }): DayItem {
  return { at: h.at, actor: h.assignee.startsWith("claude") ? "claude" : h.assignee, kind: "handoff", text: `سلّمت: ${h.title}${h.note ? ` — ${h.note}` : ""}`, tone: "ok", href: "/workflow" };
}

// ───────────────────────────── what is planned ─────────────────────────────

export function scheduledItem(w: { name: string; executor: string }, at: string): DayItem {
  const actor = w.executor.startsWith("claude") ? "claude" : w.executor === "hermes" ? "hermes" : w.executor === "muse" ? "muse" : w.executor === "n8n" ? "n8n" : w.executor === "person" ? "owner" : "system";
  return { at, actor, kind: "scheduled", text: `بيشتغل: ${w.name}`, href: "/workflow" };
}

/** A job that runs a few times a day is a line per run; one that runs often (hourly…) is one line — how many times, from when to when. */
export function scheduledItems(w: { name: string; executor: string }, times: string[]): DayItem[] {
  if (!times.length) return [];
  if (times.length <= 3) return times.map((t) => scheduledItem(w, t));
  const first = times[0]!;
  const last = times[times.length - 1]!;
  return [{ ...scheduledItem(w, first), text: `بيشتغل: ${w.name} — ${times.length} مرة (من ${clock(first)} لـ ${clock(last)})` }];
}

export function dueItem(t: { title: string; dueAt: string; assignee: string | null; priority: string }): DayItem {
  return { at: t.dueAt, actor: t.assignee ?? "owner", kind: "due", text: `موعدها: ${t.title}`, tone: t.priority === "urgent" ? "warn" : undefined, href: "/tasks" };
}

export function expiryItem(a: { title: string; at: string }): DayItem {
  return { at: a.at, actor: "owner", kind: "expiry", text: `قرار بينتهي بلا جواب: ${a.title}`, tone: "warn", href: "/tasks#approval" };
}

// ───────────────────────────── to say it elsewhere ─────────────────────────────

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
export const timeOf = clock;

/** The time of a line. A task is due on a day, not at an hour, so it shows a dash instead of a made-up clock. */
export const lineTime = (i: DayItem): string => (i.kind === "due" ? "—" : clock(i.at));

/** The day as plain lines — the Telegram summary and the top of the PDF read the same text. */
export function summaryOfDay(title: string, done: DayGroup[], planned: DayGroup[], demo = false): string {
  const lines: string[] = [`الميديا باير — الإنجاز · ${title}${demo ? " · (بيانات تجريبية)" : ""}`];
  const block = (head: string, groups: DayGroup[]) => {
    if (!countItems(groups)) return;
    lines.push("", `${head} (${countItems(groups)})`);
    for (const g of groups) {
      lines.push(`— ${g.label}`);
      for (const i of g.items.slice(0, 12)) lines.push(`  ${i.tone === "danger" ? "✗" : "•"} ${lineTime(i)} ${i.text}${i.numbers?.length ? ` · ${i.numbers.join(" · ")}` : ""}`);
      if (g.items.length > 12) lines.push(`  … و${g.items.length - 12} غيرها`);
    }
  };
  block("اللي انعمل", done);
  block("المخطّط", planned);
  if (!countItems(done) && !countItems(planned)) lines.push("", "ما في شي مسجّل لهاليوم.");
  return lines.join("\n");
}
