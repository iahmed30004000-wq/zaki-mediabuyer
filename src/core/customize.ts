/**
 * The boards and the fields of the team's tasks (v3 · K, cut down in v6 · P8 by Q5), the pure half. The owner can make a board of tasks from a template, rename, hide and reorder boards,
 * add fields (text · number · date · select · person · link) to the cards, merge two boards or two fields, and put away what he does not use. The old «وضع التعديل» also let him make
 * pages for the side menu and buttons that ask Claude to run a job on a card, and put fields on videos and jobs: all of that was removed (the four places of the map are fixed). What was
 * saved for them stays in the document (the schema still reads it, so a saved board is never lost) and nothing draws it.
 * It is ONE document of config (the setting `ui.config`, versioned like every setting, so a mistake can be undone) that the screens read and draw generically — the built-in boards are the
 * defaults it starts from.
 *
 * Rules that hold here, in one place, tested:
 *   • nothing is deleted — «soft delete» is an archive, and only what is UNUSED can be archived (a board with tasks, a field
 *     with values must be merged or hidden instead), so a merge never loses data: a merged board's tasks move (and the ids are
 *     remembered so they can move back), a merged field's values are copied;
 *   • no text of a label, an option, a value or a link may carry a phone number, an e-mail or a key;
 *   • the order of every list is the order of its array.
 * Nothing here reads a database or a clock: ids come in, results go out.
 */
import { z } from "zod";
import { privacyHits } from "@/gateway/privacy";
import { isKey } from "./dates";
import { PEOPLE, TASK_BOARDS, assigneeName, normalize } from "./tasks";

export const LIMITS = { pages: 40, boards: 30, fields: 60, buttons: 30, label: 40, button: 30, options: 12, option: 30, text: 300, link: 500, moved: 300 } as const;

/** What the stored document may hold in all (the put-away ones included): far above what a person has active, so history never makes it unreadable. */
const STORED_MAX = 300;

/** The cards that have fields: the team's tasks. (The document may still hold fields saved for videos and jobs before P8 — `STORED_ENTITIES` reads them, nothing draws them.) */
export const ENTITIES = ["task"] as const;
const STORED_ENTITIES = ["task", "video", "workflow"] as const;
export type Entity = (typeof STORED_ENTITIES)[number];

