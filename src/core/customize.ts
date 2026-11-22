/**
 * «وضع التعديل» (v3 · K), the pure half. The owner can add, rename, hide and reorder the sidebar's pages, make a board of tasks
 * from a template, add fields (text · number · date · select · person · link) and buttons (each one asks Claude to run a
 * workflow on that card) to the cards, merge two pages, boards or fields, and put away what he does not use. None of it is code:
 * it is ONE document of config (the setting `ui.config`, versioned like every setting, so a mistake can be undone) that the
 * screens read and draw generically — the built-in places and boards are the defaults it starts from.
 *
 * Rules that hold here, in one place, tested:
 *   • at most seven pages in the sidebar and four on the phone's bar; «الإعدادات» can never be hidden;
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

export const MAX_SIDEBAR = 7;
export const MAX_PHONE_BAR = 4;
export const LIMITS = { pages: 40, boards: 30, fields: 60, buttons: 30, label: 40, button: 30, options: 12, option: 30, text: 300, link: 500, moved: 300 } as const;

/** What the stored document may hold in all (the put-away ones included): far above what a person has active, so history never makes it unreadable. */
const STORED_MAX = 300;

export const ENTITIES = ["task", "video", "workflow"] as const;
export type Entity = (typeof ENTITIES)[number];
export const ENTITY_AR: Record<Entity, string> = { task: "المهام", video: "الفيديوهات", workflow: "الورك فلو" };

