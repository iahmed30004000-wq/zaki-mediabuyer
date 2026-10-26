/**
 * meta.sync — accounts, structure and daily ad insights into the archive (spec 13.6 meta.intraday / meta.final).
 * Idempotent: every write is an upsert on Meta's id (structure) or (level, object, date) (numbers), so pulling the
 * same day again replaces it and never duplicates. Names are parsed on the way in; a campaign whose name cannot be
 * read is kept with namingOk=false («بدها تسمية») and its product found through the aliases when possible.
 */
import { db } from "@/server/db";
import { decryptSecrets } from "@/server/crypto";
import { getSetting } from "@/server/settings";
import { parseAdName, parseAdSetName, parseCampaignName, productFromLegacyName, type ProductAlias } from "@/core/naming";
import { MetaClient } from "@/meta/client";
import { readAccounts, readAdSets, readAds, readCampaigns, readInsights, toInsightRow } from "@/meta/read";

const money = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v) / 100); // Meta budgets are in cents

async function aliases(): Promise<ProductAlias[]> {
  const rows = await db.productAlias.findMany();
  const products = await db.productEconomics.findMany();
  return products.map((p) => ({ code: p.productCode, name: p.name, aliases: rows.filter((r) => r.productCode === p.productCode).map((r) => r.alias) }));
}

/** The System User token: META_SYSTEM_USER_TOKEN, or the newest active encrypted connection. Never logged. */
export async function metaToken(): Promise<string | null> {
  if (process.env.META_SYSTEM_USER_TOKEN?.trim()) return process.env.META_SYSTEM_USER_TOKEN.trim();
  const c = await db.metaConnection.findFirst({ where: { status: "active" }, orderBy: { createdAt: "desc" } });
  return decryptSecrets<{ token: string }>(c?.tokenEnc)?.token ?? null;
}

export async function syncStructure(client: MetaClient) {
  const products = await aliases();
  let campaigns = 0, adsets = 0, ads = 0;
  for (const a of await readAccounts(client)) {
    const metaId = String(a.id);
    const account = await db.adAccount.upsert({
      where: { metaId },
      create: { metaId, name: String(a.name), currency: String(a.currency), timezone: String(a.timezone_name), status: String(a.account_status), spendCapMeta: money(a.spend_cap) },
      update: { name: String(a.name), currency: String(a.currency), timezone: String(a.timezone_name), status: String(a.account_status), spendCapMeta: money(a.spend_cap) },
    });
    const byMetaCampaign = new Map<string, string>();
    for (const c of await readCampaigns(client, metaId)) {
      const name = String(c.name);
      const parsed = parseCampaignName(name);
      const legacy = parsed ? null : productFromLegacyName(name, products);
      const data = {
        accountId: account.id,
        name,
        status: String(c.effective_status),
        objective: (c.objective as string) ?? null,
        parsedMarket: parsed?.market ?? null,
        productCode: parsed?.productCode ?? legacy?.code ?? null,
        parsedObjective: parsed?.objective ?? null,
        stage: parsed?.stage ?? null,
        namingOk: !!parsed,
        productVia: parsed ? "name" : legacy ? "alias" : "none",
        budgetType: c.daily_budget || c.lifetime_budget ? "CBO" : "ABO",
        dailyBudget: money(c.daily_budget),
        bidStrategy: (c.bid_strategy as string) ?? null,
        spendCap: money(c.spend_cap),
      };
      const row = await db.campaign.upsert({ where: { metaId: String(c.id) }, create: { metaId: String(c.id), ...data }, update: data });
      byMetaCampaign.set(String(c.id), row.id);
      campaigns++;
    }
    const byMetaAdSet = new Map<string, string>();
    for (const s of await readAdSets(client, metaId)) {
      const campaignId = byMetaCampaign.get(String(s.campaign_id));
      if (!campaignId) continue;
      const p = parseAdSetName(String(s.name));
      const learning = (s.learning_stage_info as { status?: string } | undefined)?.status ?? null;
      const data = { campaignId, name: String(s.name), status: String(s.effective_status), audienceCode: p?.audience ?? null, pageCode: p?.pageCode ?? null, conceptId: p?.conceptId ?? null, optimizationGoal: (s.optimization_goal as string) ?? null, dailyBudget: money(s.daily_budget), learningStage: learning };
      const row = await db.adSet.upsert({ where: { metaId: String(s.id) }, create: { metaId: String(s.id), ...data }, update: data });
      byMetaAdSet.set(String(s.id), row.id);
      adsets++;
    }
    for (const ad of await readAds(client, metaId)) {
      const adSetId = byMetaAdSet.get(String(ad.adset_id));
      if (!adSetId) continue;
      const p = parseAdName(String(ad.name));
      const data = { adSetId, name: String(ad.name), status: String(ad.effective_status), creativeCode: p?.creativeCode ?? null, hookCode: p?.hookCode ?? null, angleCode: p?.angleCode ?? null, lpCode: p?.lpCode ?? null };
      const rejected = ad.effective_status === "DISAPPROVED";
      await db.ad.upsert({ where: { metaId: String(ad.id) }, create: { metaId: String(ad.id), ...data, reviewStatus: rejected ? "DISAPPROVED" : null }, update: { ...data, reviewStatus: rejected ? "DISAPPROVED" : null } });
      if (rejected && !(await db.reviewIssue.findFirst({ where: { adMetaId: String(ad.id), status: "open" } }))) {
        // the rejection is kept with Meta's own words; the appeal draft is written by the safety job (account-safety)
        const fb = (ad.ad_review_feedback as { global?: Record<string, string> } | undefined)?.global ?? {};
        await db.reviewIssue.create({ data: { adMetaId: String(ad.id), adName: String(ad.name), accountMetaId: metaId, feedback: fb } });
      }
      ads++;
    }
  }
  return { campaigns, adsets, ads };
}

/** Daily ad insights for [since, until] of every account (yesterday + the last 7 days at 3:00 is meta.final). */
export async function syncInsights(client: MetaClient, since: string, until: string) {
  const window = await getSetting("attribution.window");
  let rows = 0;
  for (const account of await db.adAccount.findMany()) {
    for (const raw of await readInsights(client, account.metaId, since, until, window)) {
      if (!raw.ad_id) continue;
      const r = toInsightRow(raw, window);
      const { level, objectId, date, ...values } = r;
      const key = { level, objectId, date: new Date(`${date}T00:00:00Z`) };
      await db.insightDaily.upsert({ where: { level_objectId_date: key }, create: { ...key, ...values }, update: values });
      rows++;
    }
  }
  return { rows };
}

export async function syncMeta(opts: { since: string; until: string; fetch?: typeof fetch }) {
  const token = await metaToken();
  if (!token) return { skipped: "no Meta token yet (P0.4)" };
  const client = new MetaClient({
    token,
    fetch: opts.fetch,
    onUsage: (pct) => void db.apiUsage.create({ data: { scope: "meta", callCount: Math.round(pct), cpuTime: 0, totalTime: 0 } }).catch(() => {}),
  });
  const structure = await syncStructure(client);
  const insights = await syncInsights(client, opts.since, opts.until);
  return { ...structure, ...insights, usage: client.usage };
}