export const FIELD_TYPES = ["text", "number", "date", "select", "person", "link"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_AR: Record<FieldType, string> = { text: "نص", number: "رقم", date: "تاريخ", select: "اختيار", person: "شخص", link: "رابط" };

export const PAGE_KINDS = ["board", "link"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** The board every task falls back to: it can be renamed, never hidden, archived or merged away. */
export const MAIN_BOARD = "main";

// ───────────────────────────── the document ─────────────────────────────

const label = z.string().trim().min(1).max(LIMITS.label);
const key = z.string().trim().min(1).max(40);
const when = z.string().max(40);

/** A page of the side menu (removed in P8): kept only so that a document saved with pages still reads. */
export const PageCfg = z
  .object({
    key,
    custom: z.boolean().optional(),
    label: label.optional(),
    hidden: z.boolean().optional(),
    mobile: z.boolean().optional(),
    kind: z.enum(PAGE_KINDS).optional(),
    board: key.optional(),
    href: z.string().max(LIMITS.link).optional(),
    archivedAt: when.optional(),
    mergedInto: key.optional(),
  })
  .strict();
export type PageCfgT = z.infer<typeof PageCfg>;

export const BoardCfg = z
  .object({
    key,
    custom: z.boolean().optional(),
    label: label.optional(),
    hidden: z.boolean().optional(),
    template: z.string().max(30).optional(),
    archivedAt: when.optional(),
    mergedInto: key.optional(),
    /** the tasks a merge moved here (up to 300), so they can be moved back; `movedCount` is how many moved in all */
    movedTaskIds: z.array(z.string().max(40)).max(LIMITS.moved).optional(),
    movedCount: z.number().int().min(0).optional(),
    /** what the merge widened onto the board it went into (field ids, button ids, sidebar pages' keys) — undone with it */
    widened: z.object({ fields: z.array(key).max(LIMITS.fields), buttons: z.array(key).max(LIMITS.buttons), pages: z.array(key).max(STORED_MAX) }).strict().optional(),
  })
  .strict();
export type BoardCfgT = z.infer<typeof BoardCfg>;

export const FieldCfg = z
  .object({
    id: key,
    entity: z.enum(STORED_ENTITIES),
    /** tasks only: the boards it shows on (none = every board) */
    boards: z.array(key).max(LIMITS.boards).optional(),
    label,
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(LIMITS.option)).max(LIMITS.options).optional(),
    onCard: z.boolean().optional(),
    hidden: z.boolean().optional(),
    archivedAt: when.optional(),
    mergedInto: key.optional(),
  })
  .strict();
export type FieldCfgT = z.infer<typeof FieldCfg>;

/** A button on a card (removed in P8): kept only so that a document saved with buttons still reads. */
export const ButtonCfg = z
  .object({
    id: key,
    entity: z.enum(STORED_ENTITIES),
    boards: z.array(key).max(LIMITS.boards).optional(),
    label: z.string().trim().min(1).max(LIMITS.button),
    workflow: z.string().trim().min(1).max(60),
    confirm: z.boolean().optional(),
    hidden: z.boolean().optional(),
    archivedAt: when.optional(),
  })
  .strict();
export type ButtonCfgT = z.infer<typeof ButtonCfg>;

export const UiConfigSchema = z
  .object({
    v: z.literal(1),
    pages: z.array(PageCfg).max(STORED_MAX),
    boards: z.array(BoardCfg).max(STORED_MAX),
    fields: z.array(FieldCfg).max(LIMITS.fields),
    buttons: z.array(ButtonCfg).max(LIMITS.buttons),
  })
  .strict();
export type UiConfig = z.infer<typeof UiConfigSchema>;

export const emptyUi = (): UiConfig => ({ v: 1, pages: [], boards: [], fields: [], buttons: [] });

/** What is stored → a config; anything that does not read is the empty one (the screens then show the built-ins). */
export function parseUiConfig(raw: unknown): UiConfig {
  const r = UiConfigSchema.safeParse(raw);
  return r.success ? r.data : emptyUi();
}

// ───────────────────────────── small helpers ─────────────────────────────

export type UiEdit =
  | { ok: true; config: UiConfig; note: string; /** a board merge undone: these tasks go back */ moveBack?: { from: string; into: string; ids: string[] }; /** a field changed type: its stored values are rewritten for the new type */ convert?: { fieldId: string } }
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const done = (config: UiConfig, note: string, extra: { moveBack?: { from: string; into: string; ids: string[] }; convert?: { fieldId: string } } = {}): UiEdit => ({ ok: true, config, note, ...extra });

/** A name as a duplicate check sees it: no marks, no spaces or dashes, and no «ال» in front of any word («سد التسريب» = «سد تسريب»). */
const squash = (s: string) =>
  normalize(s)
    .split(/[\s_\-.،,:]+/)
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join("");
const sameName = (a: string, b: string) => squash(a) === squash(b);

/** A label as the owner typed it: trimmed, spaces collapsed, within the limit, and not a customer's number or a key. */
export function cleanLabel(raw: string, max: number = LIMITS.label): { ok: true; label: string } | { ok: false; error: string } {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return fail("اكتب اسم");
  if (s.length > max) return fail(`الاسم أطول من ${max} حرف`);
  if (privacyHits(s).length) return fail("الاسم فيه رقم هاتف أو إيميل أو مفتاح — ما بيدخل");
  return { ok: true, label: s };
}

/** A link a person may click: an address inside the site, or an https one — never a script, never one that carries a login. */
export function cleanHref(raw: string): { ok: true; href: string } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return fail("اكتب الرابط");
  if (s.length > LIMITS.link) return fail(`الرابط أطول من ${LIMITS.link} حرف`);
  if (privacyHits(s).length) return fail("الرابط فيه رقم هاتف أو إيميل أو مفتاح — ما بيدخل");
  if (s.startsWith("/")) {
    if (s.startsWith("//") || /[\s\\]/.test(s) || /^\/(api|_next)(\/|$)/.test(s)) return fail("هالمسار مش صفحة بالموقع");
    return { ok: true, href: s };
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return fail("الرابط لازم يبلّش بـ https://");
    if (u.username || u.password) return fail("الرابط فيه اسم مستخدم أو كلمة سر — ما بيدخل");
    return { ok: true, href: u.toString() };
  } catch {
    return fail("الرابط مش مفهوم");
  }
}

const isoNow = (at: string) => at;

function swapWithNeighbour<T>(list: T[], at: number, dir: -1 | 1, eligible: (x: T) => boolean): T[] | null {
  let j = at + dir;
  while (j >= 0 && j < list.length && !eligible(list[j]!)) j += dir;
  if (j < 0 || j >= list.length) return null;
  const out = [...list];
  [out[at], out[j]] = [out[j]!, out[at]!];
  return out;
}

// ───────────────────────────── boards ─────────────────────────────

export interface EffBoard {
  key: string;
  label: string;
  builtin: boolean;
  hidden: boolean;
  archived: boolean;
  locked: boolean;
  template?: string;
  mergedInto?: string;
  /** how many tasks a merge moved here, and whether they can still be moved back */
  movedCount: number;
  canMoveBack: boolean;
}

const BUILTIN_BOARDS = TASK_BOARDS.map((b) => ({ key: b.key as string, label: b.label as string }));

export function effectiveBoards(cfg: UiConfig): EffBoard[] {
  const byBuiltin = new Map(BUILTIN_BOARDS.map((b) => [b.key, b]));
  const byCfg = new Map(cfg.boards.map((b) => [b.key, b]));
  const order = [...cfg.boards.map((b) => b.key), ...BUILTIN_BOARDS.map((b) => b.key).filter((k) => !byCfg.has(k))];
  const out: EffBoard[] = [];
  const seen = new Set<string>();
  for (const k of order) {
    if (seen.has(k)) continue;
    seen.add(k);
    const c = byCfg.get(k);
    const b = byBuiltin.get(k);
    if (!b && !c?.custom) continue;
    out.push({
      key: k,
      label: c?.label ?? b?.label ?? "لوحة",
      builtin: !!b,
      hidden: k === MAIN_BOARD ? false : !!c?.hidden,
      archived: !!c?.archivedAt,
      locked: k === MAIN_BOARD,
      template: c?.template,
      mergedInto: c?.mergedInto,
      movedCount: c?.movedCount ?? 0,
      canMoveBack: !!c?.movedTaskIds?.length,
    });
  }
  return out;
}

