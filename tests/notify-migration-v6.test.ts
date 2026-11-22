/**
 * The v6 P7 migration is additive and safe on a live database (rule 5 of docs/rebuild-v6/06-phases.md), and it says what schema.prisma says.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "..", "prisma", "migrations");
const name = readdirSync(dir).find((d) => d.endsWith("_v6_notify"))!;
const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
const schema = readFileSync(path.resolve(__dirname, "..", "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");
const model = (n: string) => new RegExp(`model ${n} \\{[\\s\\S]*?\\n\\}`).exec(schema)![0];

describe("the migration is additive", () => {
  it("runs after every migration that existed when it was written", () => {
    const all = readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all.indexOf(name)).toBeGreaterThan(all.indexOf("20261125100000_v6_tasks_links"));
  });

  it("has no DROP, RENAME, TRUNCATE, DELETE, UPDATE, type change or constraint that could refuse a live row", () => {
    for (const bad of [/\bDROP\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\b/i, /\bALTER\s+COLUMN\b/i, /\bSET\s+NOT\s+NULL\b/i, /\bADD\s+CONSTRAINT\b/i, /\bADD\s+CHECK\b/i, /\bTYPE\b/i, /\bUNIQUE\b/i]) expect(sql, String(bad)).not.toMatch(bad);
  });

  it("only adds columns and an index, and each is safe to run twice", () => {
    expect(statements.length).toBe(9);
    for (const s of statements) {
      if (s.startsWith("ALTER TABLE")) expect(s).toMatch(/^ALTER TABLE "(Notification|PushDevice)" ADD COLUMN IF NOT EXISTS "\w+" [A-Z0-9\[\]()]+( NOT NULL DEFAULT [A-Za-z0-9:\[\]()'\s]+)?$/);
      else expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "[A-Za-z_]+_idx" ON "[A-Za-z]+"\([^)]*\)$/);
      expect(s).not.toMatch(/CONCURRENTLY/i);
    }
  });

  it("a NOT NULL column always has a default (a live row has nothing to put there)", () => {
    for (const s of statements.filter((x) => /NOT NULL/.test(x))) expect(s, s).toMatch(/DEFAULT/);
  });

  it("the columns are the ones the plan names, and schema.prisma has every one of them", () => {
    const added = statements.flatMap((s) => {
      const m = /^ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)"/.exec(s);
      return m ? [`${m[1]}.${m[2]}`] : [];
    });
    expect(added.sort()).toEqual(["Notification.attempts", "Notification.channels", "Notification.kind", "Notification.lastError", "Notification.nextTryAt", "Notification.ring", "PushDevice.failedAt", "PushDevice.platform"]);
    for (const a of added) {
      const [m, col] = a.split(".");
      expect(model(m!), a).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    }
    expect(model("Notification")).toMatch(/@@index\(\[sentAt, nextTryAt\]\)/);
  });
});