export const FIELD_TYPES = ["text", "number", "date", "select", "person", "link"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_AR: Record<FieldType, string> = { text: "نص", number: "رقم", date: "تاريخ", select: "اختيار", person: "شخص", link: "رابط" };

export const PAGE_KINDS = ["board", "link"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** The board every task falls back to: it can be renamed, never hidden, archived or merged away. */
export const MAIN_BOARD = "main";
/** The page that holds the way back (connections, rules, this very switch's explanation): it is always in the sidebar. */
export const SETTINGS_PAGE = "settings";

// ───────────────────────────── the document ─────────────────────────────

const label = z.string().trim().min(1).max(LIMITS.label);
const key = z.string().trim().min(1).max(40);
const when = z.string().max(40);

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
    entity: z.enum(ENTITIES),
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

export const ButtonCfg = z
  .object({
    id: key,
    entity: z.enum(ENTITIES),
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

// ───────────────────────────── pages ─────────────────────────────

/** A place the code ships with (src/lib/nav.ts, without its icon). */
export interface BuiltinPage {
  key: string;
  href: string;
  label: string;
  question: string;
  mobile: boolean;
}

export interface EffPage {
  key: string;
  href: string;
  label: string;
  question: string;
  builtin: boolean;
  kind: "builtin" | PageKind;
  board?: string;
  external: boolean;
  hidden: boolean;
  archived: boolean;
  mobile: boolean;
  /** «الإعدادات»: always in the sidebar */
  locked: boolean;
  mergedInto?: string;
}

export const customPageHref = (k: string) => `/p/${k}`;

/** Every page with the owner's changes laid over the built-in ones, in the order the owner left them. */
export function effectivePages(cfg: UiConfig, builtins: BuiltinPage[]): EffPage[] {
  const byBuiltin = new Map(builtins.map((b) => [b.key, b]));
  const byCfg = new Map(cfg.pages.map((p) => [p.key, p]));
  const order = [...cfg.pages.map((p) => p.key), ...builtins.map((b) => b.key).filter((k) => !byCfg.has(k))];
  const out: EffPage[] = [];
  const seen = new Set<string>();
  for (const k of order) {
    if (seen.has(k)) continue;
    seen.add(k);
    const c = byCfg.get(k);
    const b = byBuiltin.get(k);
    if (b) {
      out.push({ key: k, href: b.href, label: c?.label ?? b.label, question: b.question, builtin: true, kind: "builtin", external: false, hidden: k === SETTINGS_PAGE ? false : !!c?.hidden, archived: false, mobile: c?.mobile ?? b.mobile, locked: k === SETTINGS_PAGE });
    } else if (c?.custom && c.kind) {
      const href = c.kind === "board" ? customPageHref(k) : (c.href ?? "/");
      out.push({
        key: k,
        href,
        label: c.label ?? "صفحة",
        question: c.kind === "board" ? "لوحة مهام عملتها بنفسك" : "رابط عملته بنفسك",
        builtin: false,
        kind: c.kind,
        board: c.board,
        external: href.startsWith("https://"),
        hidden: !!c.hidden,
        archived: !!c.archivedAt,
        mobile: !!c.mobile,
        locked: false,
        mergedInto: c.mergedInto,
      });
    }
  }
  return out;
}

export const visiblePages = (pages: EffPage[]) => pages.filter((p) => !p.hidden && !p.archived);

/** The config with an entry for EVERY built-in page, in order — an edit starts from here so that «move» and «hide» never reshuffle the rest. */
function withPages(cfg: UiConfig, builtins: BuiltinPage[]): UiConfig {
  const have = new Set(cfg.pages.map((p) => p.key));
  const missing = builtins.filter((b) => !have.has(b.key)).map((b) => ({ key: b.key }));
  return missing.length ? { ...cfg, pages: [...cfg.pages, ...missing] } : cfg;
}

const patchPage = (cfg: UiConfig, k: string, patch: Partial<PageCfgT>): UiConfig => ({ ...cfg, pages: cfg.pages.map((p) => (p.key === k ? { ...p, ...patch } : p)) });

function findPage(cfg: UiConfig, builtins: BuiltinPage[], k: string): { eff: EffPage; base: UiConfig } | { error: string } {
  const base = withPages(cfg, builtins);
  const eff = effectivePages(base, builtins).find((p) => p.key === k);
  return eff ? { eff, base } : { error: "الصفحة مش موجودة" };
}

const labelTaken = (pages: EffPage[], text: string, except?: string) => pages.some((p) => !p.archived && p.key !== except && sameName(p.label, text));

export function addPage(cfg: UiConfig, builtins: BuiltinPage[], a: { id: string; kind: PageKind; label: string; board?: string; href?: string }): UiEdit {
  const l = cleanLabel(a.label);
  if (!l.ok) return l;
  const base = withPages(cfg, builtins);
  const pages = effectivePages(base, builtins);
  if (base.pages.filter((p) => p.custom && !p.archivedAt).length >= LIMITS.pages) return fail(`وصلت للحد (${LIMITS.pages} صفحة من صنعك)`);
  if (visiblePages(pages).length >= MAX_SIDEBAR) return fail(`السايدبار أقصى شي ${MAX_SIDEBAR} صفحات — اخفي وحدة أول`);
  if (labelTaken(pages, l.label)) return fail("في صفحة بنفس الاسم — ادمجهم أو غيّر الاسم");
  const entry: PageCfgT = { key: a.id, custom: true, kind: a.kind, label: l.label };
  if (a.kind === "board") {
    const b = effectiveBoards(base).find((x) => x.key === a.board && !x.archived);
    if (!b) return fail("اللوحة مش موجودة");
    entry.board = b.key;
  } else {
    const h = cleanHref(a.href ?? "");
    if (!h.ok) return h;
    entry.href = h.href;
  }
  // before «الإعدادات», which stays last
  const at = base.pages.findIndex((p) => p.key === SETTINGS_PAGE);
  const next = at >= 0 ? [...base.pages.slice(0, at), entry, ...base.pages.slice(at)] : [...base.pages, entry];
  return done({ ...base, pages: next }, `صفحة جديدة «${l.label}»`);
}

export function renamePage(cfg: UiConfig, builtins: BuiltinPage[], k: string, text: string): UiEdit {
  const l = cleanLabel(text);
  if (!l.ok) return l;
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  if (labelTaken(effectivePages(f.base, builtins), l.label, k)) return fail("في صفحة بنفس الاسم");
  return done(patchPage(f.base, k, { label: l.label }), `صفحة «${f.eff.label}» صارت «${l.label}»`);
}

export function setPageHidden(cfg: UiConfig, builtins: BuiltinPage[], k: string, hidden: boolean): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  if (f.eff.locked && hidden) return fail("«الإعدادات» ما بتنخفي — منها بترجع لأي شي");
  if (f.eff.archived) return fail("الصفحة بالمحذوفات — رجّعها أول");
  if (!hidden && f.eff.hidden && visiblePages(effectivePages(f.base, builtins)).length >= MAX_SIDEBAR) return fail(`السايدبار أقصى شي ${MAX_SIDEBAR} صفحات — اخفي وحدة أول`);
  return done(patchPage(f.base, k, { hidden }), hidden ? `صفحة «${f.eff.label}» انخفت` : `صفحة «${f.eff.label}» رجعت`);
}

export function setPageMobile(cfg: UiConfig, builtins: BuiltinPage[], k: string, mobile: boolean): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  if (mobile && !f.eff.mobile && visiblePages(effectivePages(f.base, builtins)).filter((p) => p.mobile).length >= MAX_PHONE_BAR) return fail(`شريط الجوال بيسع ${MAX_PHONE_BAR} صفحات — شيل وحدة أول`);
  return done(patchPage(f.base, k, { mobile }), mobile ? `«${f.eff.label}» على شريط الجوال` : `«${f.eff.label}» نزلت لـ «المزيد»`);
}

export function movePage(cfg: UiConfig, builtins: BuiltinPage[], k: string, dir: -1 | 1): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  const eff = effectivePages(f.base, builtins);
  const shown = new Set(visiblePages(eff).map((p) => p.key));
  if (!shown.has(k)) return fail("اظهرها أول");
  const at = f.base.pages.findIndex((p) => p.key === k);
  const next = swapWithNeighbour(f.base.pages, at, dir, (p) => shown.has(p.key));
  return next ? done({ ...f.base, pages: next }, `صفحة «${f.eff.label}» اتحرّكت`) : fail(dir < 0 ? "هي أول وحدة" : "هي آخر وحدة");
}

export function archivePage(cfg: UiConfig, builtins: BuiltinPage[], k: string, at: string): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  if (f.eff.builtin) return fail("صفحات النظام بتنخفي بس — ما بتنحذف");
  if (f.eff.archived) return fail("هي بالمحذوفات أصلاً");
  return done(patchPage(f.base, k, { archivedAt: isoNow(at) }), `صفحة «${f.eff.label}» انحذفت (بتقدر ترجّعها)`);
}