export const visibleBoards = (boards: EffBoard[]) => boards.filter((b) => !b.hidden && !b.archived);

function withBoards(cfg: UiConfig): UiConfig {
  const have = new Set(cfg.boards.map((b) => b.key));
  const missing = BUILTIN_BOARDS.filter((b) => !have.has(b.key)).map((b) => ({ key: b.key }));
  return missing.length ? { ...cfg, boards: [...cfg.boards, ...missing] } : cfg;
}

const patchBoard = (cfg: UiConfig, k: string, patch: Partial<BoardCfgT>): UiConfig => ({ ...cfg, boards: cfg.boards.map((b) => (b.key === k ? { ...b, ...patch } : b)) });

function findBoard(cfg: UiConfig, k: string): { eff: EffBoard; base: UiConfig } | { error: string } {
  const base = withBoards(cfg);
  const eff = effectiveBoards(base).find((b) => b.key === k);
  return eff ? { eff, base } : { error: "اللوحة مش موجودة" };
}

/** A board's key as tasks keep it: a merged board's tasks belong to the board it was merged into (follows the chain; loops end). */
export function resolveBoard(cfg: UiConfig, k: string): string {
  let cur = k;
  for (let i = 0; i < 10; i++) {
    const c = cfg.boards.find((b) => b.key === cur);
    if (!c?.mergedInto) return cur;
    cur = c.mergedInto;
  }
  return cur;
}

/** `#word` in a quick add → the board: every active board by its label (spaces as «_») and by its key. */
export function boardWords(cfg: UiConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of effectiveBoards(cfg).filter((x) => !x.archived)) {
    out[normalize(b.key)] = b.key;
    out[normalize(b.label).replace(/\s+/g, "_")] = b.key;
  }
  return out;
}

export interface BoardTemplate {
  id: string;
  name: string;
  about: string;
  fields: { label: string; type: FieldType; options?: string[] }[];
}

/** Starting points for «لوحة جديدة»: a board, and the fields that go with it. None carries a customer, an amount of money or a real id. */
export const BOARD_TEMPLATES: BoardTemplate[] = [
  { id: "blank", name: "فاضية", about: "الأعمدة الخمسة وبس — وإنت بتضيف الحقول", fields: [] },
  { id: "shipments", name: "متابعة شحنات", about: "رقم الشحنة، شركة الشحن، وموعد التسليم المتوقع", fields: [{ label: "رقم الشحنة", type: "text" }, { label: "شركة الشحن", type: "text" }, { label: "موعد التسليم", type: "date" }] },
  { id: "content", name: "محتوى وفيديوهات", about: "رابط الملف، مين بيشتغل عليه، وموعد النشر", fields: [{ label: "رابط الملف", type: "link" }, { label: "مين بينفّذ", type: "person" }, { label: "موعد النشر", type: "date" }] },
  { id: "followup", name: "متابعة وتذكير", about: "سبب المتابعة ومن وين إجت", fields: [{ label: "السبب", type: "text" }, { label: "المصدر", type: "select", options: ["ميتا", "الـ OMS", "تيليجرام", "غيره"] }] },
];

export const templateById = (id: string): BoardTemplate | undefined => BOARD_TEMPLATES.find((t) => t.id === id);

const boardLabelTaken = (boards: EffBoard[], text: string, except?: string) => boards.some((b) => !b.archived && b.key !== except && sameName(b.label, text));

/** A new board of tasks, from a template: `a.fieldIds` holds one new id for each field the template brings. */
export function addBoard(cfg: UiConfig, a: { id: string; label: string; template?: string; fieldIds?: string[] }): UiEdit {
  const l = cleanLabel(a.label);
  if (!l.ok) return l;
  const base = withBoards(cfg);
  const boards = effectiveBoards(base);
  if (boards.filter((b) => !b.builtin && !b.archived).length >= LIMITS.boards) return fail(`وصلت للحد (${LIMITS.boards} لوحة من صنعك)`);
  if (boardLabelTaken(boards, l.label)) return fail("في لوحة بنفس الاسم — ادمجهم أو غيّر الاسم");
  const t = templateById(a.template ?? "blank");
  if (!t) return fail("القالب مش معروف");
  if (base.fields.length + t.fields.length > LIMITS.fields) return fail("الحقول وصلت للحد");
  const ids = a.fieldIds ?? [];
  if (ids.length < t.fields.length) return fail("ناقص معرّفات للحقول");
  const fields: FieldCfgT[] = t.fields.map((f, i) => ({ id: ids[i]!, entity: "task", boards: [a.id], label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}), onCard: true }));
  return done({ ...base, boards: [...base.boards, { key: a.id, custom: true, label: l.label, template: t.id }], fields: [...base.fields, ...fields] }, `لوحة جديدة «${l.label}»${fields.length ? ` مع ${fields.length} حقول` : ""}`);
}

