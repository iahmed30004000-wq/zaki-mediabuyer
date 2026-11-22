/**
 * THE DRIVE LIBRARY (v3 · I), pure: what the owner's «Zaki Production» Drive tells the bank — which Drive file is which
 * video, which scenario file belongs to which video, and the rows of his register. READ ONLY: nothing here names a file to
 * rename, move or delete.
 *
 *   06_الفيديوهات النهائية / <product> / <video files>     → a video's Drive file
 *   03_السيناريوهات / (<product> /) <scenario files>        → a video's scenario file
 *   the register (a CSV or a Sheet)                         → JOB · V name · product · status · file ids
 *
 * A file belongs to a video when the video's V name (else its JOB) is a whole token of the file's name — the rule an ad's
 * name already follows (containsToken). A link is only ever SET WHERE EMPTY: what the owner or Claude pushed is never
 * overwritten. Nothing is guessed: a file that fits nothing, or two videos, or a video with two files, is listed and left alone.
 */
import { containsToken, driveId, type VideoState } from "./video-board";
import { normalizeArabic } from "./naming";

export const DRIVE_FOLDERS = { finals: "06_الفيديوهات النهائية", scenarios: "03_السيناريوهات" } as const;

/** Two folder names are the same when they read the same after Arabic letters are unified and separators are spaces. */
export const sameName = (a: string, b: string): boolean => normalizeArabic(a) === normalizeArabic(b);

// ───────────────────────────── the register, as a CSV ─────────────────────────────

/** A CSV as rows of cells: a BOM, quotes with commas and line breaks inside, doubled quotes, and `,` `;` or a tab as the separator. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => {
    let n = 0;
    let quoted = false;
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const delim = ([",", ";", "\t"] as const).reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

export type RegisterField = "job" | "vName" | "product" | "status" | "drive" | "scenario" | "notes";

/** The words a column may be called, in the owner's English and Arabic (compared after Arabic letters are unified). */
const HEADERS: Record<RegisterField, string[]> = {
  job: ["job", "job id", "jobid", "job number", "job no", "جوب", "رقم الجوب", "رقم المهمة"],
  vName: ["v", "v name", "vname", "v number", "video", "video name", "اسم الفيديو", "الفيديو", "رقم الفيديو"],
  product: ["product", "product code", "المنتج", "رمز المنتج", "كود المنتج"],
  status: ["status", "state", "الحالة"],
  drive: ["drive", "drive id", "drive file", "drive file id", "drive link", "file id", "video link", "رابط الفيديو", "ملف الفيديو", "رابط درايف"],
  scenario: ["scenario", "scenario link", "scenario file", "السيناريو", "رابط السيناريو", "ملف السيناريو"],
  notes: ["notes", "note", "ملاحظات"],
};

/** A Drive file id from a link (…/d/ID/…, …?id=ID) or from the id itself; null when it is neither. */
export function driveIdOf(text: string | null | undefined): string | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const m = /\/d\/([A-Za-z0-9_-]{6,120})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{6,120})/.exec(s);
  return driveId(m ? m[1] : s);
}

const STATUS_WORDS: [RegExp, VideoState][] = [
  [/^(bank|بنك|بالبنك)$/, "bank"],
  [/^(requested|مطلوب)$/, "requested"],
  [/^(ready|جاهز)$/, "ready"],
  [/^(uploaded|مرفوع)$/, "uploaded"],
  [/^(testing|test|تجريب|تيست|بالتجربة|قيد التجربة)$/, "testing"],
  [/^(winner|رابح)$/, "winner"],
  [/^(fatigued|tired|تعبان|تعب)$/, "fatigued"],
  [/^(dropped|مستبعد|ملغي)$/, "dropped"],
];

export interface RegisterRow {
  job: string;
  vName: string;
  product: string | null;
  status: VideoState | null;
  driveFileId: string | null;
  scenarioFileId: string | null;
  notes: string | null;
}

export interface Register {
  rows: RegisterRow[];
  /** which header each field was read from (so the owner can see what was understood) */
  mapped: Partial<Record<RegisterField, string>>;
  problems: string[];
}

