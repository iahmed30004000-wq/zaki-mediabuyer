/**
 * The safety net on Meta (spec 10.3) in dry-run, on the local database: prepared → waits for the OWNER even at level
 * 2 → approved → the cap (monthly + 10%) and the pause rule recorded exactly as they would be sent → «رجّع» puts the
 * cap back and switches the rule off. `npx tsx --env-file=.env scripts/demo-safety-net.ts`
 */
import { db } from "../src/server/db";
import { proposeSafetyNet, safetyNetState } from "../src/server/safety-net";
import { approve, rollback } from "../src/server/changes";

const owner = { id: "demo-owner", role: "OWNER" as const, demo: true };
const manager = { id: "demo-manager", role: "ADS_MANAGER" as const, demo: true };
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  await db.changeItem.deleteMany({ where: { changeSet: { kind: "safety_net" } } });
  await db.changeSet.deleteMany({ where: { kind: "safety_net" } });
  const a = await db.adAccount.update({ where: { metaId: "act_1029" }, data: { monthlyCap: 9000, autonomyLevel: 2 } });
  const cs = await proposeSafetyNet(a.metaId, { type: "user", id: "demo-owner" }, { reset: false, source: "user" });
  check(cs.state === "pending_approval" && (await safetyNetState(a.metaId)) === "pending", `1. prepared, waits for the owner even at level 2: «${cs.sentence}»`);
  const refused = await approve(cs.id, manager).then(() => "approved").catch((e: Error) => e.message);
  check(refused.includes("المالك"), `   …an ads manager cannot approve it: «${refused}»`);
  const done = await approve(cs.id, owner);
  const items = await db.changeItem.findMany({ where: { changeSetId: cs.id }, orderBy: { seq: "asc" } });
  const capSent = (items[0]!.apiResponse as { wouldPost: Record<string, unknown> }).wouldPost;
  const rule = (items[1]!.apiResponse as { wouldPost: { evaluation_spec: { filters: { field: string; value: unknown }[] } } }).wouldPost;
  check(done.state === "executed" && capSent.spend_cap === 9900, `2. approved → recorded: account cap ${capSent.spend_cap}$ (9000 + 10%), in dollars as Meta takes it`);
  check(rule.evaluation_spec.filters.some((f) => f.field === "spent") && (await safetyNetState(a.metaId)) === "on", `   …and the rule: pause an ad set that spent > ${rule.evaluation_spec.filters.find((f) => f.field === "spent")!.value} cents today with no result`);
  const back = await rollback(cs.id, owner);
  const backItems = await db.changeItem.findMany({ where: { changeSetId: back.id } });
  check(back.state === "executed" && backItems.some((i) => i.objectType === "rule" && i.op === "pause") && backItems.some((i) => i.op === "set_account_cap"), "3. «رجّع»: the cap goes back, the rule is switched off (nothing deleted)");
  await db.adAccount.update({ where: { id: a.id }, data: { autonomyLevel: 1 } });
  process.exit();
})();