export function renameBoard(cfg: UiConfig, k: string, text: string): UiEdit {
  const l = cleanLabel(text);
  if (!l.ok) return l;
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  if (boardLabelTaken(effectiveBoards(f.base), l.label, k)) return fail("في لوحة بنفس الاسم");
  return done(patchBoard(f.base, k, { label: l.label }), `لوحة «${f.eff.label}» صارت «${l.label}»`);
}

export function setBoardHidden(cfg: UiConfig, k: string, hidden: boolean): UiEdit {
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  if (f.eff.locked && hidden) return fail("اللوحة الرئيسية ما بتنخفي");
  if (f.eff.archived) return fail("اللوحة بالمحذوفات — رجّعها أول");
  return done(patchBoard(f.base, k, { hidden }), hidden ? `لوحة «${f.eff.label}» انخفت` : `لوحة «${f.eff.label}» رجعت`);
}

export function moveBoard(cfg: UiConfig, k: string, dir: -1 | 1): UiEdit {
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  const shown = new Set(visibleBoards(effectiveBoards(f.base)).map((b) => b.key));
  if (!shown.has(k)) return fail("اظهرها أول");
  const at = f.base.boards.findIndex((b) => b.key === k);
  const next = swapWithNeighbour(f.base.boards, at, dir, (b) => shown.has(b.key));
  return next ? done({ ...f.base, boards: next }, `لوحة «${f.eff.label}» اتحرّكت`) : fail(dir < 0 ? "هي أول وحدة" : "هي آخر وحدة");
}

/** Puts a board away — only one nobody uses: `taskCount` is how many tasks (archived ones too) still sit on it. */
export function archiveBoard(cfg: UiConfig, k: string, taskCount: number, at: string): UiEdit {
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  if (f.eff.locked) return fail("اللوحة الرئيسية ما بتنحذف");
  if (f.eff.archived) return fail("هي بالمحذوفات أصلاً");
  if (taskCount > 0) return fail(`عليها ${taskCount} مهمة — ادمجها بلوحة تانية أول (ما بنخسّر ولا مهمة)`);
  return done(patchBoard(f.base, k, { archivedAt: isoNow(at) }), `لوحة «${f.eff.label}» انحذفت (بتقدر ترجّعها)`);
}

/** Brings a board back. One that was merged away gets its tasks back (`moveBack`) — the ones the merge moved, if they are still where it put them. */
export function restoreBoard(cfg: UiConfig, k: string): UiEdit {
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  if (!f.eff.archived) return fail("اللوحة مش محذوفة");
  const c = f.base.boards.find((b) => b.key === k)!;
  const { archivedAt: _a, mergedInto: into, movedTaskIds: ids, movedCount: _c, widened, ...rest } = c;
  void _a;
  void _c;
  // what the merge put on the other board comes off it again
  const unwiden = <T extends { boards?: string[] }>(item: T): T => {
    if (!into || !item.boards) return item;
    const left = item.boards.filter((x) => x !== into);
    return left.length ? { ...item, boards: left } : item;
  };
  const next: UiConfig = {
    ...f.base,
    boards: f.base.boards.map((b) => (b.key === k ? rest : b)),
    fields: widened ? f.base.fields.map((x) => (widened.fields.includes(x.id) ? unwiden(x) : x)) : f.base.fields,
  };
  return done(next, `لوحة «${f.eff.label}» رجعت`, into && ids?.length ? { moveBack: { from: k, into, ids } } : {});
}

/**
 * Merges board `from` into `into`: its tasks move there (the caller moves them, and passes their ids and their count), the board
 * is archived with a pointer and the fields that were only on it now show on `into` too. Nothing is lost: the ids are kept so the merge can be undone.
 */
export function mergeBoards(cfg: UiConfig, a: { from: string; into: string; taskIds: string[]; taskCount: number }, at: string): UiEdit {
  if (a.from === a.into) return fail("اختار لوحتين مختلفتين");
  const x = findBoard(cfg, a.from);
  const y = findBoard(cfg, a.into);
  if ("error" in x) return fail(x.error);
  if ("error" in y) return fail(y.error);
  if (x.eff.locked) return fail("اللوحة الرئيسية بتكون الوجهة بس — ادمج غيرها فيها");
  if (x.eff.archived || y.eff.archived) return fail("وحدة منهم بالمحذوفات");
  const base = x.base;
  // a field that was on this board only is now on the other as well (this board stays in its scope: nothing sits on it any more)
  const widens = (item: { boards?: string[] }) => !!item.boards?.includes(a.from) && !item.boards.includes(a.into);
  const widen = <T extends { boards?: string[] }>(item: T): T => (widens(item) ? { ...item, boards: [...item.boards!, a.into] } : item);
  const keepIds = a.taskCount <= LIMITS.moved ? a.taskIds.slice(0, LIMITS.moved) : undefined;
  const widened = { fields: base.fields.filter(widens).map((f) => f.id), buttons: [], pages: [] };
  const next: UiConfig = {
    ...patchBoard(base, a.from, { archivedAt: isoNow(at), mergedInto: a.into, movedTaskIds: keepIds, movedCount: a.taskCount, widened }),
    fields: base.fields.map(widen),
  };
  return done(next, `لوحة «${x.eff.label}» اندمجت بـ «${y.eff.label}» (${a.taskCount} مهمة انتقلت)`);
}

