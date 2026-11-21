/**
 * N-01 / N-10: the alert for a night without a good copy, and the one for missing settings (by name only).
 */
import { describe, expect, it } from "vitest";
import { detect, type AlertFacts } from "@/core/alerts";
import { envProblems } from "@/core/env-check";

const base: AlertFacts = { hour: 10, adsets: [], pixelPurchasesToday: 0, webOrdersToday: 0, cpmToday: null, impressionsToday: 0, cpm7: [], metaLinked: false, omsLinked: false, metaAgeHours: null, omsAgeHours: null, attributedPct: null, capiRejectedLastHour: 0, tokenDaysLeft: null };

describe("backup alert", () => {
  it("raised when the last good copy is older than 26 hours", () => {
    const out = detect({ ...base, backupAgeHours: 30 });
    expect(out.map((s) => s.key)).toEqual(["backup"]);
    expect(out[0]!.text).toContain("30");
    expect(out[0]!.tone).toBe("warn");
  });
  it("quiet at 26 hours or less, and for a site with no history", () => {
    expect(detect({ ...base, backupAgeHours: 26 })).toEqual([]);
    expect(detect({ ...base, backupAgeHours: 3 })).toEqual([]);
    expect(detect({ ...base, backupAgeHours: null })).toEqual([]);
    expect(detect(base)).toEqual([]);
  });
});

describe("production settings", () => {
  const good = { DATABASE_URL: "postgresql://u:p@db:5432/x", AUTH_SECRET: "a".repeat(40), ENCRYPTION_KEY: "b".repeat(40), OWNER_EMAIL: "owner@example.com", APP_URL: "https://mediabuyer.example.com", STORAGE_DIR: "/app/storage" };
  it("nothing missing → nothing said", () => expect(envProblems(good, true)).toEqual([]));
  it("names what is missing or too short — never a value", () => {
    const out = envProblems({ ...good, OWNER_EMAIL: "", AUTH_SECRET: "short", STORAGE_DIR: undefined }, true);
    expect(out.map((p) => p.name)).toEqual(["AUTH_SECRET", "OWNER_EMAIL", "STORAGE_DIR"]);
    expect(JSON.stringify(out)).not.toContain("short");
  });
  it("in development nothing is demanded", () => expect(envProblems({}, false)).toEqual([]));
  it("an alert names them", () => {
    const out = detect({ ...base, envProblems: ["OWNER_EMAIL"] });
    expect(out.map((s) => s.key)).toEqual(["env"]);
    expect(out[0]!.text).toContain("OWNER_EMAIL");
  });
});
