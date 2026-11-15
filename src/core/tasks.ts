/**
 * THE TASKS BOARD (v3 · E), pure: the five columns, the boards the team works from, the people a task can be given to,
 * the one-line quick add («بكرا لميوز: اعمل 4 هوكات»), the order of the cards and the duplicates worth merging.
 * Nothing here reads a database or a clock — `now` is always passed in.
 */
import { addDays, ammanKey, keyMs } from "./dates";

export const TASK_COLUMNS = [
  { key: "new", label: "جديد" },
  { key: "doing", label: "شغّال" },
  { key: "waiting_approval", label: "بانتظار موافقة" },
  { key: "stalled", label: "متوقف" },
  { key: "done", label: "خلص" },
] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number]["key"];

/** «main» is the team's one board; the others are the operations boards that live here as saved boards. */
export const TASK_BOARDS = [
  { key: "main", label: "الرئيسية" },
  { key: "confirmation", label: "التأكيد" },
  { key: "leak", label: "سد التسريب" },
  { key: "basha", label: "الباشا والمرتجعات" },
  { key: "stock", label: "المخزون والتصنيع" },
] as const;
export type TaskBoard = (typeof TASK_BOARDS)[number]["key"];

export const PEOPLE = [
  { key: "abdullah", label: "عبدالله", names: ["عبدالله", "عبد الله", "عبد_الله", "abdullah"] },
  { key: "hassan", label: "حسان", names: ["حسان", "hassan"] },
  { key: "laith", label: "ليث", names: ["ليث", "laith"] },
  { key: "mohammad", label: "محمد", names: ["محمد", "mohammad", "mohamed"] },
  { key: "hermes", label: "هيرمز", names: ["هيرمز", "hermes"] },
  { key: "muse", label: "ميوز", names: ["ميوز", "muse"] },
  { key: "claude", label: "Claude", names: ["claude", "كلود", "كلاود"] },
] as const;

export const assigneeName = (key: string | null | undefined): string | null => (key ? PEOPLE.find((p) => p.key === key)?.label ?? key : null);

export const PRIORITIES = [
  { key: "low", label: "هادي" },
  { key: "normal", label: "عادي" },
  { key: "high", label: "مهم" },
  { key: "urgent", label: "عاجل" },
] as const;
const RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

// ───────────────────────────── reading Arabic ─────────────────────────────

/** Arabic as people type it: no marks, one alef, one ya, one ta marbuta, Latin digits, lower case. */
export function normalize(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .toLowerCase()
    .trim();
}

const WEEKDAYS: Record<string, number> = { الاحد: 0, الاثنين: 1, الاتنين: 1, الثلاثاء: 2, التلاتاء: 2, الاربعاء: 3, الخميس: 4, الجمعه: 5, السبت: 6 };
const BOARD_WORDS: Record<string, TaskBoard> = { main: "main", confirmation: "confirmation", leak: "leak", basha: "basha", stock: "stock", الرئيسيه: "main", التاكيد: "confirmation", التسريب: "leak", سد_التسريب: "leak", الباشا: "basha", المرتجعات: "basha", المخزون: "stock", التصنيع: "stock" };
const URGENT = new Set(["عاجل", "مستعجل", "فوري", "urgent"]);
const HIGH = new Set(["مهم", "ضروري", "high"]);

export interface QuickAdd {
  title: string;
  assignee?: string;
  /** YYYY-MM-DD on the Amman clock */
  due_at?: string;
  priority?: "high" | "urgent";
  board?: TaskBoard;
}

const clean = (w: string | undefined) => (w ?? "").replace(/[:：،,]+$/, "");

/**
 * The person named at word `i`: «ميوز», «لميوز», «لـ Muse» (the lam alone, then the name), «لعبد الله» (a name of two words).
 * `lam` — the «to» was there; `colon` — the name ends with a colon (so what follows is the title).
 */
function personAt(words: string[], i: number): { key: string; len: number; lam: boolean; colon: boolean } | null {
  const w0 = clean(words[i]);
  if (!w0) return null;
  const lamAlone = normalize(w0) === "ل";
  const start = lamAlone ? i + 1 : i;
  const a = clean(words[start]);
  if (!a) return null;
  const find = (text: string, len: number) => {
    const t = normalize(text);
    for (const p of PEOPLE) {
      const names = p.names.map(normalize);
      const colon = /[:：]$/.test(words[start + len - 1] ?? "");
      if (names.includes(t)) return { key: p.key, len: len + (start - i), lam: lamAlone, colon };
      // «لميوز»: the lam of «to» glued to the name
      if (t.startsWith("ل") && names.includes(t.slice(1))) return { key: p.key, len: len + (start - i), lam: true, colon };
    }
    return null;
  };
  const next = words[start + 1];
  return (next !== undefined ? find(`${a} ${clean(next)}`, 2) : null) ?? find(a, 1);
}

/** The day a word names: today · tomorrow · the day after · a weekday (the next one, never today) · a written date. */
function dayOf(token: string, today: string): string | null {
  const t = normalize(token);
  if (t === "اليوم" || t === "هلق" || t === "الليله") return today;
  if (t === "بكرا" || t === "بكره" || t === "غدا" || t === "غدا") return addDays(today, 1);
  if (t === "بعدبكرا" || t === "بعدبكره") return addDays(today, 2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t in WEEKDAYS) {
    const now = new Date(keyMs(today)).getUTCDay();
    const diff = ((WEEKDAYS[t]! - now + 7) % 7) || 7;
    return addDays(today, diff);
  }
  return null;
}