// ───────────────────────────── fields ─────────────────────────────

export const activeFields = (cfg: UiConfig, entity: Entity) => cfg.fields.filter((f) => f.entity === entity && !f.archivedAt);

/** What shows on a board: the items with no scope (everywhere) and those that name it. */
export const onBoard = <T extends { boards?: string[] }>(items: T[], board?: string): T[] => items.filter((i) => !i.boards?.length || (!!board && i.boards.includes(board)));

/** The fields a card shows: of this kind of card, on this board, not hidden or archived (the panel asks for the hidden ones too). */
export function fieldsFor(cfg: UiConfig, entity: Entity, board?: string, opts: { hidden?: boolean } = {}): FieldCfgT[] {
  return onBoard(activeFields(cfg, entity).filter((f) => opts.hidden || !f.hidden), board);
}

const cleanOptions = (raw: string[] | undefined): { ok: true; options: string[] } | { ok: false; error: string } => {
  const out: string[] = [];
  for (const o of raw ?? []) {
    const c = cleanLabel(o, LIMITS.option);
    if (!c.ok) return fail(`خيار «${o.slice(0, 20)}»: ${c.error}`);
    if (!out.some((x) => sameName(x, c.label))) out.push(c.label);
  }
  if (out.length > LIMITS.options) return fail(`أقصى شي ${LIMITS.options} خيار`);
  return { ok: true, options: out };
};

function checkScope(cfg: UiConfig, entity: Entity, boards: string[] | undefined): { ok: true; boards: string[] | undefined } | { ok: false; error: string } {
  if (!boards?.length) return { ok: true, boards: undefined };
  if (entity !== "task") return fail("اللوحات للمهام بس");
  const known = new Set(effectiveBoards(cfg).filter((b) => !b.archived).map((b) => b.key));
  const bad = boards.find((b) => !known.has(b));
  if (bad) return fail("لوحة مش موجودة بالنطاق");
  return { ok: true, boards: [...new Set(boards)] };
}


export function addField(cfg: UiConfig, a: { id: string; entity: Entity; label: string; type: FieldType; options?: string[]; boards?: string[]; onCard?: boolean }): UiEdit {
  const l = cleanLabel(a.label);
  if (!l.ok) return l;
  if (activeFields(cfg, a.entity).length >= LIMITS.fields || cfg.fields.length >= LIMITS.fields) return fail(`وصلت للحد (${LIMITS.fields} حقل)`);
  if (activeFields(cfg, a.entity).some((f) => f.type === a.type && sameName(f.label, l.label))) return fail("في حقل بنفس الاسم والنوع — ادمجهم");
  const scope = checkScope(withBoards(cfg), a.entity, a.boards);
  if (!scope.ok) return scope;
  let options: string[] | undefined;
  if (a.type === "select") {
    const o = cleanOptions(a.options);
    if (!o.ok) return o;
    if (o.options.length < 2) return fail("الاختيار بدو خيارين على الأقل");
    options = o.options;
  }
  const f: FieldCfgT = { id: a.id, entity: a.entity, label: l.label, type: a.type, ...(options ? { options } : {}), ...(scope.boards ? { boards: scope.boards } : {}), onCard: a.onCard ?? true };
  return done({ ...cfg, fields: [...cfg.fields, f] }, `حقل جديد «${l.label}» (${FIELD_TYPE_AR[a.type]})`);
}

export function updateField(cfg: UiConfig, id: string, p: { label?: string; options?: string[]; boards?: string[] | null; onCard?: boolean; hidden?: boolean }): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  if (!f) return fail("الحقل مش موجود");
  if (f.archivedAt) return fail("الحقل بالمحذوفات — رجّعه أول");
  const next: FieldCfgT = { ...f };
  if (p.label !== undefined) {
    const l = cleanLabel(p.label);
    if (!l.ok) return l;
    if (activeFields(cfg, f.entity).some((x) => x.id !== id && x.type === f.type && sameName(x.label, l.label))) return fail("في حقل بنفس الاسم والنوع");
    next.label = l.label;
  }
  if (p.options !== undefined) {
    if (f.type !== "select") return fail("الخيارات للاختيار بس");
    const o = cleanOptions(p.options);
    if (!o.ok) return o;
    if (o.options.length < 2) return fail("الاختيار بدو خيارين على الأقل");
    next.options = o.options;
  }
  if (p.boards !== undefined) {
    const scope = checkScope(withBoards(cfg), f.entity, p.boards ?? undefined);
    if (!scope.ok) return scope;
    if (scope.boards) next.boards = scope.boards;
    else delete next.boards;
  }
  if (p.onCard !== undefined) next.onCard = p.onCard;
  if (p.hidden !== undefined) next.hidden = p.hidden;
  return done({ ...cfg, fields: cfg.fields.map((x) => (x.id === id ? next : x)) }, `حقل «${f.label}» اتعدّل`);
}

