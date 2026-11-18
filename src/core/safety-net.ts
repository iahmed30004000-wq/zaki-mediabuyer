/**
 * THE SAFETY NET ON META ITSELF (spec 10.3) — what keeps the money safe even when this system is down:
 *   · the ad account's spend cap = the monthly cap + 10%, reset at the start of each month (Meta's cap counts all
 *     spend since it was set, so a monthly cap is a reset + a cap);
 *   · one automated rule inside Meta: every half hour, pause an ad set that spent more than 2 × T_order today with no
 *     result at all (Meta cannot see the OMS — this is the simple backup, our own rules stay the real ones).
 * Field names and units checked against Meta's docs (2026-10): rule money in the currency's base unit (cents), the
 * account spend_cap WRITTEN in dollars (float) and READ in cents. Touching account controls = the owner approves.
 */
import type { ChangeItemDraft } from "./changeset";

export const RULE_NAME = "Zaki · أمان: مجموعة صرفت 2×T اليوم بلا نتائج";

export function pauseRulePayload(tOrderUsd: number) {
  const threshold = Math.max(2, Math.round(2 * tOrderUsd * 100) / 100);
  return {
    name: RULE_NAME,
    status: "ENABLED",
    evaluation_spec: {
      evaluation_type: "SCHEDULE",
      filters: [
        { field: "entity_type", value: "ADSET", operator: "EQUAL" },
        { field: "time_preset", value: "TODAY", operator: "EQUAL" },
        { field: "effective_status", value: ["ACTIVE"], operator: "IN" },
        { field: "spent", value: Math.round(threshold * 100), operator: "GREATER_THAN" },
        { field: "results", value: 0, operator: "EQUAL" },
      ],
    },
    execution_spec: { execution_type: "PAUSE" },
    schedule_spec: { schedule_type: "SEMI_HOURLY" },
  };
}

/** The account cap Meta should hold: the monthly cap + 10%, in dollars (null = no monthly cap set: nothing to do). */
export const accountCapFor = (monthlyCapUsd: number | null) => (monthlyCapUsd && monthlyCapUsd > 0 ? Math.round(monthlyCapUsd * 1.1 * 100) / 100 : null);

/**
 * The change items of the safety net for one account. `tOrder` is the smallest order target among the account's
 * products — the strictest threshold, since one rule covers them all.
 */
export function safetyNetItems(o: { accountId: string; monthlyCapUsd: number | null; currentCapUsd: number | null; tOrderUsd: number; ruleExists: boolean; reset: boolean }): ChangeItemDraft[] {
  const items: ChangeItemDraft[] = [];
  const cap = accountCapFor(o.monthlyCapUsd);
  if (cap !== null) {
    items.push({ op: "set_account_cap", objectType: "account", objectId: o.accountId, before: { spendCap: o.currentCapUsd ?? undefined }, after: { spendCap: cap, reset: o.reset } });
  }
  if (!o.ruleExists) {
    items.push({ op: "create", objectType: "rule", objectId: "{{ref:safety_rule}}", before: {}, after: { endpoint: `${o.accountId}/adrules_library`, payload: pauseRulePayload(o.tOrderUsd), ref: "safety_rule", name: RULE_NAME } });
  }
  return items;
}