export function restorePage(cfg: UiConfig, builtins: BuiltinPage[], k: string): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  if (!f.eff.archived) return fail("الصفحة مش محذوفة");
  if (visiblePages(effectivePages(f.base, builtins)).length >= MAX_SIDEBAR) return fail(`السايدبار أقصى شي ${MAX_SIDEBAR} صفحات — اخفي وحدة أول`);
  const { archivedAt: _a, mergedInto: _m, ...rest } = f.base.pages.find((p) => p.key === k)!;
  void _a;
  void _m;
  return done({ ...f.base, pages: f.base.pages.map((p) => (p.key === k ? rest : p)) }, `صفحة «${f.eff.label}» رجعت`);
}

export function mergePages(cfg: UiConfig, builtins: BuiltinPage[], from: string, into: string, at: string): UiEdit {
  if (from === into) return fail("اختار صفحتين مختلفتين");
  const a = findPage(cfg, builtins, from);
  const b = findPage(cfg, builtins, into);
  if ("error" in a) return fail(a.error);
  if ("error" in b) return fail(b.error);
  if (a.eff.builtin) return fail("صفحات النظام ما بتندمج — ادمج الصفحة اللي عملتها فيها");
  if (a.eff.archived || b.eff.archived) return fail("وحدة منهم بالمحذوفات");
  return done(patchPage(a.base, from, { archivedAt: isoNow(at), mergedInto: into }), `«${a.eff.label}» اندمجت بـ «${b.eff.label}»`);
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
  if (cfg.pages.some((p) => p.custom && !p.archivedAt && p.board === k)) return fail("في صفحة بالسايدبار مربوطة فيها — احذفها أو ادمجها أول");
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
  // what the merge put on the other board comes off it again, and the sidebar pages that opened this one open it
  const unwiden = <T extends { boards?: string[] }>(item: T): T => {
    if (!into || !item.boards) return item;
    const left = item.boards.filter((x) => x !== into);
    return left.length ? { ...item, boards: left } : item;
  };
  const next: UiConfig = {
    ...f.base,
    boards: f.base.boards.map((b) => (b.key === k ? rest : b)),
    fields: widened ? f.base.fields.map((x) => (widened.fields.includes(x.id) ? unwiden(x) : x)) : f.base.fields,
    buttons: widened ? f.base.buttons.map((x) => (widened.buttons.includes(x.id) ? unwiden(x) : x)) : f.base.buttons,
    pages: widened ? f.base.pages.map((p) => (widened.pages.includes(p.key) ? { ...p, board: k } : p)) : f.base.pages,
  };
  return done(next, `لوحة «${f.eff.label}» رجعت`, into && ids?.length ? { moveBack: { from: k, into, ids } } : {});
}