export function moveField(cfg: UiConfig, id: string, dir: -1 | 1): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  if (!f) return fail("الحقل مش موجود");
  const at = cfg.fields.findIndex((x) => x.id === id);
  const next = swapWithNeighbour(cfg.fields, at, dir, (x) => x.entity === f.entity && !x.archivedAt);
  return next ? done({ ...cfg, fields: next }, `حقل «${f.label}» اتحرّك`) : fail(dir < 0 ? "هو أول واحد" : "هو آخر واحد");
}

/** Puts a field away — only one nobody filled in: `valueCount` is how many cards hold a value for it. */
export function archiveField(cfg: UiConfig, id: string, valueCount: number, at: string): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  if (!f) return fail("الحقل مش موجود");
  if (f.archivedAt) return fail("هو بالمحذوفات أصلاً");
  if (valueCount > 0) return fail(`مكتوب فيه ${valueCount} قيمة — اخفيه (بتضل محفوظة) أو ادمجه بحقل تاني`);
  return done({ ...cfg, fields: cfg.fields.map((x) => (x.id === id ? { ...x, archivedAt: isoNow(at) } : x)) }, `حقل «${f.label}» انحذف (بتقدر ترجّعه)`);
}

export function restoreField(cfg: UiConfig, id: string): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  if (!f) return fail("الحقل مش موجود");
  if (!f.archivedAt) return fail("الحقل مش محذوف");
  if (activeFields(cfg, f.entity).some((x) => x.type === f.type && sameName(x.label, f.label))) return fail("في حقل نشط بنفس الاسم والنوع — ادمجهم");
  const { archivedAt: _a, mergedInto: _m, ...rest } = f;
  void _a;
  void _m;
  return done({ ...cfg, fields: cfg.fields.map((x) => (x.id === id ? rest : x)) }, `حقل «${f.label}» رجع`);
}

/**
 * Merges field `from` into `into` (the same kind of card, the same type): its values are COPIED to cards that have none for `into`
 * (the caller does it), and it is archived with a pointer — its own values stay where they are, so nothing is lost. A select keeps
 * both fields' options.
 */
export function mergeFields(cfg: UiConfig, from: string, into: string, at: string): UiEdit {
  if (from === into) return fail("اختار حقلين مختلفين");
  const a = cfg.fields.find((x) => x.id === from);
  const b = cfg.fields.find((x) => x.id === into);
  if (!a || !b) return fail("الحقل مش موجود");
  if (a.archivedAt || b.archivedAt) return fail("وحدة منهم بالمحذوفات");
  if (a.entity !== b.entity) return fail("الحقلين لازم يكونوا على نفس نوع البطاقة");
  if (a.type !== b.type) return fail(`النوعين مختلفين (${FIELD_TYPE_AR[a.type]} و${FIELD_TYPE_AR[b.type]}) — ما بنخلطهم`);
  let options = b.options;
  if (b.type === "select") {
    const merged = [...(b.options ?? [])];
    for (const o of a.options ?? []) if (!merged.some((m) => sameName(m, o))) merged.push(o);
    if (merged.length > LIMITS.options) return fail(`الخيارات بعد الدمج أكتر من ${LIMITS.options}`);
    options = merged;
  }
  // where it shows: everywhere either did
  const boards = !a.boards?.length || !b.boards?.length ? undefined : [...new Set([...a.boards, ...b.boards])];
  const merged: FieldCfgT = { ...b, ...(options ? { options } : {}) };
  if (boards) merged.boards = boards;
  else delete merged.boards;
  return done({ ...cfg, fields: cfg.fields.map((x) => (x.id === into ? merged : x.id === from ? { ...x, archivedAt: isoNow(at), mergedInto: into } : x)) }, `حقل «${a.label}» اندمج بـ «${b.label}»`);
}

// ───────────────────────────── drag to reorder, and changing a field's type ─────────────────────────────

/** `id` takes the place of `onto` (and the ones between shift by one) — what dropping a row onto another means. Only items `eligible` count. */
function dropOnto<T>(list: T[], from: number, onto: number, eligible: (x: T) => boolean): T[] | null {
  if (from < 0 || onto < 0 || from === onto || !eligible(list[from]!) || !eligible(list[onto]!)) return null;
  const out = list.filter((_, i) => i !== from);
  out.splice(onto, 0, list[from]!);
  return out;
}

export function moveBoardTo(cfg: UiConfig, k: string, onto: string): UiEdit {
  const f = findBoard(cfg, k);
  if ("error" in f) return fail(f.error);
  const shown = new Set(visibleBoards(effectiveBoards(f.base)).map((b) => b.key));
  if (!shown.has(k) || !shown.has(onto)) return fail("اظهرها أول");
  const next = dropOnto(f.base.boards, f.base.boards.findIndex((b) => b.key === k), f.base.boards.findIndex((b) => b.key === onto), (b) => shown.has(b.key));
  return next ? done({ ...f.base, boards: next }, `لوحة «${f.eff.label}» اتحرّكت`) : fail("ما تغيّر ترتيب");
}

