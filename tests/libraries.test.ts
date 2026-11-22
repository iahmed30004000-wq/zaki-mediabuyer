/**
 * What the library upgrade (v6 P0-4) must not lose: Next 16 reads `params` / `searchParams` / `cookies()` / `headers()` asynchronously,
 * the config uses the stable names, and the container finds `tsx` and `prisma` without dev dependencies.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; engines?: { node?: string }; scripts: Record<string, string>; overrides?: Record<string, unknown> };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const files = walk(path.join(root, "src"));

describe("Next 16: the request values are asynchronous", () => {
  it("no page, layout or route handler takes `params` or `searchParams` as a plain object", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\/(page|layout|route)\.tsx?$/.test(rel(x)))) {
      const src = readFileSync(f, "utf8");
      if (/\b(params|searchParams): \{/.test(src)) bad.push(rel(f));
      if (/\{ (searchParams|params)(, (searchParams|params))? \}: /.test(src)) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  it("`cookies()` and `headers()` are always awaited", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/from "next\/headers"/.test(src)) continue;
      if (/(?<!await )(?<![A-Za-z_.])(cookies|headers)\(\)/.test(src.replace(/\(await (cookies|headers)\(\)\)/g, "").replace(/await (cookies|headers)\(\)/g, ""))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
});

describe("configuration and dependencies", () => {
  it("next.config uses the stable name for the external packages and none of the removed keys", () => {
    const src = read("next.config.mjs");
    expect(src).toMatch(/serverExternalPackages:/);
    expect(src).not.toMatch(/serverComponentsExternalPackages|instrumentationHook|ignoreDuringBuilds/);
  });

  it("the container needs tsx (the worker) and prisma (migrations) — they are not dev dependencies", () => {
    expect(pkg.dependencies.tsx).toBeTruthy();
    expect(pkg.dependencies.prisma).toBeTruthy();
    expect(pkg.devDependencies.tsx).toBeUndefined();
    expect(pkg.devDependencies.prisma).toBeUndefined();
  });

  it("Prisma and its client are the same major, and the node range is stated", () => {
    expect(pkg.dependencies.prisma!.replace(/^[^\d]*/, "").split(".")[0]).toBe(pkg.dependencies["@prisma/client"]!.replace(/^[^\d]*/, "").split(".")[0]);
    expect(pkg.engines?.node).toMatch(/>=20/);
  });

  it("lint is the ESLint command (next lint no longer exists) and fails on a warning", () => {
    expect(pkg.scripts.lint).toBe("eslint . --max-warnings 0");
    expect(() => read("eslint.config.mjs")).not.toThrow();
  });
});