/**
 * «بكرا لميوز: اعمل 4 هوكات للطنين #confirmation !عاجل» → who, when, which board, how urgent, and what is left is the title.
 * The words that count are read from the start of the line (a date, «لـ<name>», a name followed by a colon, a priority);
 * the first word that is none of them starts the title. A hashtag or «!عاجل» counts anywhere. A line with none of it is just a title.
 */
export function parseQuickAdd(input: string, now: Date): QuickAdd | null {
  const today = ammanKey(now);
  let line = input.replace(/\s+/g, " ").trim().replace(/(^|\s)بعد (بكرا|بكره)(?=\s|:|$)/g, "$1بعدبكرا");
  if (!line) return null;
  const out: QuickAdd = { title: "" };

  // hashtags and «!word» anywhere: the board and the urgency
  line = line
    .replace(/(^|\s)#([^\s#:،,]+)/g, (m, sp: string, w: string) => {
      const b = BOARD_WORDS[normalize(w)];
      if (!b) return m;
      out.board = b;
      return sp;
    })
    .replace(/(^|\s)!+\s*([^\s:،,]*)/g, (m, sp: string, w: string) => {
      const n = normalize(w);
      if (URGENT.has(n) || n === "") out.priority = "urgent";
      else if (HIGH.has(n)) out.priority = out.priority ?? "high";
      else return m;
      return sp;
    })
    .replace(/\s+/g, " ")
    .trim();

  const words = line.split(" ");
  let i = 0;
  while (i < words.length) {
    const raw = words[i]!.replace(/[:：،,]+$/, "");
    const colon = /[:：]$/.test(words[i]!);
    const day = dayOf(raw, today);
    const person = out.assignee ? null : personAt(words, i);
    if (day && !out.due_at) {
      out.due_at = day;
    } else if (!out.assignee && person && (person.lam || person.colon || !!out.due_at)) {
      // a name counts at the start when it has the «to» lam, a colon after it, or follows a date
      out.assignee = person.key;
      i += person.len;
      if (person.colon) break;
      continue;
    } else if (URGENT.has(normalize(raw)) && !out.priority) {
      out.priority = "urgent";
    } else if (HIGH.has(normalize(raw)) && !out.priority && words.length > i + 1) {
      out.priority = "high";
    } else if (/^[:：]+$/.test(words[i]!)) {
      // a colon on its own
    } else break;
    i++;
    if (colon) break;
  }
  out.title = words.slice(i).join(" ").replace(/^[:：،,\s]+/, "").trim();
  return out.title ? out : null;
}

// ───────────────────────────── the cards ─────────────────────────────

export interface CardLike {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  priority: string;
  dueAt: string | null;
  createdAt: string;
}

/** Urgent first, then the nearest due date (a card with no date after the ones with one), then the newest. */
export function byUrgency(a: CardLike, b: CardLike): number {
  return (RANK[b.priority] ?? 1) - (RANK[a.priority] ?? 1) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || b.createdAt.localeCompare(a.createdAt);
}

export function groupByStatus<T extends CardLike>(cards: T[]): Record<TaskColumn, T[]> {
  const out = { new: [], doing: [], waiting_approval: [], stalled: [], done: [] } as Record<TaskColumn, T[]>;
  for (const c of cards) (out[(c.status in out ? c.status : "new") as TaskColumn] ??= []).push(c);
  for (const k of Object.keys(out) as TaskColumn[]) out[k].sort(byUrgency);
  return out;
}

export type DueState = "late" | "today" | "soon" | null;

/** «متأخرة» (before today) · «اليوم» · «قريب» (the next two days) — a finished task is never late. */
export function dueState(dueAt: string | null, status: string, now: Date): DueState {
  if (!dueAt || status === "done") return null;
  const due = dueAt.slice(0, 10);
  const today = ammanKey(now);
  if (due < today) return "late";
  if (due === today) return "today";
  return due <= addDays(today, 2) ? "soon" : null;
}

// ───────────────────────────── duplicates ─────────────────────────────

const STOP = new Set(["ال", "في", "من", "الى", "على", "عن", "مع", "و", "ل"]);
const words = (s: string) => normalize(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

/** Two titles that say the same thing: the same words, or nearly all the words of the shorter one (80% overlap). */
export function similar(a: string, b: string): boolean {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return false;
  const common = [...x].filter((w) => y.has(w)).length;
  return (common / Math.min(x.size, y.size) >= 0.8 && common >= 2) || (x.size === y.size && common === x.size);
}

/**
 * Open tasks that look like the same job, grouped: «شو بدك تدمج؟». Only unfinished cards of the same board are compared;
 * a group has at least two and keeps the order of the cards it is given.
 */
export function duplicateGroups<T extends CardLike & { board?: string }>(cards: T[]): T[][] {
  const open = cards.filter((c) => c.status !== "done");
  const used = new Set<string>();
  const groups: T[][] = [];
  for (const c of open) {
    if (used.has(c.id)) continue;
    const mates = open.filter((o) => o.id !== c.id && !used.has(o.id) && (o.board ?? "main") === (c.board ?? "main") && similar(c.title, o.title));
    if (!mates.length) continue;
    const g = [c, ...mates];
    for (const m of g) used.add(m.id);
    groups.push(g);
  }
  return groups;
}