export function moveFieldTo(cfg: UiConfig, id: string, onto: string): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  const t = cfg.fields.find((x) => x.id === onto);
  if (!f || !t) return fail("الحقل مش موجود");
  if (f.entity !== t.entity) return fail("الحقلين مش على نفس نوع البطاقة");
  const next = dropOnto(cfg.fields, cfg.fields.indexOf(f), cfg.fields.indexOf(t), (x) => x.entity === f.entity && !x.archivedAt);
  return next ? done({ ...cfg, fields: next }, `حقل «${f.label}» اتحرّك`) : fail("ما تغيّر ترتيب");
}

/**
 * A field becomes another type — only when EVERY value it holds fits the new type (a text «12» becomes the number 12; a text
 * «سلام» does not become a number). One that does not fit stops the change and says how many: nothing is guessed and nothing is
 * dropped. `values` are the values now stored for it. The caller rewrites each one through `validateValue` for the new field.
 */
export function convertField(cfg: UiConfig, id: string, to: FieldType, values: unknown[], options?: string[]): UiEdit {
  const f = cfg.fields.find((x) => x.id === id);
  if (!f) return fail("الحقل مش موجود");
  if (f.archivedAt) return fail("الحقل بالمحذوفات — رجّعه أول");
  if (f.type === to) return fail(`هو أصلاً من نوع ${FIELD_TYPE_AR[to]}`);
  let nextOptions: string[] | undefined;
  if (to === "select") {
    const o = cleanOptions(options);
    if (!o.ok) return o;
    if (o.options.length < 2) return fail("الاختيار بدو خيارين على الأقل");
    nextOptions = o.options;
  }
  if (activeFields(cfg, f.entity).some((x) => x.id !== id && x.type === to && sameName(x.label, f.label))) return fail("في حقل بنفس الاسم والنوع الجديد — ادمجهم");
  const target = { type: to, label: f.label, ...(nextOptions ? { options: nextOptions } : {}) };
  const bad = values.filter((v) => !validateValue(target, v).ok).length;
  if (bad) return fail(`${bad} قيمة من ${values.length} ما بتنفع كـ ${FIELD_TYPE_AR[to]} — عدّلها أو اعمل حقل جديد وادمج`);
  const { options: _o, ...rest } = f;
  void _o;
  const next: FieldCfgT = { ...rest, type: to, ...(nextOptions ? { options: nextOptions } : {}) };
  return done({ ...cfg, fields: cfg.fields.map((x) => (x.id === id ? next : x)) }, `حقل «${f.label}» صار ${FIELD_TYPE_AR[to]}`, { convert: { fieldId: id } });
}

// ───────────────────────────── values ─────────────────────────────

export type ValueCheck = { ok: true; value: string | number | null } | { ok: false; error: string };

/** What was typed into a field → what is kept: nothing (cleared), or a value of the field's type. A phone, an e-mail or a key is refused in any text. */
/** `people`: the keys of the team directory (the server passes them); without it only the seven who always existed are known. */
export function validateValue(field: Pick<FieldCfgT, "type" | "options" | "label">, raw: unknown, people?: readonly string[]): ValueCheck {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { ok: true, value: null };
  const name = `«${field.label}»`;
  switch (field.type) {
    case "text": {
      const s = String(raw).replace(/\s+/g, " ").trim();
      if (s.length > LIMITS.text) return fail(`${name}: أطول من ${LIMITS.text} حرف`);
      if (privacyHits(s).length) return fail(`${name}: فيه رقم هاتف أو إيميل أو مفتاح — ما بيدخل`);
      return { ok: true, value: s };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
      if (!Number.isFinite(n) || Math.abs(n) > 1e9) return fail(`${name}: لازم رقم`);
      return { ok: true, value: Math.round(n * 1e6) / 1e6 };
    }
    case "date": {
      const s = String(raw).trim();
      return isKey(s) ? { ok: true, value: s } : fail(`${name}: التاريخ بالشكل YYYY-MM-DD`);
    }
    case "select": {
      const s = String(raw).trim();
      return (field.options ?? []).includes(s) ? { ok: true, value: s } : fail(`${name}: اختار من الخيارات`);
    }
    case "person": {
      const s = String(raw).trim();
      return (people ?? PEOPLE.map((p) => p.key)).includes(s) ? { ok: true, value: s } : fail(`${name}: شخص مش معروف`);
    }
    case "link": {
      const h = cleanHref(String(raw));
      return h.ok ? { ok: true, value: h.href } : fail(`${name}: ${h.error}`);
    }
  }
}

/** A value as a short chip on a card. */
export function valueText(field: Pick<FieldCfgT, "type">, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  switch (field.type) {
    case "number":
      return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "date": {
      const [, m, d] = String(v).split("-");
      return m && d ? `${Number(d)}/${Number(m)}` : String(v);
    }
    case "person":
      return assigneeName(String(v)) ?? String(v);
    case "link": {
      try {
        const u = new URL(String(v), "https://x.invalid");
        return u.host === "x.invalid" ? String(v) : u.host.replace(/^www\./, "");
      } catch {
        return String(v);
      }
    }
    default: {
      const s = String(v);
      return s.length > 28 ? `${s.slice(0, 27)}…` : s;
    }
  }
}

