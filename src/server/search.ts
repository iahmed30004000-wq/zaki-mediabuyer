/**
 * What the search box can find in the data (v3). It reads names only — product, ad, campaign, video, task, workflow — never a customer
 * (there is no customer table in reach here), and never a number: a hit is a title with a link to the screen that shows the rest.
 * The candidates are the most recent rows of each kind; the matching and the order are `src/core/search.ts`, in memory, so loose Arabic
 * spellings find what the database's own `contains` would miss.
 *
 * What a caller finds is filtered by his role (v6 · P5, S-18): a kind he cannot open is not even read, the jobs are kept to his areas and the people's tasks to `taskKeysFor`
 * (the people of his scope; null = everybody's) — so a name never leaves the server for somebody who could not open the screen it leads to.
 */
import { rank, searchScopeOf, type SearchHit, type SearchItem } from "@/core/search";
import type { RoleKey } from "@/core/roles";
import { db } from "./db";

const PER_KIND = 300;

/** `role` is who is searching (null: a job or a test — everything); `taskKeys` the assignees whose tasks he may find (null: all, an empty list: none). */
export async function searchData(query: string, opts: { role: RoleKey | null; taskKeys: string[] | null; limit?: number }): Promise<SearchHit[]> {
  if (process.env.MOCK_MODE === "1") return [];
  const scope = searchScopeOf(opts.role);
  const [products, workflows, tasks, videos, ads, campaigns] = await Promise.all([
    scope.products ? db.productEconomics.findMany({ select: { productCode: true, name: true }, take: 200 }) : [],
    scope.workflows.ads || scope.workflows.ops ? db.workflow.findMany({ where: { archivedAt: null }, select: { key: true, name: true, description: true, domain: true }, take: 100 }) : [],
    scope.tasks && (opts.taskKeys === null || opts.taskKeys.length > 0)
      ? db.task.findMany({ where: { archivedAt: null, ...(opts.taskKeys ? { assignee: { in: opts.taskKeys } } : {}) }, select: { id: true, title: true, status: true, board: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND })
      : [],
    scope.videos ? db.videoBankItem.findMany({ select: { id: true, job: true, vName: true, productCode: true, status: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }) : [],
    scope.ads ? db.ad.findMany({ select: { metaId: true, name: true, status: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }) : [],
    scope.campaigns ? db.campaign.findMany({ select: { metaId: true, name: true, status: true, productCode: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }) : [],
  ]);
  const items: SearchItem[] = [
    ...products.map((p) => ({ kind: "product" as const, id: p.productCode, title: p.name, sub: `منتج · ${p.productCode}`, words: p.productCode, href: `/products/${encodeURIComponent(p.productCode)}` })),
    ...workflows
      .filter((w) => (w.domain === "ops" ? scope.workflows.ops : scope.workflows.ads))
      .map((w) => ({ kind: "workflow" as const, id: w.key, title: w.name, sub: "مهمة مجدولة", words: `${w.key} ${w.description ?? ""}`, href: `/tasks/${encodeURIComponent(w.key)}` })),
    ...tasks.map((t) => ({ kind: "task" as const, id: t.id, title: t.title, sub: `مهمة · ${t.status}`, href: `/tasks/team` })),
    ...videos.map((v) => ({ kind: "video" as const, id: v.id, title: `${v.vName} — ${v.job}`, sub: `فيديو · ${v.productCode} · ${v.status}`, words: `${v.job} ${v.vName}`, href: "/ads/videos" })),
    ...ads.map((a) => ({ kind: "ad" as const, id: a.metaId, title: a.name, sub: `إعلان · ${a.status}`, words: a.metaId, href: `/ads?open=${encodeURIComponent(a.metaId)}` })),
    ...campaigns.map((c) => ({ kind: "campaign" as const, id: c.metaId, title: c.name, sub: `حملة · ${c.status}${c.productCode ? ` · ${c.productCode}` : ""}`, words: c.metaId, href: `/ads?${c.productCode ? `product=${encodeURIComponent(c.productCode)}&` : ""}open=${encodeURIComponent(c.metaId)}` })),
  ];
  return rank(query, items, opts.limit ?? 24);
}
