/**
 * THE SEARCH BOX (Ctrl+K), pure. It takes what the person typed and the things that could match (pages, products, ads, videos,
 * tasks, workflows…) and says which match and in what order. No model, no guessing: a match is the words typed found in the thing's
 * own words (Arabic written the usual loose ways counts as the same: أ إ آ ا · ى ي · ة ه · tashkeel · «ال»), the best match first.
 */

import { can, canOpenPath, type RoleKey } from "./roles";

export const SEARCH_KINDS =["page", "product", "workflow", "task", "video", "ad", "campaign"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_AR: Record<SearchKind, string> = { page: "صفحات", product: "منتجات", workflow: "مهام مجدولة", task: "مهام", video: "فيديوهات", ad: "إعلانات", campaign: "حملات" };

export interface SearchItem {
  /** stable within its kind */
  id: string;
  kind: SearchKind;
  title: string;
  /** a second line: what it is, where it sits */
  sub?: string;
  href: string;
  /** more words that find it without showing (a code, an id, an alias) */
  words?: string;
}

export interface SearchHit extends SearchItem {
  score: number;
}

/** Loose Arabic and plain Latin to one comparable form: lower case, no tashkeel or tatweel, one alef, one yaa, one haa, no «ال» on a word. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[_\-./\\|:؛،,()[\]{}«»"'`~!؟?]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

const tokens = (q: string): string[] => normalize(q).split(" ").filter(Boolean);

/** The score of one item for the typed tokens, or 0 when any token is missing. */
export function score(query: string, item: SearchItem): number {
  const qt = tokens(query);
  if (!qt.length) return 0;
  const title = normalize(item.title);
  const rest = normalize(`${item.sub ?? ""} ${item.words ?? ""}`);
  const tw = title.split(" ");
  let total = 0;
  for (const t of qt) {
    let s = 0;
    if (title === t) s = 100;
    else if (tw.includes(t)) s = 70;
    else if (title.startsWith(t)) s = 60;
    else if (tw.some((w) => w.startsWith(t))) s = 50;
    else if (title.includes(t)) s = 30;
    else if (rest.split(" ").some((w) => w === t)) s = 25;
    else if (rest.split(" ").some((w) => w.startsWith(t))) s = 18;
    else if (rest.includes(t)) s = 10;
    if (!s) return 0; // every typed word must be found
    total += s;
  }
  // the whole phrase in a row beats the same words apart
  if (qt.length > 1 && title.includes(qt.join(" "))) total += 25;
  return total;
}

const KIND_RANK: Record<SearchKind, number> = Object.fromEntries(SEARCH_KINDS.map((k, i) => [k, i])) as Record<SearchKind, number>;

/** The items that match, best first (ties: pages before data, then the shorter title), at most `limit`. */
export function rank(query: string, items: SearchItem[], limit = 20): SearchHit[] {
  const seen = new Set<string>();
  return items
    .map((it) => ({ ...it, score: score(query, it) }))
    .filter((h) => h.score > 0)
    .filter((h) => {
      const k = `${h.kind}:${h.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.length - b.title.length)
    .slice(0, limit);
}

/** The hits grouped for display, in the order of their best hit; each group keeps its own order. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; label: string; hits: SearchHit[] }[] {
  const groups: { kind: SearchKind; label: string; hits: SearchHit[] }[] = [];
  for (const h of hits) {
    let g = groups.find((x) => x.kind === h.kind);
    if (!g) groups.push((g = { kind: h.kind, label: KIND_AR[h.kind], hits: [] }));
    g.hits.push(h);
  }
  return groups;
}

/** What a role may find: one flag for each kind of name the search reads (S-18). A role finds a name only on a screen it may open, so a hit is never a dead link. */
export interface SearchScope {
  products: boolean;
  ads: boolean;
  campaigns: boolean;
  videos: boolean;
  /** the people's tasks — and which people's is `taskKeysFor` (null = everybody's) */
  tasks: boolean;
  /** the jobs, by area: a job of the ads needs the ads, a job of the operations needs the operations */
  workflows: { ads: boolean; ops: boolean };
}

/**
 * The names the search box may read for a role (v6 · P5, S-18). It follows the SAME rule as the screens the hits lead to (`canOpenPath`: the capability AND the place in the
 * role's bar) — a role that cannot open «الإعلانات» does not find an ad, a campaign, a video or a product by name, and one that cannot open «مهام الفريق» finds no person's task.
 * A role of null is a job or a test: it reads everything.
 */
export function searchScopeOf(role: RoleKey | null): SearchScope {
  if (!role) return { products: true, ads: true, campaigns: true, videos: true, tasks: true, workflows: { ads: true, ops: true } };
  const jobs = canOpenPath(role, "/tasks");
  return {
    products: canOpenPath(role, "/numbers/products"),
    ads: canOpenPath(role, "/ads"),
    campaigns: canOpenPath(role, "/ads"),
    videos: canOpenPath(role, "/ads/videos"),
    tasks: canOpenPath(role, "/tasks/team"),
    workflows: { ads: jobs && can(role, "ads.view"), ops: jobs && can(role, "ops.view") },
  };
}

/** A query is worth a search once it has at least one real character (not only punctuation). */
export const searchable = (q: string): boolean => normalize(q).length >= 1;
