import { describe, expect, it } from "vitest";
import { applyItem, budgetMatches } from "@/meta/write";
import type { MetaClient } from "@/meta/client";
import type { ChangeItemDraft } from "@/core/changeset";

/**
 * Before a live budget change the site reads the budget Meta has NOW. If it is not the one the decision was computed from, nothing is written.
 * The client is a recording double; only calls the existing write path already makes are used (a GET of the object's fields, then the POST and the read-back).
 */
function fakeClient(liveBudgetCents: number) {
  const calls: string[] = [];
  const client = {
    get: async (id: string, o?: { fields?: string }) => {
      calls.push(`GET ${id} ${o?.fields}`);
      return { daily_budget: String(liveBudgetCents), status: "ACTIVE", effective_status: "ACTIVE" };
    },
    post: async (id: string, body: Record<string, unknown>) => {
      calls.push(`POST ${id} ${JSON.stringify(body)}`);
      liveBudgetCents = Number(body.daily_budget ?? liveBudgetCents);
      return { success: true };
    },
  } as unknown as MetaClient;
  return { client, calls };
}
const raise: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "S1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } };

describe("a live budget write starts from what Meta has now", () => {
  it("the same budget: it writes and verifies", async () => {
    const { client, calls } = fakeClient(4000);
    const r = await applyItem(raise, "live", client);
    expect(r.verified).toBe(true);
    expect(calls[0]).toContain("GET S1 daily_budget");
    expect(calls.some((c) => c.startsWith("POST S1"))).toBe(true);
  });
  it("a budget somebody (or a rewritten copy) changed: nothing is written, the sentence says both numbers", async () => {
    const { client, calls } = fakeClient(40_000); // 400$ on Meta, 40$ in the decision
    await expect(applyItem(raise, "live", client)).rejects.toThrow(/400\.00\$.*40\.00\$/);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("a pause is not read first (it only lowers spend, repeating it is harmless)", async () => {
    const { client, calls } = fakeClient(4000);
    await applyItem({ op: "pause", objectType: "campaign", objectId: "C1", before: { status: "ACTIVE" }, after: { status: "PAUSED" } }, "live", client);
    expect(calls[0]).toMatch(/^POST C1/);
  });
  it("a trial reads and writes nothing", async () => {
    const { client, calls } = fakeClient(1);
    await applyItem(raise, "dry_run", client);
    expect(calls).toEqual([]);
  });
  it("budgets match to the cent", () => {
    expect(budgetMatches(4000, 40)).toBe(true);
    expect(budgetMatches(4001, 40)).toBe(true);
    expect(budgetMatches(4002, 40)).toBe(false);
    expect(budgetMatches(NaN, 40)).toBe(false);
  });
});
