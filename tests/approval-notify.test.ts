/**
 * A decision for the owner (`request_approval`) becomes ONE notice, and the answer to the agent is what is true — queued · held_asleep · site_only — never «رنّ التلفون» (W-08).
 * Telegram is a pretend server; nothing here calls Firebase (it is not set up, which is the honest state to test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb, addUsers } = await import("./helpers/fake-db");
  h.db = addUsers(makeFakeDb());
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/auth", () => ({
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { ApprovalInput, decideApproval, refreshApprovals, requestApproval, Refused } from "@/server/approvals";
import { TOOLS } from "@/server/mcp/tools";

type Rows = Record<string, any>[];
const rows = (name: string): Rows => (h.db as unknown as Record<string, { rows: Rows }>)[name]!.rows;
const NOW = new Date("2026-11-22T10:00:00.000Z");
const agent = { type: "agent" as const, id: "mcp:Claude" };
const ask = (over: Record<string, unknown> = {}) => requestApproval(ApprovalInput.parse({ title: "تكبير «حرير 3» +20%", why: "التكلفة تحت السقف 3 أيام", urgency: "red", ...over }), agent, NOW);
const setMode = (mode: "awake" | "asleep") => {
  rows("setting").length = 0;
  rows("setting").push({ key: "owner.mode", value: { mode, since: null, schedule: { enabled: false, awake: "10:00", asleep: "02:00" } }, version: 1 });
};
const env = { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID: process.env.TELEGRAM_OWNER_CHAT_ID, FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON, APP_URL: process.env.APP_URL };

let telegramTexts: string[] = [];
beforeEach(() => {
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  rows("user").push({ id: "u-owner", email: "o@x.test", role: "OWNER", active: true });
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_OWNER_CHAT_ID;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.APP_URL = "https://mb.example.test";
  telegramTexts = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function linkTelegram() {
  process.env.TELEGRAM_BOT_TOKEN = "tg-token-for-the-test";
  process.env.TELEGRAM_OWNER_CHAT_ID = "42";
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    telegramTexts.push(JSON.parse(String(init.body)).text);
    return new Response("{}", { status: 200 });
  });
}

describe("the request becomes one notice, and the agent hears what is true", () => {
  it("nothing linked (no phone, no Telegram): the notice is in the bell, and the answer is «site_only» — not «it rang»", async () => {
    const r = await ask();
    expect(r.created).toBe(true);
    expect(r.delivery).toBe("site_only");
    const n = rows("notification");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: "approval.new", urgency: "red", audience: "owner", key: `approval:${r.approval.id}`, source: "approval", sentAt: null });
    expect(n[0]!.title).toBe("بدّها قرارك: تكبير «حرير 3» +20%");
    expect(n[0]!.href).toBe(`/inbox/${encodeURIComponent(`approval:${r.approval.id}`)}`);
    expect(n[0]!.body).toContain("الموافقة من الموقع بس");
    // the request itself is not marked «notified»: nobody was
    expect(rows("approval")[0]!.notifiedAt).toBeNull();
  });

  it("awake with Telegram linked: «queued», it really went, and the message only opens the decision (no approving from there)", async () => {
    linkTelegram();
    setMode("awake");
    const r = await ask({ amount: 20 });
    expect(r.delivery).toBe("queued");
    expect(telegramTexts).toHaveLength(1);
    expect(telegramTexts[0]).toContain("بدّها قرارك: تكبير «حرير 3» +20%");
    expect(telegramTexts[0]).toContain(`https://mb.example.test/inbox/${encodeURIComponent(`approval:${r.approval.id}`)}`);
    expect(telegramTexts[0]).toContain("المبلغ 20$");
    expect(rows("notification")[0]).toMatchObject({ channels: ["telegram"], ring: true });
    expect(rows("approval")[0]!.notifiedAt).toEqual(NOW);
  });

  it("asleep: «held_asleep», nothing goes out; a decision of a kind he marked «يصحّيني» is the one that still goes", async () => {
    linkTelegram();
    setMode("asleep");
    const held = await ask({ ref: "r1" });
    expect(held.delivery).toBe("held_asleep");
    expect(telegramTexts).toHaveLength(0);
    rows("setting").push({ key: "owner.wake_kinds", value: ["cap_raise"], version: 1 });
    const wake = await ask({ ref: "r2", kind: "cap_raise" });
    expect(wake.delivery).toBe("queued");
    expect(telegramTexts).toHaveLength(1);
  });

  it("orange is silent by default but still goes to a phone or Telegram when awake; yellow is only news (the bell)", async () => {
    linkTelegram();
    setMode("awake");
    expect((await ask({ ref: "o1", urgency: "orange" })).delivery).toBe("queued");
    expect((await ask({ ref: "y1", urgency: "yellow" })).delivery).toBe("site_only");
    expect(telegramTexts).toHaveLength(1);
  });

  it("the same `ref` twice is one request and one notice", async () => {
    const a = await ask({ ref: "same" });
    const b = await ask({ ref: "same" });
    expect(b).toMatchObject({ created: false, delivery: "already" });
    expect(b.approval.id).toBe(a.approval.id);
    expect(rows("notification")).toHaveLength(1);
  });

  it("customer data in the request: refused, no request and no notice", async () => {
    await expect(ask({ why: "العميل 0791234567 بدّه تأكيد" })).rejects.toBeInstanceOf(Refused);
    expect(rows("approval")).toHaveLength(0);
    expect(rows("notification")).toHaveLength(0);
  });

  it("a postponed request that comes back is a new notice (its own key); the first stays where it was", async () => {
    const r = await ask({ ref: "p1" });
    await decideApproval(r.approval.id, { action: "postpone", until: "15m" }, { id: "u-owner", role: "OWNER" as never }, NOW);
    expect(rows("approval")[0]!.status).toBe("postponed");
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const out = await refreshApprovals(later);
    expect(out.woken).toBe(1);
    const keys = rows("notification").map((n) => n.key);
    expect(keys[0]).toBe(`approval:${r.approval.id}`);
    expect(keys[1]).toMatch(new RegExp(`^approval:${r.approval.id}:back:\\d+$`));
    expect(rows("notification")).toHaveLength(2);
    // a second pass wakes nothing and writes nothing
    await refreshApprovals(later);
    expect(rows("notification")).toHaveLength(2);
  });
});

describe("the agent's tools say the same words", () => {
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
  const ctx = { actor: agent } as never;

  it("request_approval: `delivery` is queued · held_asleep · site_only, and the sentence never says the phone rang", async () => {
    const res = (await tool("request_approval").run({ title: "قرار", why: "ليش", urgency: "red" }, ctx)) as { text: string; data?: { delivery: string } };
    const text = res.text;
    expect(res.data?.delivery).toBe("site_only");
    expect(text).not.toContain("رنّ التلفون");
    expect(text).toContain("بالجرس");
  });

  it("notify: `delivery` is what is true, and `delivered` is true only when a channel took it", async () => {
    const quiet = (await tool("notify").run({ title: "المخزون قليل", urgency: "orange", key: "stk1" }, ctx)) as { data?: { delivered: boolean; delivery: string } };
    expect(quiet.data).toMatchObject({ delivered: false, delivery: "site_only" });
    linkTelegram();
    setMode("awake");
    const sent = (await tool("notify").run({ title: "المخزون قليل جداً", urgency: "red", key: "stk2" }, ctx)) as { data?: { delivered: boolean; delivery: string } };
    expect(sent.data).toMatchObject({ delivered: true, delivery: "queued" });
    setMode("asleep");
    const held = (await tool("notify").run({ title: "تنبيه الليل", urgency: "red", key: "stk3" }, ctx)) as { data?: { delivered: boolean; delivery: string } };
    expect(held.data).toMatchObject({ delivered: false, delivery: "held_asleep" });
    const bell = (await tool("notify").run({ title: "خبر", urgency: "yellow", key: "stk4" }, ctx)) as { data?: { delivered: boolean; delivery: string } };
    expect(bell.data).toMatchObject({ delivered: false, delivery: "site_only" });
  });
});
