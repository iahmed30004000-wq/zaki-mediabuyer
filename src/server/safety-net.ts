/**
 * Proposing the safety net on Meta (spec 10.3, src/core/safety-net.ts) for one ad account, as ONE change set of kind
 * `safety_net` — the owner approves it at every level (account controls). On the 1st of each month the worker
 * proposes the cap again with a reset, so the account cap stays a MONTHLY cap.
 */
import { db } from "./db";
import { propose } from "./changes";
import { productTargets } from "./launch";
import { HttpError } from "./auth";
import { safetyNetItems } from "@/core/safety-net";
import type { Actor } from "./audit";

export type SafetyNetState = "none" | "pending" | "on";

export async function safetyNetState(accountMetaId: string): Promise<SafetyNetState> {
  const sets = await db.changeSet.findMany({ where: { kind: "safety_net", accountMetaId, state: { in: ["pending_approval", "simulated", "approved", "executing", "executed"] } }, select: { state: true } });
  if (sets.some((s) => s.state === "executed")) return "on";
  return sets.length ? "pending" : "none";
}

export async function proposeSafetyNet(accountMetaId: string, actor: Actor, o: { reset: boolean; source: "user" | "rule" }) {
  const account = await db.adAccount.findUnique({ where: { metaId: accountMetaId } });
  if (!account) throw new HttpError(404, "الحساب مش موجود");
  const open = await db.changeSet.findFirst({ where: { kind: "safety_net", accountMetaId, state: { in: ["pending_approval", "simulated"] } } });
  if (open) throw new HttpError(409, "في شبكة أمان لهالحساب لسا بانتظار موافقتك بـ «القرارات»");
  // one rule covers every product of the account: the strictest (smallest) order target
  const products = await db.productEconomics.findMany({ where: account.market ? { market: account.market } : {}, select: { productCode: true } });
  const targets = (await Promise.all(products.map((p) => productTargets(p.productCode)))).filter((t): t is NonNullable<typeof t> => !!t && !t.losing);
  const tOrder = targets.length ? Math.min(...targets.map((t) => t.tOrder)) : 3;
  const ruleExists = (await db.changeItem.count({ where: { op: "create", objectType: "rule", changeSet: { accountMetaId, state: "executed" } } })) > 0;
  const items = safetyNetItems({ accountId: accountMetaId, monthlyCapUsd: account.monthlyCap ? Number(account.monthlyCap) : null, currentCapUsd: account.spendCapMeta ? Number(account.spendCapMeta) : null, tOrderUsd: tOrder, ruleExists, reset: o.reset });
  if (!items.length) throw new HttpError(409, account.monthlyCap ? "الشبكة مركّبة — ما في شي جديد" : "حط السقف الشهري للحساب أول");
  const parts = [items.some((i) => i.op === "set_account_cap") ? `سقف صرف الحساب عند ميتا ${(Number(account.monthlyCap) * 1.1).toFixed(0)}$ (الشهري + 10%)${o.reset ? " مع تصفير صرف الشهر الماضي" : ""}` : null, items.some((i) => i.objectType === "rule") ? `قاعدة جوّا ميتا بتوقف أي مجموعة صرفت ${(2 * tOrder).toFixed(2)}$ اليوم بلا ولا نتيجة` : null].filter(Boolean);
  return propose({ source: o.source, sourceRef: o.source === "rule" ? "safety_net" : undefined, reasonCode: "S04", sentence: `شبكة الأمان على ميتا (${account.name}): ${parts.join(" · ")} — بتشتغل حتى لو نظامنا وقف`, kind: "safety_net", accountMetaId, items }, actor);
}
