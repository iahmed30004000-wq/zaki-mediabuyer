/**
 * ONE MAP OF JOBS — pure (docs/rebuild-v6/01-model.md §12, W-23 · U-03). The site owns the map and the numbers: the agent's list is a hint.
 * Here is what needs no database: when two names are the same name, the next free number, the pairs that look like one job written twice, the order
 * of the one-time renumbering, and the reference a run keeps when it moves into another job.
 */
import { JOB_DOMAINS } from "./jobs";

export const MAX_JOB_NUMBER = 999;

/** A name as it is compared: no marks, one kind of alef / ya / ha, no punctuation, no spaces, lower case. «جولة  الليل!» = «جولة الليل». */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface MapJob {
  key: string;
  name: string;
  number: number | null;
  domain?: string;
  schedule?: string | null;
  assigneeKey?: string | null;
  enabled?: boolean;
  /** how many runs it has: the job with more history is the one to keep */
  runs?: number;
  createdAt?: string | Date;
}

/** The job (other than `except`) that already has this name, if any. */
export function findNameClash(jobs: readonly Pick<MapJob, "key" | "name">[], name: string, except?: string): Pick<MapJob, "key" | "name"> | null {
  const want = normalizeName(name);
  if (!want) return null;
  return jobs.find((j) => j.key !== except && normalizeName(j.name) === want) ?? null;
}

/** The next free number: one more than the biggest in use (1 when the map is empty), never above 999 — and then the first gap. */
export function nextNumber(used: readonly (number | null | undefined)[]): number {
  const set = new Set(used.filter((n): n is number => typeof n === "number" && n >= 1));
  const top = set.size ? Math.max(...set) : 0;
  if (top < MAX_JOB_NUMBER) return top + 1;
  for (let n = 1; n <= MAX_JOB_NUMBER; n++) if (!set.has(n)) return n;
  throw new Error("الخريطة مليانة (999 مهمة)");
}

export type DuplicateReason = "name" | "schedule" | "linked";
export interface DuplicatePair {
  /** the one to keep */
  keep: string;
  /** the one that would join it */
  drop: string;
  reasons: DuplicateReason[];
}

const time = (v: string | Date | undefined): number => (v === undefined ? Number.MAX_SAFE_INTEGER : new Date(v).getTime());

/**
 * The pairs that look like one job twice: the same name once normalized, or the same cron for the same carrier. The owner decides each one («هاي هي»);
 * nothing is merged here. A group of three becomes two pairs against the one to keep, which is the one with the most history, then the lower number,
 * then the older one.
 */
export function suggestDuplicates(jobs: readonly MapJob[]): DuplicatePair[] {
  const list = [...jobs];
  const parent = new Map(list.map((j) => [j.key, j.key]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const link = (a: string, b: string) => {
    const x = find(a);
    const y = find(b);
    if (x !== y) parent.set(y, x);
  };
  const same = (a: MapJob, b: MapJob): DuplicateReason[] => {
    const why: DuplicateReason[] = [];
    const na = normalizeName(a.name);
    if (na && na === normalizeName(b.name)) why.push("name");
    if (a.schedule && a.schedule.trim() === b.schedule?.trim() && (a.assigneeKey ?? null) === (b.assigneeKey ?? null)) why.push("schedule");
    return why;
  };
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (same(list[i]!, list[j]!).length) link(list[i]!.key, list[j]!.key);

  const groups = new Map<string, MapJob[]>();
  for (const j of list) groups.set(find(j.key), [...(groups.get(find(j.key)) ?? []), j]);
  const out: DuplicatePair[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const ranked = [...g].sort((a, b) => (b.runs ?? 0) - (a.runs ?? 0) || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || time(a.createdAt) - time(b.createdAt) || a.key.localeCompare(b.key));
    const keep = ranked[0]!;
    for (const drop of ranked.slice(1)) {
      const reasons = same(keep, drop);
      out.push({ keep: keep.key, drop: drop.key, reasons: reasons.length ? reasons : ["linked"] });
    }
  }
  return out.sort((a, b) => a.keep.localeCompare(b.keep) || a.drop.localeCompare(b.drop));
}

/**
 * The one-time renumbering after the tidy-up: 1…N in the order domain → old number (a job with none goes last) → name. Returns the number each key gets.
 */
export function renumberOrder(jobs: readonly Pick<MapJob, "key" | "name" | "number" | "domain">[]): Map<string, number> {
  const rank = (d: string | undefined) => {
    const i = (JOB_DOMAINS as readonly string[]).indexOf(d ?? "");
    return i === -1 ? JOB_DOMAINS.length : i;
  };
  const sorted = [...jobs].sort((a, b) => rank(a.domain) - rank(b.domain) || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, "ar") || a.key.localeCompare(b.key));
  return new Map(sorted.map((j, i) => [j.key, i + 1]));
}

/**
 * The reference a run keeps when it moves into another job: its own, unless that job already has one like it — then it takes a suffix
 * («…-m7», «…-m7-2»). `taken` is the set of references the job already has.
 */
export function mergedRef(ref: string, from: { number: number | null; key: string }, taken: ReadonlySet<string>): string {
  if (!taken.has(ref)) return ref;
  const tag = `m${from.number ?? from.key}`.slice(0, 20);
  const base = `${ref.slice(0, 80 - tag.length - 5)}-${tag}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  throw new Error("ما قدرنا نلاقي ref فاضي");
}

/** The key a pushed key leads to: follows «merged into» (a short chain, never a loop). */
export function followMerged(key: string, mergedInto: ReadonlyMap<string, string | null>, maxHops = 5): string {
  let cur = key;
  const seen = new Set<string>([cur]);
  for (let i = 0; i < maxHops; i++) {
    const next = mergedInto.get(cur);
    if (!next || seen.has(next)) break;
    seen.add(next);
    cur = next;
  }
  return cur;
}