/** The owner's register as bank rows. The header row is the first one that names a JOB column and a video-name column. */
export function readRegister(cells: string[][]): Register {
  const norm = (s: string) => normalizeArabic(s);
  const find = (header: string[], field: RegisterField) => header.findIndex((h) => HEADERS[field].some((w) => norm(w) === norm(h)));
  const at = cells.findIndex((r) => find(r, "job") >= 0 && find(r, "vName") >= 0);
  if (at < 0) return { rows: [], mapped: {}, problems: ["ما لقيت بالسجل عمود JOB وعمود اسم الفيديو (V) — ما انقرا شي"] };
  const header = cells[at]!;
  const col = Object.fromEntries((Object.keys(HEADERS) as RegisterField[]).map((f) => [f, find(header, f)])) as Record<RegisterField, number>;
  const mapped = Object.fromEntries((Object.keys(HEADERS) as RegisterField[]).filter((f) => col[f] >= 0).map((f) => [f, header[col[f]]!])) as Partial<Record<RegisterField, string>>;
  const rows: RegisterRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  cells.slice(at + 1).forEach((r, i) => {
    const get = (f: RegisterField) => (col[f] >= 0 ? (r[col[f]] ?? "").trim() : "");
    const job = get("job");
    const vName = get("vName");
    if (!job && !vName) return;
    if (!job || !vName) {
      problems.push(`سطر ${at + i + 2}: ناقص ${!job ? "JOB" : "اسم الفيديو"} — انتخطى`);
      return;
    }
    const key = `${job}|${vName}`;
    if (seen.has(key)) {
      problems.push(`سطر ${at + i + 2}: ${vName} (JOB ${job}) مكرر بالسجل — انأخد الأول`);
      return;
    }
    seen.add(key);
    const word = normalizeArabic(get("status"));
    rows.push({
      job,
      vName,
      product: get("product") || null,
      status: STATUS_WORDS.find(([rx]) => rx.test(word))?.[1] ?? null,
      driveFileId: driveIdOf(get("drive")),
      scenarioFileId: driveIdOf(get("scenario")),
      notes: get("notes").slice(0, 300) || null,
    });
  });
  return { rows, mapped, problems };
}

// ───────────────────────────── files ↔ videos ─────────────────────────────

export interface LibraryVideo {
  key: string;
  job: string | null;
  vName: string | null;
  product: string;
  driveFileId: string | null;
  scenarioFileId: string | null;
}

export interface LibraryFile {
  id: string;
  name: string;
  /** the product of the folder it sits in, when the folder's name says one */
  product: string | null;
}

export type LinkField = "driveFileId" | "scenarioFileId";

export interface LinkPlan {
  /** to set (the video had none) */
  links: { key: string; field: LinkField; fileId: string; fileName: string }[];
  /** files no video's name fits */
  unmatched: LibraryFile[];
  /** a file two videos fit, or a video two files fit — nobody is picked */
  ambiguous: { name: string; reason: string }[];
  /** the video already points at another file — left as it is */
  conflicts: { key: string; field: LinkField; has: string; found: string; fileName: string }[];
  /** the video already points at this very file */
  already: number;
}

/** The file's name without its extension and its version tail («V215_v2.mp4» still names V215). */
const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, "");

/**
 * Which file is which video's. The V name is the strongest tie (the longest one that fits wins); the JOB number is used only
 * when no V name fits, and only when it is at least 3 characters (a «7» would fit anything). A file in a product's folder
 * only fits that product's videos.
 */
