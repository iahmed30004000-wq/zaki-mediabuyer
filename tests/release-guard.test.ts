import { describe, expect, it } from "vitest";
import path from "node:path";
import { checkMigrations, migrationProblems, parseAllowList, protectedChanges, stripSqlComments } from "../scripts/release-guard.mjs";

const rules = (sql: string) => migrationProblems(sql).map((p: { rule: string }) => p.rule);

describe("release guard — files the robot never merges", () => {
  it("holds back the deploy files, the guard and its allow-list", () => {
    const hit = protectedChanges([
      "src/core/economics.ts",
      ".github/workflows/ci.yml",
      "Dockerfile",
      "docker-compose.prod.yml",
      "docker-compose.yml",
      ".dockerignore",
      "scripts/release-guard.mjs",
      "scripts/release-guard.allow",
    ]);
    expect(hit).toEqual([".github/workflows/ci.yml", "Dockerfile", "docker-compose.prod.yml", "docker-compose.yml", ".dockerignore", "scripts/release-guard.mjs", "scripts/release-guard.allow"]);
  });

  it("lets ordinary files through, including look-alikes", () => {
    expect(protectedChanges(["src/app/page.tsx", "docs/Dockerfile.md", "scripts/smoke.mjs", "tests/docker-compose.test.ts", "prisma/migrations/x/migration.sql", "src/Dockerfile"])).toEqual([]);
  });

  it("normalises Windows separators, a leading ./ and blank lines", () => {
    expect(protectedChanges(["", ".\\.github\\workflows\\release.yml", "./Dockerfile", "  "])).toEqual([".github/workflows/release.yml", "Dockerfile"]);
  });
});

describe("release guard — migrations must be additive", () => {
  it("accepts plain additions", () => {
    const sql = `
      -- a new table and a new optional column
      CREATE TABLE "Thing" ("id" TEXT NOT NULL, "n" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "Thing_pkey" PRIMARY KEY ("id"));
      ALTER TABLE "Old" ADD COLUMN "note" TEXT;
      ALTER TABLE "Old" ADD COLUMN "n2" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "m" DECIMAL(10,2);
      CREATE INDEX "Old_note_idx" ON "Old"("note");
      ALTER TABLE "Thing" ADD CONSTRAINT "Thing_x_fkey" FOREIGN KEY ("x") REFERENCES "Old"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      UPDATE "Old" SET "note" = 'x' WHERE "note" IS NULL;
    `;
    expect(migrationProblems(sql)).toEqual([]);
  });

  it("flags DROP, RENAME, a type change and TRUNCATE", () => {
    expect(rules('DROP TABLE "A";')).toEqual(["drop"]);
    expect(rules('ALTER TABLE "A" DROP COLUMN "b";')).toEqual(["drop"]);
    expect(rules('DROP INDEX "A_b_idx";')).toEqual(["drop"]);
    expect(rules('ALTER TABLE "A" RENAME COLUMN "b" TO "c";')).toEqual(["rename"]);
    expect(rules('ALTER TABLE "A" RENAME TO "B";')).toEqual(["rename"]);
    expect(rules('ALTER TABLE "A" ALTER COLUMN "b" TYPE TEXT;')).toEqual(["column-type"]);
    expect(rules('ALTER TABLE "A" ALTER COLUMN "b" SET DATA TYPE BIGINT;')).toEqual(["column-type"]);
    expect(rules('TRUNCATE "A";')).toEqual(["truncate"]);
    expect(rules('delete from "A";')).toEqual(["delete-all"]);
  });

  it("lets a loosening through: DROP NOT NULL, DROP DEFAULT, a DELETE with a WHERE", () => {
    expect(rules('ALTER TABLE "A" ALTER COLUMN "b" DROP NOT NULL;')).toEqual([]);
    expect(rules('ALTER TABLE "A" ALTER COLUMN "b" DROP DEFAULT;')).toEqual([]);
    expect(rules('DELETE FROM "A" WHERE "id" = 1;')).toEqual([]);
  });

  it("flags a NOT NULL column with no default (fails on a table that has rows)", () => {
    expect(rules('ALTER TABLE "A" ADD COLUMN "b" TEXT NOT NULL;')).toEqual(["not-null-without-default"]);
    expect(rules('ALTER TABLE "A" ADD COLUMN "a" TEXT, ADD COLUMN "b" TEXT NOT NULL;')).toEqual(["not-null-without-default"]);
    expect(rules('ALTER TABLE "A" ADD COLUMN "b" TEXT NOT NULL DEFAULT \'\';')).toEqual([]);
    expect(rules('ALTER TABLE "A" ADD COLUMN "b" NUMERIC(10,2) NOT NULL DEFAULT 0;')).toEqual([]);
  });

  it("ignores keywords in comments, quoted names and string values", () => {
    const sql = `
      -- Additive only: nothing is dropped, nothing is renamed
      /* DROP TABLE "A"; */
      ALTER TABLE "A" ADD COLUMN "type" TEXT DEFAULT 'drop table';
      ALTER TABLE "A" ALTER COLUMN "type" SET NOT NULL;
      UPDATE "A" SET "rename" = 'truncate' WHERE "id" = 1;
    `;
    expect(migrationProblems(sql)).toEqual([]);
  });

  it("reports the line the statement starts on", () => {
    const sql = 'CREATE TABLE "A" ("id" TEXT);\n\n-- note\nALTER TABLE "A"\n  DROP COLUMN "id";\n';
    expect(migrationProblems(sql)).toEqual([{ rule: "drop", line: 4 }]);
  });

  it("strips comments but keeps line numbers", () => {
    expect(stripSqlComments("a -- b\n/* c\nd */ e").split("\n").length).toBe(3);
  });

  it("an allow-list entry lets that one migration through", () => {
    expect(parseAllowList("# why\n20261201000000_cleanup  # drops an old table\n\n")).toEqual(new Set(["20261201000000_cleanup"]));
  });

  it("every migration in this repository is additive (the live database applies them all at start-up)", () => {
    const dir = path.join(__dirname, "..", "prisma", "migrations");
    expect(checkMigrations(dir, new Set())).toEqual([]);
  });
});