/**
 * Merges board `from` into `into`: its tasks move there (the caller moves them, and passes their ids and their count), the board
 * is archived with a pointer, the fields and buttons that were only on it now show on `into` too, and a sidebar page that opened
 * it opens `into`. Nothing is lost: the ids are kept so the merge can be undone.
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
  // a field or a button that was on this board only is now on the other as well (this board stays in its scope: nothing sits on it any more)
  const widens = (item: { boards?: string[] }) => !!item.boards?.includes(a.from) && !item.boards.includes(a.into);
  const widen = <T extends { boards?: string[] }>(item: T): T => (widens(item) ? { ...item, boards: [...item.boards!, a.into] } : item);
  const keepIds = a.taskCount <= LIMITS.moved ? a.taskIds.slice(0, LIMITS.moved) : undefined;
  const widened = { fields: base.fields.filter(widens).map((f) => f.id), buttons: base.buttons.filter(widens).map((b) => b.id), pages: base.pages.filter((p) => p.custom && p.board === a.from).map((p) => p.key) };
  const next: UiConfig = {
    ...patchBoard(base, a.from, { archivedAt: isoNow(at), mergedInto: a.into, movedTaskIds: keepIds, movedCount: a.taskCount, widened }),
    pages: base.pages.map((p) => (p.custom && p.board === a.from ? { ...p, board: a.into } : p)),
    fields: base.fields.map(widen),
    buttons: base.buttons.map(widen),
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

export function buttonsFor(cfg: UiConfig, entity: Entity, board?: string, opts: { hidden?: boolean } = {}): ButtonCfgT[] {
  return onBoard(cfg.buttons.filter((b) => b.entity === entity && !b.archivedAt && (opts.hidden || !b.hidden)), board);
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

const fieldName = (cfg: UiConfig, id: string) => cfg.fields.find((f) => f.id === id)?.label ?? id;

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

// ───────────────────────────── buttons ─────────────────────────────

export function addButton(cfg: UiConfig, a: { id: string; entity: Entity; label: string; workflow: string; workflowKeys: string[]; boards?: string[]; confirm?: boolean }): UiEdit {
  const l = cleanLabel(a.label, LIMITS.button);
  if (!l.ok) return l;
  if (cfg.buttons.length >= LIMITS.buttons) return fail(`وصلت للحد (${LIMITS.buttons} زر)`);
  if (!a.workflowKeys.includes(a.workflow)) return fail("الورك فلو مش موجود");
  if (cfg.buttons.some((b) => b.entity === a.entity && !b.archivedAt && b.workflow === a.workflow && sameName(b.label, l.label))) return fail("في زر بنفس الاسم والورك فلو");
  const scope = checkScope(withBoards(cfg), a.entity, a.boards);
  if (!scope.ok) return scope;
  const b: ButtonCfgT = { id: a.id, entity: a.entity, label: l.label, workflow: a.workflow, ...(scope.boards ? { boards: scope.boards } : {}), confirm: a.confirm ?? true };
  return done({ ...cfg, buttons: [...cfg.buttons, b] }, `زر جديد «${l.label}»`);
}

export function updateButton(cfg: UiConfig, id: string, p: { label?: string; workflow?: string; workflowKeys?: string[]; boards?: string[] | null; confirm?: boolean; hidden?: boolean }): UiEdit {
  const b = cfg.buttons.find((x) => x.id === id);
  if (!b) return fail("الزر مش موجود");
  if (b.archivedAt) return fail("الزر بالمحذوفات — رجّعه أول");
  const next: ButtonCfgT = { ...b };
  if (p.label !== undefined) {
    const l = cleanLabel(p.label, LIMITS.button);
    if (!l.ok) return l;
    next.label = l.label;
  }
  if (p.workflow !== undefined) {
    if (!(p.workflowKeys ?? []).includes(p.workflow)) return fail("الورك فلو مش موجود");
    next.workflow = p.workflow;
  }
  if (p.boards !== undefined) {
    const scope = checkScope(withBoards(cfg), b.entity, p.boards ?? undefined);
    if (!scope.ok) return scope;
    if (scope.boards) next.boards = scope.boards;
    else delete next.boards;
  }
  if (p.confirm !== undefined) next.confirm = p.confirm;
  if (p.hidden !== undefined) next.hidden = p.hidden;
  return done({ ...cfg, buttons: cfg.buttons.map((x) => (x.id === id ? next : x)) }, `زر «${b.label}» اتعدّل`);
}

export function moveButton(cfg: UiConfig, id: string, dir: -1 | 1): UiEdit {
  const b = cfg.buttons.find((x) => x.id === id);
  if (!b) return fail("الزر مش موجود");
  const at = cfg.buttons.findIndex((x) => x.id === id);
  const next = swapWithNeighbour(cfg.buttons, at, dir, (x) => x.entity === b.entity && !x.archivedAt);
  return next ? done({ ...cfg, buttons: next }, `زر «${b.label}» اتحرّك`) : fail(dir < 0 ? "هو أول واحد" : "هو آخر واحد");
}

export function archiveButton(cfg: UiConfig, id: string, at: string): UiEdit {
  const b = cfg.buttons.find((x) => x.id === id);
  if (!b) return fail("الزر مش موجود");
  if (b.archivedAt) return fail("هو بالمحذوفات أصلاً");
  return done({ ...cfg, buttons: cfg.buttons.map((x) => (x.id === id ? { ...x, archivedAt: isoNow(at) } : x)) }, `زر «${b.label}» انحذف (بتقدر ترجّعه)`);
}

export function restoreButton(cfg: UiConfig, id: string): UiEdit {
  const b = cfg.buttons.find((x) => x.id === id);
  if (!b) return fail("الزر مش موجود");
  if (!b.archivedAt) return fail("الزر مش محذوف");
  const { archivedAt: _a, ...rest } = b;
  void _a;
  return done({ ...cfg, buttons: cfg.buttons.map((x) => (x.id === id ? rest : x)) }, `زر «${b.label}» رجع`);
}

// ───────────────────────────── drag to reorder, and changing a field's type ─────────────────────────────

/** `id` takes the place of `onto` (and the ones between shift by one) — what dropping a row onto another means. Only items `eligible` count. */
function dropOnto<T>(list: T[], from: number, onto: number, eligible: (x: T) => boolean): T[] | null {
  if (from < 0 || onto < 0 || from === onto || !eligible(list[from]!) || !eligible(list[onto]!)) return null;
  const out = list.filter((_, i) => i !== from);
  out.splice(onto, 0, list[from]!);
  return out;
}

