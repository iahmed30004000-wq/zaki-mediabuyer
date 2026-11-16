import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/core/roles";

/**
 * docs/rebuild/05-permissions.md §9: every API route checks who is asking, with a capability of the table (or a token, or it is on the declared open list).
 * A new route with no guard is a failing test — not a review comment.
 */
const API = join(process.cwd(), "src", "app", "api");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : [];
  });
}

/** Routes that are open on purpose: the door itself, the health check, and the ones that carry a Bearer token and check it in the route (`requireToken`). */
const OPEN: { path: RegExp; why: string }[] = [
  { path: /^auth\//, why: "login, logout and the invite code: there is no session yet" },
  { path: /^health\//, why: "the deploy check" },
  { path: /^telegram\/webhook\//, why: "Telegram calls it, with its own secret" },
];

const files = routes(API).map((p) => ({ rel: relative(API, p).replace(/\\/g, "/"), src: readFileSync(p, "utf8") }));

describe("every API route is guarded", () => {
  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  for (const f of files) {
    it(f.rel, () => {
      const open = OPEN.find((o) => o.path.test(f.rel));
      const caps = [...f.src.matchAll(/requireCapability\(([^)]*)\)/g)];
      const guarded = caps.length > 0 || /requireSignedIn\(\)/.test(f.src) || /requireToken\(/.test(f.src) || /requireMcp\(/.test(f.src) || /withHandoffToken\(/.test(f.src) || /from "@\/app\/api\//.test(f.src);
      expect(guarded || !!open, `${f.rel} has no guard`).toBe(true);
      // every capability named is one of the eighteen (the old names are gone)
      for (const c of caps) {
        const named = [...c[1]!.matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]!).filter((n) => n.includes(".") || n === "owner_only" || /^(view|connect_meta|propose_change|pause_or_reduce|approve_within_cap|kill_switch)$/.test(n));
        expect(named.length, `${f.rel}: requireCapability(${c[1]})`).toBeGreaterThan(0);
        for (const n of named) expect((CAPABILITIES as readonly string[]).includes(n), `${f.rel}: «${n}» is not a capability of the table`).toBe(true);
      }
    });
  }

  it("no route still names an old capability anywhere in src", () => {
    const old = /\b(?:can|requireCapability)\([^)]*"(?:view|connect_meta|propose_change|pause_or_reduce|approve_within_cap|kill_switch)"/;
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) ? [join(d, n)] : []));
    const bad = walk(join(process.cwd(), "src")).filter((p) => old.test(readFileSync(p, "utf8")));
    expect(bad.map((p) => relative(process.cwd(), p))).toEqual([]);
  });
});