// ───────────────────────────── the duplicates it suggests merging ─────────────────────────────

export type UiOpShape = { op: string; [k: string]: unknown };

export interface Suggestion {
  id: string;
  kind: "board" | "field" | "tasks";
  text: string;
  /** what one tap does (an op of the edit API); absent: only a place to look */
  op?: UiOpShape;
  href?: string;
}

export interface SuggestInput {
  cfg: UiConfig;
  /** open tasks per board key, and values per field id */
  boardTasks: Record<string, number>;
  fieldValues: Record<string, number>;
  /** groups of tasks that look like the same job (src/core/tasks.ts `duplicateGroups`) */
  taskGroups: number;
}

const closeNames = (a: string, b: string) => {
  const x = squash(a);
  const y = squash(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
};

/** Same name, or one inside the other: the boards, fields and jobs that look like one — and the tasks, which the board already merges. */
export function suggestMerges(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];

  const boards = effectiveBoards(i.cfg).filter((b) => !b.archived);
  for (let a = 0; a < boards.length; a++) {
    for (let b = a + 1; b < boards.length; b++) {
      const p = boards[a]!;
      const q = boards[b]!;
      if (!closeNames(p.label, q.label)) continue;
      // the one with more tasks stays; the main board is always the one that stays
      const keep = p.locked ? p : q.locked ? q : (i.boardTasks[p.key] ?? 0) >= (i.boardTasks[q.key] ?? 0) ? p : q;
      const drop = keep === p ? q : p;
      out.push({ id: `board:${drop.key}:${keep.key}`, kind: "board", text: `لوحتين شبه بعض: «${drop.label}» (${i.boardTasks[drop.key] ?? 0} مهمة) و«${keep.label}» (${i.boardTasks[keep.key] ?? 0})`, op: { op: "board.merge", from: drop.key, into: keep.key } });
    }
  }

  for (const entity of ENTITIES) {
    const fields = activeFields(i.cfg, entity);
    for (let a = 0; a < fields.length; a++) {
      for (let b = a + 1; b < fields.length; b++) {
        const p = fields[a]!;
        const q = fields[b]!;
        if (p.type !== q.type || !closeNames(p.label, q.label)) continue;
        const keep = (i.fieldValues[p.id] ?? 0) >= (i.fieldValues[q.id] ?? 0) ? p : q;
        const drop = keep === p ? q : p;
        out.push({ id: `field:${drop.id}:${keep.id}`, kind: "field", text: `حقلين شبه بعض (المهام): «${drop.label}» و«${keep.label}»`, op: { op: "field.merge", from: drop.id, into: keep.id } });
      }
    }
  }

  if (i.taskGroups > 0) out.push({ id: "tasks", kind: "tasks", text: `${i.taskGroups} ${i.taskGroups === 1 ? "مجموعة" : "مجموعات"} مهام شبه بعض — ادمجها من لوحة المهام`, href: "/tasks/team" });
  return out;
}

// ───────────────────────────── the edit API: one op, one pure function ─────────────────────────────

const id = z.string().trim().min(1).max(40);
const dir = z.union([z.literal(-1), z.literal(1)]);
const boardsList = z.array(key).max(LIMITS.boards).nullable().optional();

/** Every change the panel can ask for. The server checks the caller, gathers the facts an op needs (task counts, value counts, the workflows), runs the pure function and writes the result. */
export const UiOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("board.add"), label: z.string().max(200), template: z.string().max(30).optional() }).strict(),
  z.object({ op: z.literal("board.rename"), key: id, label: z.string().max(200) }).strict(),
  z.object({ op: z.literal("board.hide"), key: id, hidden: z.boolean() }).strict(),
  z.object({ op: z.literal("board.move"), key: id, dir }).strict(),
  z.object({ op: z.literal("board.drop"), key: id, onto: id }).strict(),
  z.object({ op: z.literal("board.archive"), key: id }).strict(),
  z.object({ op: z.literal("board.restore"), key: id }).strict(),
  z.object({ op: z.literal("board.merge"), from: id, into: id }).strict(),
  z.object({ op: z.literal("field.add"), entity: z.enum(ENTITIES), label: z.string().max(200), type: z.enum(FIELD_TYPES), options: z.array(z.string().max(100)).max(40).optional(), boards: boardsList, onCard: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("field.update"), id, label: z.string().max(200).optional(), options: z.array(z.string().max(100)).max(40).optional(), boards: boardsList, onCard: z.boolean().optional(), hidden: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("field.move"), id, dir }).strict(),
  z.object({ op: z.literal("field.drop"), id, onto: id }).strict(),
  z.object({ op: z.literal("field.convert"), id, to: z.enum(FIELD_TYPES), options: z.array(z.string().max(100)).max(40).optional() }).strict(),
  z.object({ op: z.literal("field.archive"), id }).strict(),
  z.object({ op: z.literal("field.restore"), id }).strict(),
  z.object({ op: z.literal("field.merge"), from: id, into: id }).strict(),
]);
export type UiOp = z.infer<typeof UiOpSchema>;