export function movePageTo(cfg: UiConfig, builtins: BuiltinPage[], k: string, onto: string): UiEdit {
  const f = findPage(cfg, builtins, k);
  if ("error" in f) return fail(f.error);
  const shown = new Set(visiblePages(effectivePages(f.base, builtins)).map((p) => p.key));
  if (!shown.has(k) || !shown.has(onto)) return fail("اظهرها أول");
  const next = dropOnto(f.base.pages, f.base.pages.findIndex((p) => p.key === k), f.base.pages.findIndex((p) => p.key === onto), (p) => shown.has(p.key));
  return next ? done({ ...f.base, pages: next }, `صفحة «${f.eff.label}» اتحرّكت`) : fail("ما تغيّر ترتيب");
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

export function moveButtonTo(cfg: UiConfig, id: string, onto: string): UiEdit {
  const b = cfg.buttons.find((x) => x.id === id);
  const t = cfg.buttons.find((x) => x.id === onto);
  if (!b || !t) return fail("الزر مش موجود");
  if (b.entity !== t.entity) return fail("الزرّين مش على نفس نوع البطاقة");
  const next = dropOnto(cfg.buttons, cfg.buttons.indexOf(b), cfg.buttons.indexOf(t), (x) => x.entity === b.entity && !x.archivedAt);
  return next ? done({ ...cfg, buttons: next }, `زر «${b.label}» اتحرّك`) : fail("ما تغيّر ترتيب");
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
  kind: "page" | "board" | "field" | "button" | "tasks" | "workflow";
  text: string;
  /** what one tap does (an op of the edit API); absent: only a place to look */
  op?: UiOpShape;
  href?: string;
}

export interface SuggestInput {
  cfg: UiConfig;
  builtins: BuiltinPage[];
  /** open tasks per board key, and values per field id */
  boardTasks: Record<string, number>;
  fieldValues: Record<string, number>;
  /** groups of tasks that look like the same job (src/core/tasks.ts `duplicateGroups`) */
  taskGroups: number;
  workflows: { key: string; name: string }[];
}

const closeNames = (a: string, b: string) => {
  const x = squash(a);
  const y = squash(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
};

/** Same name, or one inside the other: the pages, boards, fields, buttons and workflows that look like one — and the tasks, which the board already merges. */
export function suggestMerges(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];

  const pages = effectivePages(i.cfg, i.builtins).filter((p) => !p.archived);
  for (let a = 0; a < pages.length; a++) {
    for (let b = a + 1; b < pages.length; b++) {
      const p = pages[a]!;
      const q = pages[b]!;
      if (p.builtin && q.builtin) continue;
      if (!(closeNames(p.label, q.label) || (p.href === q.href && p.href !== "/"))) continue;
      const [from, into] = p.builtin ? [q, p] : [p, q];
      out.push({ id: `page:${from.key}:${into.key}`, kind: "page", text: `صفحتين شبه بعض: «${from.label}» و«${into.label}»`, op: { op: "page.merge", from: from.key, into: into.key } });
    }
  }

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
        out.push({ id: `field:${drop.id}:${keep.id}`, kind: "field", text: `حقلين شبه بعض (${ENTITY_AR[entity]}): «${drop.label}» و«${keep.label}»`, op: { op: "field.merge", from: drop.id, into: keep.id } });
      }
    }
  }

  const buttons = i.cfg.buttons.filter((b) => !b.archivedAt);
  for (let a = 0; a < buttons.length; a++) {
    for (let b = a + 1; b < buttons.length; b++) {
      const p = buttons[a]!;
      const q = buttons[b]!;
      if (p.entity === q.entity && p.workflow === q.workflow && sameName(p.label, q.label)) out.push({ id: `button:${q.id}`, kind: "button", text: `زرّين نفس الشي: «${p.label}»`, op: { op: "button.archive", id: q.id } });
    }
  }

  if (i.taskGroups > 0) out.push({ id: "tasks", kind: "tasks", text: `${i.taskGroups} ${i.taskGroups === 1 ? "مجموعة" : "مجموعات"} مهام شبه بعض — ادمجها من لوحة المهام`, href: "/tasks/team" });

  const seen = new Map<string, { key: string; name: string }>();
  for (const w of i.workflows) {
    const k = squash(w.name);
    const first = seen.get(k);
    if (first) out.push({ id: `workflow:${w.key}`, kind: "workflow", text: `ورك فلوين بنفس الاسم: «${w.name}» (${first.key} و${w.key})`, href: "/workflow" });
    else seen.set(k, w);
  }
  return out;
}

