import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «اوقف» — the shared function behind the Telegram webhook and the OMS's signed event. The database, the change-set engine and the audit log are
 * doubles; what is proven is what it asks them: only ever a PAUSE, never a guess among several names, nothing at all in the demo.
 */
const s = vi.hoisted(() => ({
  ads: [] as unknown[],
  adsets: [] as unknown[],
  campaigns: [] as unknown[],
  queries: [] as unknown[],
  proposals: [] as { p: Record<string, unknown>; actor: unknown }[],
  audits: [] as unknown[][],
  state: "executed",
  writeMode: "live",
  error: null as string | null,
}));

vi.mock("@/server/db", () => ({
  db: {
    ad: { findMany: async (q: unknown) => (s.queries.push(["ad", q]), s.ads) },
    adSet: { findMany: async (q: unknown) => (s.queries.push(["adset", q]), s.adsets) },
    campaign: { findMany: async (q: unknown) => (s.queries.push(["campaign", q]), s.campaigns) },
  },
}));
vi.mock("@/server/changes", () => ({ propose: async (p: Record<string, unknown>, actor: unknown) => (s.proposals.push({ p, actor }), { id: "cs-1", state: s.state, writeMode: s.writeMode, error: s.error }) }));
vi.mock("@/server/audit", () => ({ audit: async (...a: unknown[]) => void s.audits.push(a) }));

import { stopByQuery } from "@/server/stop-by-query";

const ad = (name: string, metaId = "ad-1", account = "act-1") => ({ metaId, name, status: "ACTIVE", adSet: { campaign: { account: { metaId: account } } } });

beforeEach(() => {
  Object.assign(s, { ads: [], adsets: [], campaigns: [], queries: [], proposals: [], audits: [], state: "executed", writeMode: "live", error: null });
  delete process.env.MOCK_MODE;
});

describe("stopByQuery", () => {
  it("a creative code finds the ad and makes ONE safety pause change set — every item is a pause", async () => {
    s.ads = [ad("CR00147 · كمأة")];
    const text = await stopByQuery("cr147", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("✓ وقف: CR00147 · كمأة");
    expect(s.proposals).toHaveLength(1);
    const { p, actor } = s.proposals[0]!;
    expect(actor).toEqual({ type: "user", id: "oms:owner" });
    expect(p).toMatchObject({ source: "telegram", sourceRef: "oms:owner", kind: "safety_pause", reasonCode: "S11", accountMetaId: "act-1" });
    expect((p.items as { op: string; after: { status: string } }[]).every((i) => i.op === "pause" && i.after.status === "PAUSED")).toBe(true);
    expect(s.audits[0]).toEqual([{ type: "user", id: "oms:owner" }, "telegram.pause", { type: "changeset", id: "cs-1" }]);
    // the search is by code and only among ads that are not already paused
    expect(s.queries[0]).toEqual(["ad", expect.objectContaining({ where: { creativeCode: "CR00147", status: { not: "PAUSED" } } })]);
  });

  it("a name that fits more than one object is NOT guessed — it asks for more words", async () => {
    s.ads = [ad("ماء كمأة 1", "a1"), ad("ماء كمأة 2", "a2")];
    const text = await stopByQuery("ماء", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("لقيت 2");
    expect(s.proposals).toEqual([]);
  });

  it("nothing found says so and changes nothing", async () => {
    const text = await stopByQuery("CR00001", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("ما لقيت شي شغّال");
    expect(s.proposals).toEqual([]);
  });

  it("falls to ad sets, then campaigns, only when the level above found nothing", async () => {
    s.campaigns = [{ metaId: "c1", name: "حملة كمأة", status: "ACTIVE", account: { metaId: "act-9" } }];
    await stopByQuery("كمأة", { id: "oms:owner" }, "oms:owner");
    expect(s.queries.map((q) => (q as string[])[0])).toEqual(["ad", "adset", "campaign"]);
    expect((s.proposals[0]!.p.items as { objectType: string }[])[0]!.objectType).toBe("campaign");
  });

  it("a change set that waits for review is said as waiting, not as stopped", async () => {
    s.ads = [ad("CR00147")];
    s.state = "proposed";
    const text = await stopByQuery("CR00147", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("بانتظار مراجعة");
    expect(text).not.toContain("✓ وقف");
  });

  it("a pause that only ran as a trial is said as a trial — never «✓ وقف»", async () => {
    s.ads = [ad("CR00147")];
    s.writeMode = "dry_run";
    const text = await stopByQuery("CR00147", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("تجربة: ما انبعت لميتا");
    expect(text).not.toContain("✓ وقف");
  });

  it("a pause that failed says so with the reason", async () => {
    s.ads = [ad("CR00147")];
    s.state = "failed";
    s.error = "verify_mismatch: الإعلان محذوف";
    const text = await stopByQuery("CR00147", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("ما تنفّذ الإيقاف: الإعلان محذوف");
    expect(text).not.toContain("✓ وقف");
  });

  it("in the demo it touches nothing — not even the search", async () => {
    process.env.MOCK_MODE = "1";
    const text = await stopByQuery("CR00147", { id: "oms:owner" }, "oms:owner");
    expect(text).toContain("الوضع التجريبي");
    expect(s.queries).toEqual([]);
    expect(s.proposals).toEqual([]);
  });
});
