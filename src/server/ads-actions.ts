/**
 * What a person can ask for from a row of «الإعلانات» (v3 · C) besides pausing it: one step up of the ladder on the object's
 * own daily budget. It is a PROPOSAL — it never spends. It goes through the change service like every change to Meta
 * (simulate → route by the account's level): a level-1/2 account puts it in «المهام ← بانتظار موافقتك» with its money effect,
 * and only a person's yes on the site executes it; an advisor account (level 0) just records it as a suggestion.
 */
import { scaleStep } from "@/core/ads-table";
import { propose } from "./changes";
import { HttpError } from "./auth";
import { db } from "./db";
import { getSetting } from "./settings";

export interface RaiseProposal {
  id: string;
  /** pending_approval — waiting for a yes · simulated — recorded only (an advisor account executes nothing) */
  state: string;
  before: number;
  after: number;
}

export async function proposeRaise(target: { objectType: "campaign" | "adset"; objectId: string }, caller: { id: string }): Promise<RaiseProposal> {
  const { objectType, objectId } = target;
  const row =
    objectType === "adset"
      ? await db.adSet.findUnique({ where: { metaId: objectId }, include: { campaign: { include: { account: true } } } })
      : await db.campaign.findUnique({ where: { metaId: objectId }, include: { account: true } });
  if (!row) throw new HttpError(404, "العنصر مش موجود");
  const account = "campaign" in row ? row.campaign.account : row.account;
  const stepPct = Number(await getSetting("scale.step_pct"));
  const step = scaleStep(row.dailyBudget === null ? null : Number(row.dailyBudget), stepPct);
  if (!step) throw new HttpError(409, "هالعنصر ما إله ميزانية يومية خاصة فيه — اقترح الزيادة على مجموعته (أو على الحملة إذا ميزانيتها عليها)");
  const cs = await propose(
    {
      source: "user",
      sourceRef: caller.id,
      reasonCode: "S11",
      sentence: `زيادة ${row.name}: ${step.before}$ ← ${step.after}$ باليوم (+${Math.round(stepPct * 100)}%) — اقتراح يدوي`,
      kind: "raise_step",
      accountMetaId: account.metaId,
      items: [{ op: "set_budget", objectType, objectId, before: { dailyBudget: step.before }, after: { dailyBudget: step.after } }],
    },
    { type: "user", id: caller.id },
  );
  return { id: cs.id, state: cs.state, before: step.before, after: step.after };
}
