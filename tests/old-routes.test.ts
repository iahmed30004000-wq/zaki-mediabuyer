/**
 * Nothing that runs links to an address of v5 any more (v6 · P8, docs/rebuild-v6/02-screens.md §8 and 00-audit.md U-14). The old addresses still OPEN — next.config.mjs redirects them — but the
 * code, the server, the worker and the service worker write the new ones. This reads the source, the way tests/ui-rules.test.ts does: a plain text match is a signal for a person to look at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "../scripts/ui-rules";

const root = path.resolve(__dirname, "..");

/** A string that is, or starts with, an address of the old map: «/work…» · «/ops…» · «/products…» · «/ads/campaigns…» · «/p/…». */
const OLD = /(["'`])\/(?:work|ops|products|ads\/campaigns|p)(?=[/?#$"'`]|\b)/;

/** Files whose text is NOT an address of this site: the OMS' own endpoints are named «/products» too. */
const NOT_OURS = new Set(["src/adapters/oms.ts"]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield p;
  }
}

function offenders(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    for (const abs of walk(path.join(root, d))) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (NOT_OURS.has(rel)) continue;
      const lines = withoutComments(readFileSync(abs, "utf8")).split("\n");
      lines.forEach((l, i) => {
        if (OLD.test(l)) out.push(`${rel}:${i + 1}  ${l.trim().slice(0, 110)}`);
      });
    }
  }
  return out;
}

describe("no live code links to an old address", () => {
  it("the app, the components, the server, the worker and the scripts write only the new addresses", () => {
    expect(offenders(["src", "worker", "scripts"])).toEqual([]);
  });

  it("the service worker and the other public files do not either", () => {
    const out: string[] = [];
    for (const name of readdirSync(path.join(root, "public"))) {
      if (!/\.(js|json|webmanifest)$/.test(name)) continue;
      const text = readFileSync(path.join(root, "public", name), "utf8");
      if (OLD.test(text)) out.push(name);
    }
    expect(out).toEqual([]);
  });

  it("the check itself sees what it is for (a link to an old place, in any quote, is found; a comment, the settings and a new address are not)", () => {
    for (const bad of ['<Link href="/work/tasks">', "router.push(`/ops/stock`)", "redirect('/products')", 'url: "/work/reports"', '{ href: "/ads/campaigns?open=1" }', 'href: "/p/pg-1"']) expect(OLD.test(bad), bad).toBe(true);
    for (const fine of ['href="/tasks/team"', 'href="/numbers/products/TRF01"', 'href="/settings/products"', 'href="/ads?open=1"', '"/api/products"', 'href="/operations"', 'href="/works"', 'href="/pages"']) expect(OLD.test(fine), fine).toBe(false);
  });
});
