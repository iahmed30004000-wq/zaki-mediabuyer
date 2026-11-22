/**
 * The v6 P1-2 migration is safe on a live database (rule 5 of docs/rebuild-v6/06-phases.md): indexes that are created only if missing, and two checks added
 * NOT VALID — and only when no row already breaks them — so no row written before can stop it from running or be refused on its next update. The code
 * keeps the same lists the checks hold. (It was also run on a real Postgres 16 with rows that break both checks: docs/rebuild-v6/NOTES.md.)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATES } from "@/core/changeset";
import { PERMISSIONS } from "@/core/workflow";

const dir = path.resolve(__dirname, "..", "prisma", "migrations");
const name = readdirSync(dir).find((d) => d.endsWith("_v6_watchdog"))!;
const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("the migration is additive and safe", () => {
  it("comes after the engine's (P1-1); a later phase's own migration (P3's data-only one) comes after it", () => {
    const all = readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all.indexOf(name)).toBeGreaterThan(all.findIndex((d) => d.endsWith("_v6_engine")));
  });

  it("has no DROP, RENAME, TRUNCATE, DELETE, UPDATE, INSERT or type change, and adds no column", () => {
    for (const bad of [/\bDROP\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\b/i, /\bINSERT\b/i, /\bALTER\s+COLUMN\b/i, /\bSET\s+NOT\s+NULL\b/i, /\bADD\s+COLUMN\b/i]) expect(code, String(bad)).not.toMatch(bad);
  });

  it("every index is created IF NOT EXISTS and is not CONCURRENT (it runs inside the migration's own transaction)", () => {
    const idx = code.split("\n").filter((l) => /^CREATE INDEX/i.test(l));
    expect(idx).toHaveLength(6);
    for (const s of idx) {
      expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "[A-Za-z_]+_idx" ON "[A-Za-z]+"\([^)]*\);$/);
      expect(s).not.toMatch(/CONCURRENTLY/i);
    }
  });

  it("every check is added NOT VALID, only when it is not there, and only when no row already breaks it", () => {
    const adds = [...code.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" CHECK \((.*)\) NOT VALID;/g)];
    expect(adds.map((m) => m[2])).toEqual(["Workflow_permission_check", "ChangeSet_state_check"]);
    expect((code.match(/ADD CONSTRAINT/g) ?? []).length).toBe(2);
    expect(code.match(/ELSIF EXISTS \(SELECT 1 FROM "(Workflow|ChangeSet)" WHERE "\w+" NOT IN/g)).toHaveLength(2);
    expect(code.match(/IF EXISTS \(SELECT 1 FROM pg_constraint WHERE "conname" = /g)).toHaveLength(2);
    // nothing else: no foreign key, no unique, no primary key, no validation
    expect(code).not.toMatch(/FOREIGN KEY|UNIQUE|PRIMARY KEY|VALIDATE CONSTRAINT/i);
  });

  it("the guard of each check holds the same list as the check itself", () => {
    for (const [table, col] of [["Workflow", "permission"], ["ChangeSet", "state"]] as const) {
      const guard = code.match(new RegExp(`"${table}" WHERE "${col}" NOT IN \\(([^)]*)\\)`))![1];
      const check = code.match(new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "\\w+" CHECK \\("${col}" IN \\(([^)]*)\\)\\)`))![1];
      expect(guard).toBe(check);
    }
  });
});

describe("the two checks hold the lists the code holds", () => {
  const listOf = (check: string) => [...(code.match(new RegExp(`"${check}" CHECK \\("\\w+" IN \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

  it("Workflow.permission is green · yellow · red · black", () => {
    expect(listOf("Workflow_permission_check")).toEqual([...PERMISSIONS]);
  });

  it("ChangeSet.state is the nine states of the change set", () => {
    expect(listOf("ChangeSet_state_check")).toEqual([...STATES]);
  });
});

describe("the schema carries the indexes the migration creates (no drift)", () => {
  const schema = readFileSync(path.resolve(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const model = (m: string) => schema.match(new RegExp(`model ${m} \\{[\\s\\S]*?\\n\\}`))![0];

  it("each created index has its @@index in the model", () => {
    expect(model("Campaign")).toContain("@@index([accountId])");
    expect(model("AdSet")).toContain("@@index([campaignId])");
    expect(model("Ad")).toContain("@@index([adSetId])");
    expect(model("Alert")).toContain("@@index([createdAt])");
    expect(model("Alert")).toContain("@@index([sentAt, createdAt])");
    expect(model("WorkflowRun")).toContain("@@index([workflowId, startedAt])");
  });
});