// ───────────────────────────── the edit API: one op, one pure function ─────────────────────────────

const id = z.string().trim().min(1).max(40);
const dir = z.union([z.literal(-1), z.literal(1)]);
const boardsList = z.array(key).max(LIMITS.boards).nullable().optional();

/** Every change the panel can ask for. The server checks the caller, gathers the facts an op needs (task counts, value counts, the workflows), runs the pure function and writes the result. */
export const UiOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("page.add"), kind: z.enum(PAGE_KINDS), label: z.string().max(200), board: key.optional(), href: z.string().max(600).optional() }).strict(),
  z.object({ op: z.literal("page.rename"), key: id, label: z.string().max(200) }).strict(),
  z.object({ op: z.literal("page.hide"), key: id, hidden: z.boolean() }).strict(),
  z.object({ op: z.literal("page.mobile"), key: id, mobile: z.boolean() }).strict(),
  z.object({ op: z.literal("page.move"), key: id, dir }).strict(),
  z.object({ op: z.literal("page.drop"), key: id, onto: id }).strict(),
  z.object({ op: z.literal("page.archive"), key: id }).strict(),
  z.object({ op: z.literal("page.restore"), key: id }).strict(),
  z.object({ op: z.literal("page.merge"), from: id, into: id }).strict(),
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
  z.object({ op: z.literal("button.add"), entity: z.enum(ENTITIES), label: z.string().max(200), workflow: z.string().max(60), boards: boardsList, confirm: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("button.update"), id, label: z.string().max(200).optional(), workflow: z.string().max(60).optional(), boards: boardsList, confirm: z.boolean().optional(), hidden: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("button.move"), id, dir }).strict(),
  z.object({ op: z.literal("button.drop"), id, onto: id }).strict(),
  z.object({ op: z.literal("button.archive"), id }).strict(),
  z.object({ op: z.literal("button.restore"), id }).strict(),
]);
export type UiOp = z.infer<typeof UiOpSchema>;
