/**
 * M04 — the change preparer (spec 11.2 / 11.4). Turns a sentence (the owner's, or a draft the consultant wrote) into
 * change items — and the CODE checks every one: only pause · resume · budget, only objects that exist, the «before»
 * taken from the database (never from the model), a budget move within ±50%, at most 10 items. The result is a
 * change set from source «agent», which ALWAYS waits for a person (src/server/changes.ts), whatever the level.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { HttpError } from "@/server/auth";
import { propose } from "@/server/changes";
import { ask } from "@/gateway";
import type { ActionKind } from "@/core/autonomy";
import type { ChangeItemDraft } from "@/core/changeset";

const Out = z.object({
  items: z.array(z.object({ op: z.string(), object_type: z.string(), object_id: z.string(), before: z.record(z.unknown()).optional(), after: z.record(z.unknown()).optional() })).max(10),
  spend_delta_daily_usd: z.number().optional(),
  warnings: z.array(z.string()).max(5).optional(),
});

export interface Prepared {
  items: ChangeItemDraft[];
  refused: string[];
  warnings: string[];
}

/** The code's check of what the agent proposed. Pure enough to test: `find` returns the object as the database has it. */
export async function checkItems(raw: z.infer<typeof Out>["items"], find: (type: string, id: string) => Promise<{ metaId: string; status: string; dailyBudget: number | null } | null>): Promise<Prepared> {
  const items: ChangeItemDraft[] = [];
  const refused: string[] = [];
  for (const r of raw) {
    const type = r.object_type as ChangeItemDraft["objectType"];
    if (!["campaign", "adset", "ad"].includes(type)) { refused.push(`${r.object_id}: نوع «${r.object_type}» مش مسموح`); continue; }
    if (!["pause", "resume", "set_budget"].includes(r.op)) { refused.push(`${r.object_id}: «${r.op}» مش مسموح للوكيل (إيقاف · تشغيل · ميزانية بس)`); continue; }
    const obj = await find(type, r.object_id);
    if (!obj) { refused.push(`${r.object_id}: مش موجود`); continue; }
    if (r.op === "set_budget") {
      const now = obj.dailyBudget;
      const want = Number((r.after as { daily_budget?: unknown; dailyBudget?: unknown } | undefined)?.daily_budget ?? (r.after as { dailyBudget?: unknown } | undefined)?.dailyBudget);
      if (type === "ad" || !now || !Number.isFinite(want) || want <= 0) { refused.push(`${r.object_id}: ميزانية مش واضحة`); continue; }
      if (want > now * 1.5 || want < now * 0.5) { refused.push(`${r.object_id}: ${now}$ ← ${want}$ أكتر من ±50% بخطوة وحدة`); continue; }
      items.push({ op: "set_budget", objectType: type, objectId: obj.metaId, before: { dailyBudget: now }, after: { dailyBudget: Math.round(want * 100) / 100 } });
    } else {
      items.push({ op: r.op as "pause" | "resume", objectType: type, objectId: obj.metaId, before: { status: obj.status, dailyBudget: obj.dailyBudget ?? undefined }, after: { status: r.op === "pause" ? "PAUSED" : "ACTIVE", dailyBudget: r.op === "resume" ? obj.dailyBudget ?? undefined : undefined } });
    }
  }
  return { items, refused, warnings: [] };
}

export function kindOf(items: ChangeItemDraft[]): ActionKind {
  if (items.every((i) => i.op === "pause")) return "safety_pause";
  if (items.every((i) => i.op === "pause" || (i.op === "set_budget" && (i.after.dailyBudget ?? 0) < (i.before.dailyBudget ?? 0)))) return "safety_reduce";
  if (items.some((i) => i.op === "resume")) return "resume";
  return "raise_step";
}

async function find(type: string, id: string) {
  if (type === "campaign") {
    const c = await db.campaign.findUnique({ where: { metaId: id } });
    return c ? { metaId: c.metaId, status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null } : null;
  }
  if (type === "adset") {
    const s = await db.adSet.findUnique({ where: { metaId: id } });
    return s ? { metaId: s.metaId, status: s.status, dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : null } : null;
  }
  // an ad may be named by its code (CR00147) as well as its id
  const a = (await db.ad.findUnique({ where: { metaId: id } })) ?? (await db.ad.findFirst({ where: { creativeCode: id, status: { not: "PAUSED" } } }));
  return a ? { metaId: a.metaId, status: a.status, dailyBudget: null } : null;
}

export async function prepareChange(text: string) {
  // the objects the agent may name: active ones only, by id and readable name (no customer data exists here)
  const objects = await db.adSet.findMany({ where: { status: { not: "PAUSED" } }, select: { metaId: true, name: true, dailyBudget: true, ads: { where: { status: { not: "PAUSED" } }, select: { metaId: true, name: true } } }, take: 60 });
  const out = await ask("M04", [
    { role: "user", content: [`حوّل هالطلب لعمليات: «${text.slice(0, 600)}»`, "العمليات المسموحة بس: pause · resume · set_budget (للمجموعات). استعمل الأرقام (object_id) من القائمة تحت بس. إذا الطلب مش واضح رجّع items فاضية مع تحذير.", `رجّع JSON: {"items":[{"op":"pause","object_type":"ad","object_id":"…","after":{}}],"warnings":["…"]}`, JSON.stringify(objects.map((s) => ({ adset: s.metaId, name: s.name, daily_budget: s.dailyBudget ? Number(s.dailyBudget) : null, ads: s.ads.map((a) => ({ ad: a.metaId, name: a.name })) })))].join("\n") },
  ], Out);
  const checked = await checkItems(out.items, find);
  checked.warnings = out.warnings ?? [];
  if (!checked.items.length) throw new HttpError(422, ["ما طلع ولا تغيير صالح", ...checked.refused, ...checked.warnings].join(" · "));
  const cs = await propose({ source: "agent", sourceRef: "M04", reasonCode: "S11", sentence: `مسودة من الطلب: «${text.slice(0, 160)}»${checked.refused.length ? ` (انشال: ${checked.refused.join(" · ")})` : ""}`, kind: kindOf(checked.items), items: checked.items }, { type: "agent", id: "M04" });
  return { changeSet: cs, ...checked };
}
