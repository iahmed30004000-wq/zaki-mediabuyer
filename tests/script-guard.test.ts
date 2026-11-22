/**
 * N-09: the demo scripts clear tables, so each one refuses a database that is not on this machine, and the image does not carry them.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isLocalDatabase } from "../scripts/_guard";

const scripts = path.join(__dirname, "..", "scripts");
const guarded = readdirSync(scripts).filter((f) => /^demo-.*\.ts$/.test(f) || f === "full-check.ts" || f === "full-path.ts");

describe("assertLocalDatabase", () => {
  it("accepts this machine only", () => {
    expect(isLocalDatabase("postgresql://u:p@127.0.0.1:5450/mediabuyer")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@localhost:5432/mediabuyer")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@db:5432/mediabuyer")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@db.internal.example.com:5432/x")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@127.0.0.1.evil.example.com/x")).toBe(false);
    expect(isLocalDatabase("")).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
  });
});

describe("every script that clears tables is guarded", () => {
  it("there are demo scripts to check", () => expect(guarded.length).toBeGreaterThan(10));
  for (const f of guarded) {
    it(`${f} calls assertLocalDatabase() before it does anything`, () => {
      const src = readFileSync(path.join(scripts, f), "utf8").replace(/\r\n/g, "\n");
      const call = src.indexOf("\nassertLocalDatabase();");
      expect(call, f).toBeGreaterThan(0);
      // nothing but imports, comments and blank lines before it
      const before = src.slice(0, call).split("\n").filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l) && !/^import\b/.test(l) && !/^process\.env\.\w+ = /.test(l) && !/^\s+[\w{},\s]+(,|\})?$/.test(l) && !/from\s+["']/.test(l));
      expect(before, `${f}: code before the guard`).toEqual([]);
    });
  }
  it("the image leaves the demo scripts out", () => {
    expect(readFileSync(path.join(__dirname, "..", ".dockerignore"), "utf8")).toMatch(/^scripts\/demo-\*\.ts$/m);
  });
});
