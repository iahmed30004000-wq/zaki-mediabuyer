import { describe, expect, it } from "vitest";
import { accountCapFor, pauseRulePayload, safetyNetItems } from "@/core/safety-net";
import { applyItem, payloadOf } from "@/meta/write";
import { modeFor } from "@/core/autonomy";
import type { MetaClient } from "@/meta/client";

describe("the safety net on Meta (spec 10.3)", () => {
  it("the rule: ad sets, today, spent above 2 × T IN CENTS with no result → pause, every half hour", () => {
    const r = pauseRulePayload(4.05);
    expect(r.evaluation_spec.filters).toContainEqual({ field: "spent", value: 810, operator: "GREATER_THAN" });
    expect(r.evaluation_spec.filters).toContainEqual({ field: "results", value: 0, operator: "EQUAL" });
    expect(r).toMatchObject({ execution_spec: { execution_type: "PAUSE" }, schedule_spec: { schedule_type: "SEMI_HOURLY" }, status: "ENABLED" });
    expect(pauseRulePayload(0.5).evaluation_spec.filters).toContainEqual({ field: "spent", value: 200, operator: "GREATER_THAN" }); // never below 2$
  });
  it("the account cap is the monthly cap + 10%, written in DOLLARS with a reset", () => {
    expect(accountCapFor(9000)).toBe(9900);
    expect(accountCapFor(null)).toBeNull();
    const items = safetyNetItems({ accountId: "act_1", monthlyCapUsd: 9000, currentCapUsd: null, tOrderUsd: 4, ruleExists: false, reset: true });
    expect(items.map((i) => `${i.op}:${i.objectType}`)).toEqual(["set_account_cap:account", "create:rule"]);
    expect(payloadOf(items[0]!)).toEqual({ spend_cap: 9900, spend_cap_action: "reset" });
    expect(safetyNetItems({ accountId: "act_1", monthlyCapUsd: 9000, currentCapUsd: 9900, tOrderUsd: 4, ruleExists: true, reset: false })).toHaveLength(1);
  });
  it("read back in CENTS: 9900$ written is 990000 read", async () => {
    let posted: Record<string, unknown> = {};
    const client = { post: async (_: string, p: Record<string, unknown>) => { posted = p; return { success: true }; }, get: async () => ({ spend_cap: String(Math.round(Number(posted.spend_cap) * 100)) }) } as unknown as MetaClient;
    const [cap] = safetyNetItems({ accountId: "act_1", monthlyCapUsd: 9000, currentCapUsd: null, tOrderUsd: 4, ruleExists: true, reset: false });
    expect((await applyItem(cap!, "live", client)).verified).toBe(true);
    const wrong = { post: async () => ({}), get: async () => ({ spend_cap: "9900" }) } as unknown as MetaClient;
    expect((await applyItem(cap!, "live", wrong)).verified).toBe(false);
  });
  it("a rule is switched off, not paused; and the owner approves the net at every level", () => {
    expect(payloadOf({ op: "pause", objectType: "rule", objectId: "1", before: {}, after: {} })).toEqual({ status: "DISABLED" });
    expect([0, 1, 2, 3].map((l) => modeFor("safety_net", l as 0 | 1 | 2 | 3))).toEqual(["owner", "owner", "owner", "owner"]);
  });
});
