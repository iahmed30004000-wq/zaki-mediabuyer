import { db } from "./db";
import { propose } from "./changes";
import { audit } from "./audit";
import { creativeCodeOf } from "@/core/telegram-command";
import { isDemo } from "@/core/readiness";

const SITE = () => process.env.APP_URL ?? "https://mediabuyer.zakiai.io";

/**
 * «اوقف …» — the one place the words become a safety change set. Used by the Telegram webhook (the media buyer's own bot) and by the signed
 * event from the OMS (the OMS owns the bot): same search, same ChangeSet, same refusal to guess. It only ever PAUSES; the answer is the sentence to
 * show the person who asked.
 * `who` is the actor that is written to the change set and the audit log; `sourceRef` says where the words came from.
 */
export async function stopByQuery(query: string, who: { id: string }, sourceRef: string): Promise<string> {
  if (isDemo(process.env)) return "الوضع التجريبي: ما وقفت شي فعلاً.";

  // find what to pause: a creative code, else a name (ad, ad set, campaign) containing the words
  const code = creativeCodeOf(query);
  const ads = await db.ad.findMany({ where: code ? { creativeCode: code, status: { not: "PAUSED" } } : { name: { contains: query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { adSet: { include: { campaign: { include: { account: true } } } } }, take: 6 });
  const adsets = ads.length ? [] : await db.adSet.findMany({ where: { name: { contains: query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { campaign: { include: { account: true } } }, take: 6 });
  const campaigns = ads.length || adsets.length ? [] : await db.campaign.findMany({ where: { name: { contains: query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { account: true }, take: 6 });
  const hits = [
    ...ads.map((a) => ({ type: "ad" as const, id: a.metaId, name: a.name, account: a.adSet.campaign.account.metaId, status: a.status })),
    ...adsets.map((s) => ({ type: "adset" as const, id: s.metaId, name: s.name, account: s.campaign.account.metaId, status: s.status })),
    ...campaigns.map((c) => ({ type: "campaign" as const, id: c.metaId, name: c.name, account: c.account.metaId, status: c.status })),
  ];
  if (hits.length === 0) return `ما لقيت شي شغّال اسمه «${query}». جرّب رقم الفيديو متل: اوقف CR00147`;
  if (hits.length > 1 && !code) return `لقيت ${hits.length} — حدّد أكتر:\n${hits.map((h) => `• ${h.name}`).join("\n")}`;

  const accounts = new Set(hits.map((h) => h.account));
  const cs = await propose(
    {
      source: "telegram",
      sourceRef,
      reasonCode: "S11",
      sentence: `وقف من تيليجرام: ${hits.map((h) => h.name).join("، ")}`,
      kind: "safety_pause",
      accountMetaId: accounts.size === 1 ? [...accounts][0]! : null,
      items: hits.map((h) => ({ op: "pause", objectType: h.type, objectId: h.id, before: { status: h.status }, after: { status: "PAUSED" } })),
    },
    { type: "user", id: who.id },
  );
  await audit({ type: "user", id: who.id }, "telegram.pause", { type: "changeset", id: cs.id });
  return cs.state === "executed" ? `✓ وقف: ${hits.map((h) => h.name).join("، ")}\nبترجعه من الموقع: ${SITE()}/decisions` : `انسجّل الطلب وبانتظار مراجعة بالموقع: ${SITE()}/decisions`;
}
