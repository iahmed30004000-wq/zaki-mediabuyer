/**
 * The v6 P8 data migration: the alerts and notices written before the new map carry the OLD address of a screen; this moves them to the new one. It is data only (rule 5 of
 * docs/rebuild-v6/06-phases.md), safe to run twice, and it moves exactly what next.config.mjs redirects. The statements are read from the file and APPLIED here with the same regular
 * expressions (they are written to mean the same in Postgres and in JavaScript); the real engine ran the whole chain of migrations twice when this was written (see docs/rebuild-v6/NOTES.md).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "..", "prisma", "migrations");
const name = readdirSync(dir).find((d) => d.endsWith("_v6_old_links"))!;
const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

interface Rule {
  table: "Alert" | "Notification";
  from: RegExp;
  to: string;
  where: RegExp;
}
const RULE = /^UPDATE "(Alert|Notification)" SET "href" = regexp_replace\("href", '([^']+)', '([^']+)'\) WHERE "href" ~ '([^']+)'$/;
const rules: Rule[] = statements.map((s) => {
  const m = RULE.exec(s);
  if (!m) throw new Error(`not a rule of this migration: ${s}`);
  return { table: m[1] as Rule["table"], from: new RegExp(m[2]!), to: m[3]!.replace(/\\(\d)/g, "$$$1"), where: new RegExp(m[4]!) };
});

/** What the database does to one href, in the order of the file (a statement only touches a row that matches its WHERE). */
const migrate = (table: Rule["table"], href: string | null): string | null => {
  if (href === null) return null;
  let cur = href;
  for (const r of rules.filter((x) => x.table === table)) if (r.where.test(cur)) cur = cur.replace(r.from, r.to);
  return cur;
};

describe("the migration is data only and safe on a live database", () => {
  it("runs after every migration that existed when it was written", () => {
    const all = readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all.indexOf(name)).toBeGreaterThan(all.indexOf("20261126100000_v6_notify"));
  });

  it("has no DDL, no DROP, no DELETE, and only updates the `href` of the alerts and the notices", () => {
    for (const bad of [/\bDROP\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bALTER\b/i, /\bCREATE\b/i, /\bINSERT\b/i, /\bADD\s+CONSTRAINT\b/i]) expect(sql, String(bad)).not.toMatch(bad);
    expect(statements.every((s) => RULE.test(s))).toBe(true);
    expect(new Set(rules.map((r) => r.table))).toEqual(new Set(["Alert", "Notification"]));
  });

  it("gives the alerts and the notices the same rules, in the same order", () => {
    const of = (t: string) => rules.filter((r) => r.table === t).map((r) => `${r.from.source} → ${r.to}`);
    expect(of("Alert")).toEqual(of("Notification"));
    expect(of("Alert").length).toBeGreaterThanOrEqual(12);
  });
});

describe("it moves each old address to where its screen went", () => {
  const TABLE: [string, string][] = [
    ["/work", "/tasks/all"],
    ["/work/today", "/tasks/day"],
    ["/work/tasks", "/tasks/team"],
    ["/work/reports", "/tasks/results"],
    ["/work/reports/report%3A42", "/tasks/results/report%3A42"],
    ["/work/job/night-round", "/tasks/night-round"],
    ["/work/job/night-round/draw", "/tasks/night-round/edit"],
    ["/ops", "/numbers/ops"],
    ["/ops/confirm", "/numbers/ops"],
    ["/ops/shipping", "/numbers/ops"],
    ["/ops/stock", "/numbers/stock"],
    ["/products", "/numbers/products"],
    ["/products/TRF01", "/numbers/products/TRF01"],
    ["/ads/campaigns", "/ads"],
  ];

  it("every row of the table of the redirects, for the alerts and for the notices", () => {
    for (const t of ["Alert", "Notification"] as const) for (const [from, to] of TABLE) expect(migrate(t, from), `${t} ${from}`).toBe(to);
  });

  it("keeps the query and the hash of a link", () => {
    expect(migrate("Alert", "/work/today?day=2026-11-20")).toBe("/tasks/day?day=2026-11-20");
    expect(migrate("Alert", "/work/tasks?board=leak")).toBe("/tasks/team?board=leak");
    expect(migrate("Alert", "/work/reports/report%3A42?x=1")).toBe("/tasks/results/report%3A42?x=1");
    expect(migrate("Alert", "/work/job/night-round/draw?view=board")).toBe("/tasks/night-round/edit?view=board");
    expect(migrate("Alert", "/work#a")).toBe("/tasks/all#a");
    expect(migrate("Notification", "/ops/stock?x=1")).toBe("/numbers/stock?x=1");
    expect(migrate("Notification", "/products/TRF01?p=7")).toBe("/numbers/products/TRF01?p=7");
    expect(migrate("Notification", "/ads/campaigns?open=123")).toBe("/ads?open=123");
  });

  it("leaves alone what is not an old address: the new ones, the lookalikes, the settings, other sites, nothing", () => {
    for (const keep of ["/tasks/day", "/inbox", "/ads?open=1", "/numbers/ops", "/workflow", "/operations", "/products-list", "/work-in-progress", "/settings/products", "https://x.example/work", "/ads/campaigns2", "/"]) {
      expect(migrate("Alert", keep), keep).toBe(keep);
    }
    expect(migrate("Alert", null)).toBeNull();
    expect(migrate("Notification", null)).toBeNull();
  });

  it("a second run changes nothing (a moved link no longer matches any rule)", () => {
    for (const [from] of TABLE) {
      const once = migrate("Alert", from)!;
      expect(migrate("Alert", once), from).toBe(once);
    }
  });

  it("moves the whole of what next.config.mjs redirects from the old map, so a link written yesterday and one typed from a bookmark end on the same screen", async () => {
    const url = new URL("../next.config.mjs", import.meta.url).href;
    const mod = await import(/* @vite-ignore */ url);
    const list = (await mod.default.redirects()) as { source: string; destination: string; has?: unknown }[];
    for (const r of list.filter((x) => /^\/(work|ops|products|ads\/campaigns)(\/|$)/.test(x.source) && !x.has)) {
      const from = r.source.replace(/:(\w+)/g, "x$1");
      const want = r.destination.replace(/:(\w+)/g, "x$1");
      expect(migrate("Alert", from), r.source).toBe(want);
    }
  });
});
