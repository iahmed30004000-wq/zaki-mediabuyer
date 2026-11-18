import { describe, expect, it } from "vitest";
import { INTEGRATIONS, MissingKeyError, integrationOf, isDemo, isLinked, metaWriteGate, missingGroups, missingText, requireKeys } from "@/core/readiness";
import { applyItem, writeMode } from "@/meta/write";

const NOTHING = {};

describe("what each link needs", () => {
  it("every integration has a label in Arabic, at least one group of variables, and a reason", () => {
    expect(new Set(INTEGRATIONS.map((i) => i.key)).size).toBe(INTEGRATIONS.length);
    for (const i of INTEGRATIONS) {
      expect(i.label).toMatch(/[؀-ۿ]/);
      expect(i.needs.length).toBeGreaterThan(0);
      expect(i.why).toMatch(/[؀-ۿ]/);
      for (const g of i.needs) for (const n of g) expect(n).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it("names the variables that are missing — and only those; alternatives count as one", () => {
    expect(missingGroups(integrationOf("telegram"), NOTHING)).toEqual(["TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID"]);
    expect(missingGroups(integrationOf("telegram"), { TELEGRAM_BOT_TOKEN: "x" })).toEqual(["TELEGRAM_OWNER_CHAT_ID"]);
    expect(isLinked("telegram", { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_OWNER_CHAT_ID: "1" })).toBe(true);
    // OMS_TOKEN or OMS_API_TOKEN
    expect(isLinked("oms", { OMS_BASE_URL: "https://oms", OMS_API_TOKEN: "t" })).toBe(true);
    expect(missingGroups(integrationOf("oms"), { OMS_BASE_URL: "https://oms" })).toEqual(["OMS_TOKEN أو OMS_API_TOKEN"]);
    // a blank value is not a value
    expect(isLinked("assistant", { ANTHROPIC_API_KEY: "   " })).toBe(false);
    expect(isLinked("assistant", { CLAUDE_API_KEY: "k" })).toBe(true);
  });

  it("the sentence is Arabic, names the variable, and never carries a value", () => {
    const t = missingText("workspace", { WORKSPACE_BASE_URL: "https://ws.example.com" })!;
    expect(t).toContain("WORKSPACE_API_TOKEN");
    expect(t).not.toContain("ws.example.com");
    expect(t).toMatch(/Coolify/);
    expect(missingText("telegram", NOTHING)).toContain("TELEGRAM_BOT_TOKEN و TELEGRAM_OWNER_CHAT_ID");
    expect(missingText("telegram", { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_OWNER_CHAT_ID: "1" })).toBeNull();
  });

  it("a path that needs a link stops when it is missing — except in the labelled demo", () => {
    expect(() => requireKeys("telegram", { MOCK_MODE: "0" })).toThrow(MissingKeyError);
    expect(() => requireKeys("telegram", NOTHING)).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => requireKeys("telegram", { MOCK_MODE: "1" })).not.toThrow();
    expect(isDemo({ MOCK_MODE: "1" })).toBe(true);
    expect(isDemo({ MOCK_MODE: "0" })).toBe(false);
    try {
      requireKeys("drive", NOTHING);
    } catch (e) {
      expect(e).toBeInstanceOf(MissingKeyError);
      expect((e as MissingKeyError).integration).toBe("drive");
      expect((e as MissingKeyError).message).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    }
  });
});

describe("no write to Meta without META_LIVE_VERIFIED", () => {
  const live = { META_WRITE_MODE: "live", META_SYSTEM_USER_TOKEN: "t" };

  it("dry-run is the default and asks nothing", () => {
    expect(metaWriteGate(NOTHING)).toEqual({ mode: "dry_run", error: null });
    expect(metaWriteGate({ META_WRITE_MODE: "dry_run" })).toEqual({ mode: "dry_run", error: null });
    expect(writeMode(NOTHING)).toBe("dry_run");
  });

  it("asking for live without the verified flag is refused out loud, never run as a quiet dry-run", () => {
    const g = metaWriteGate(live);
    expect(g.mode).toBe("dry_run");
    expect(g.error).toContain("META_LIVE_VERIFIED=1");
    expect(writeMode(live)).toBe("dry_run");
    for (const v of ["0", "true", "yes", ""]) expect(metaWriteGate({ ...live, META_LIVE_VERIFIED: v }).error).toContain("META_LIVE_VERIFIED");
  });

  it("verified but no token: refused, naming the token", () => {
    expect(metaWriteGate({ META_WRITE_MODE: "live", META_LIVE_VERIFIED: "1" }).error).toContain("META_SYSTEM_USER_TOKEN");
    // the token may be the encrypted connection in the database
    expect(metaWriteGate({ META_WRITE_MODE: "live", META_LIVE_VERIFIED: "1" }, true)).toEqual({ mode: "live", error: null });
  });

  it("live needs all three: the mode, the verified flag and a token", () => {
    expect(metaWriteGate({ ...live, META_LIVE_VERIFIED: "1" })).toEqual({ mode: "live", error: null });
    expect(writeMode({ ...live, META_LIVE_VERIFIED: "1" })).toBe("live");
    expect(writeMode({ META_LIVE_VERIFIED: "1" })).toBe("dry_run");
  });

  it("a live item with no client throws instead of recording a made-up success", async () => {
    const item = { op: "pause", objectType: "campaign", objectId: "120001", before: {}, after: {} } as never;
    await expect(applyItem(item, "live", null)).rejects.toThrow(/META_SYSTEM_USER_TOKEN/);
    // dry-run stays honest: it records what would be sent
    await expect(applyItem(item, "dry_run", null)).resolves.toMatchObject({ verified: true, response: { dryRun: true } });
  });
});

describe("Telegram's two halves", () => {
  it("sending needs the bot and the chat; receiving «اوقف» also needs the webhook secret", () => {
    expect(missingGroups(integrationOf("telegram"), { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_OWNER_CHAT_ID: "1" })).toEqual([]);
    expect(missingGroups(integrationOf("telegramIn"), { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_OWNER_CHAT_ID: "1" })).toEqual(["TELEGRAM_WEBHOOK_SECRET"]);
  });
});
