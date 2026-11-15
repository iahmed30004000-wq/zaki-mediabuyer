/**
 * What the search box can find in the data (v3). It reads names only — product, ad, campaign, video, task, workflow — never a customer
 * (there is no customer table in reach here), and never a number: a hit is a title with a link to the screen that shows the rest.
 * The candidates are the most recent rows of each kind; the matching and the order are `src/core/search.ts`, in memory, so loose Arabic
 * spellings find what the database's own `contains` would miss.
 */
import { rank, type SearchHit, type SearchItem } from "@/core/search";
import { db } from "./db";

const PER_KIND = 300;

export async function searchData(query: string, limit = 24): Promise<SearchHit[]> {
  if (process.env.MOCK_MODE === "1") return [];
  const [products, workflows, tasks, videos, ads, campaigns] = await Promise.all([
    db.productEconomics.findMany({ select: { productCode: true, name: true }, take: 200 }),
    db.workflow.findMany({ where: { archivedAt: null }, select: { key: true, name: true, description: true }, take: 100 }),
    db.task.findMany({ where: { archivedAt: null }, select: { id: true, title: true, status: true, board: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }),
    db.videoBankItem.findMany({ select: { id: true, job: true, vName: true, productCode: true, status: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }),
    db.ad.findMany({ select: { metaId: true, name: true, status: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }),
    db.campaign.findMany({ select: { metaId: true, name: true, status: true, productCode: true }, orderBy: { updatedAt: "desc" }, take: PER_KIND }),
  ]);
  const items: SearchItem[] = [
    ...products.map((p) => ({ kind: "product" as const, id: p.productCode, title: p.name, sub: `منتج · ${p.productCode}`, words: p.productCode, href: `/ads?product=${encodeURIComponent(p.productCode)}` })),
    ...workflows.map((w) => ({ kind: "workflow" as const, id: w.key, title: w.name, sub: "ورك فلو", words: `${w.key} ${w.description ?? ""}`, href: `/workflow/${encodeURIComponent(w.key)}` })),
    ...tasks.map((t) => ({ kind: "task" as const, id: t.id, title: t.title, sub: `مهمة · ${t.status}`, href: `/tasks` })),
    ...videos.map((v) => ({ kind: "video" as const, id: v.id, title: `${v.vName} — ${v.job}`, sub: `فيديو · ${v.productCode} · ${v.status}`, words: `${v.job} ${v.vName}`, href: "/videos" })),
    ...ads.map((a) => ({ kind: "ad" as const, id: a.metaId, title: a.name, sub: `إعلان · ${a.status}`, words: a.metaId, href: `/ads?open=${encodeURIComponent(a.metaId)}` })),
    ...campaigns.map((c) => ({ kind: "campaign" as const, id: c.metaId, title: c.name, sub: `حملة · ${c.status}${c.productCode ? ` · ${c.productCode}` : ""}`, words: c.metaId, href: `/ads?${c.productCode ? `product=${encodeURIComponent(c.productCode)}&` : ""}open=${encodeURIComponent(c.metaId)}` })),
  ];
  return rank(query, items, limit);
}