export function linkFiles(videos: LibraryVideo[], files: LibraryFile[], field: LinkField): LinkPlan {
  const plan: LinkPlan = { links: [], unmatched: [], ambiguous: [], conflicts: [], already: 0 };
  const claims = new Map<string, LibraryFile[]>();
  for (const f of files) {
    const hay = stem(f.name);
    const fits = videos
      .filter((v) => !f.product || v.product === "—" || v.product === f.product)
      .map((v) => ({ v, score: v.vName && containsToken(hay, v.vName) ? 1000 + v.vName.length : v.job && v.job.length >= 3 && containsToken(hay, v.job) ? v.job.length : 0 }))
      .filter((x) => x.score > 0);
    if (!fits.length) {
      plan.unmatched.push(f);
      continue;
    }
    const top = Math.max(...fits.map((x) => x.score));
    const best = fits.filter((x) => x.score === top);
    if (best.length > 1) {
      plan.ambiguous.push({ name: f.name, reason: `بيناسب أكتر من فيديو: ${best.map((x) => x.v.vName ?? x.v.job ?? x.v.key).join("، ")}` });
      continue;
    }
    claims.set(best[0]!.v.key, [...(claims.get(best[0]!.v.key) ?? []), f]);
  }
  for (const [key, list] of claims) {
    const v = videos.find((x) => x.key === key)!;
    const has = v[field];
    if (list.length > 1) {
      // the same file listed twice never happens in Drive, so this is two files for one video: the owner picks
      if (has && list.some((f) => f.id === has)) {
        plan.already++;
        continue;
      }
      plan.ambiguous.push({ name: list.map((f) => f.name).join(" · "), reason: `أكتر من ملف لنفس الفيديو (${v.vName ?? v.job ?? key})` });
      continue;
    }
    const f = list[0]!;
    if (!has) plan.links.push({ key, field, fileId: f.id, fileName: f.name });
    else if (has === f.id) plan.already++;
    else plan.conflicts.push({ key, field, has, found: f.id, fileName: f.name });
  }
  return plan;
}

// ───────────────────────────── the register against the bank ─────────────────────────────

export interface RegisterPlan {
  /** videos the bank does not have yet */
  create: RegisterRow[];
  /** fields the bank has empty and the register knows */
  fill: { job: string; vName: string; data: { productCode?: string; driveFileId?: string; scenarioFileId?: string } }[];
  untouched: number;
  /** product names in the register the app does not know (nothing is created for them) */
  unknownProducts: string[];
}

/**
 * The register against the bank. A video the bank lacks is added (as the register says, «بالبنك» when it says nothing); a
 * video it has only gets its EMPTY fields filled — a status or a file the owner or Claude already set is never overwritten.
 */
export function planRegister(rows: RegisterRow[], bank: { job: string | null; vName: string | null; product: string; driveFileId: string | null; scenarioFileId: string | null }[], productOf: (name: string) => string | null): RegisterPlan {
  const plan: RegisterPlan = { create: [], fill: [], untouched: 0, unknownProducts: [] };
  for (const r of rows) {
    const code = r.product ? productOf(r.product) : null;
    const have = bank.find((b) => b.job === r.job && b.vName === r.vName);
    if (!have) {
      if (code) plan.create.push({ ...r, product: code });
      else {
        plan.untouched++;
        if (r.product && !plan.unknownProducts.includes(r.product)) plan.unknownProducts.push(r.product);
      }
      continue;
    }
    const data: RegisterPlan["fill"][number]["data"] = {};
    if (!have.driveFileId && r.driveFileId) data.driveFileId = r.driveFileId;
    if (!have.scenarioFileId && r.scenarioFileId) data.scenarioFileId = r.scenarioFileId;
    if (Object.keys(data).length) plan.fill.push({ job: r.job, vName: r.vName, data });
    else plan.untouched++;
  }
  return plan;
}

/** Up to this many folder names are written in the alert; more than that is a count and a link (U-11: one alert with 24 folder names is a wall). */
export const FOLDER_NAMES_IN_ALERT = 3;

/**
 * The sentence of the alert «folders with no product» — the names when they are few, else «24 مجلد درايف ما إلهم منتج — اربطهم» (the link is the alert's `href`, the products
 * settings). `where` is what the folders belong to: «درايف» or «الاستوديو».
 */
export function unmappedFoldersSentence(names: readonly string[], where: "درايف" | "الاستوديو" = "درايف"): string {
  if (names.length > FOLDER_NAMES_IN_ALERT) return `${names.length} مجلد ${where} ما إلهم منتج — اربطهم`;
  return where === "درايف"
    ? `مجلد درايف «${names.join("، ")}» ما إله منتج معروف — ضيف اسم بديل للمنتج من الإعدادات وبينربط ملفه لحاله`
    : `مجلد الاستوديو «${names.join("، ")}» ما إله منتج معروف — ضيف اسم بديل للمنتج من الإعدادات وبيندخل الفيديو عالوارد لحاله`;
}
