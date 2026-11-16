import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_GUIDE, guideOf } from "@/lib/guide";
import { BUILTIN_PAGES, LEGACY_PAGES, PLACES, READY_PLACES, SETTINGS, placeOf, tabOf } from "@/lib/nav";
import { tabIsActive } from "@/components/ui/tabs";

type Redirect = { source: string; destination: string; permanent: boolean; has?: { type: string; key: string; value: string }[] };

/** next.config.mjs has no types (allowJs is off), so it is loaded by address. */
async function redirects(): Promise<Redirect[]> {
  const url = new URL("../next.config.mjs", import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  return mod.default.redirects();
}

const APP = path.resolve(__dirname, "../src/app/(app)");
/** True when an address is a page of the app: `/work/job/:key/draw` ↔ `work/job/[key]/draw/page.tsx`. */
const pageExists = (address: string) => existsSync(path.join(APP, ...address.split("/").filter(Boolean).map((seg) => (seg.startsWith(":") ? `[${seg.slice(1)}]` : seg)), "page.tsx"));

describe("the map (v5 · P2)", () => {
  it("has five places and the settings, in this order", () => {
    expect(PLACES.map((p) => p.label)).toEqual(["الرئيسية", "بانتظارك", "الشغل", "الإعلانات", "التشغيل"]);
    expect(SETTINGS.href).toBe("/settings");
  });

  it("gives each place its own key and address, a question and a guide", () => {
    expect(new Set(PLACES.map((p) => p.key)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(PLACES.length);
    for (const p of PLACES) {
      expect(p.question.length).toBeGreaterThan(5);
      expect(PAGE_GUIDE[p.key].what.length).toBeGreaterThan(10);
    }
  });

  it("«التشغيل» is not in the menu until its screens exist", () => {
    expect(PLACES.find((p) => p.key === "ops")?.ready).toBe(false);
    expect(READY_PLACES.map((p) => p.key)).toEqual(["home", "inbox", "work", "ads"]);
  });

  it("every place has at most four tabs and its first tab IS the place", () => {
    for (const p of PLACES) {
      expect(p.tabs.length).toBeLessThanOrEqual(4);
      if (p.tabs.length) expect(p.tabs[0]!.href).toBe(p.href);
    }
  });

  it("every tab that is shown is a page that exists (no «قريباً» screens)", () => {
    for (const p of READY_PLACES) {
      expect(pageExists(p.href), p.href).toBe(true);
      for (const t of p.tabs.filter((x) => x.ready !== false)) expect(pageExists(t.href.split("?")[0]!), t.href).toBe(true);
    }
    for (const a of ["/products", "/settings", "/ads/health", "/ads/scale", "/work/job/:key", "/work/job/:key/draw"]) expect(pageExists(a), a).toBe(true);
  });

  it("finds the place of a path and of its children; the products and the settings are not places; anything unknown is the home", () => {
    expect(placeOf("/").key).toBe("home");
    expect(placeOf("/ads").key).toBe("ads");
    expect(placeOf("/ads/campaigns").key).toBe("ads");
    expect(placeOf("/work/job/night-round/draw").key).toBe("work");
    expect(placeOf("/inbox/later").key).toBe("inbox");
    expect(placeOf("/products").key).toBe("products");
    expect(placeOf("/settings/team").key).toBe("settings");
    expect(placeOf("/adsense").key).toBe("home");
    expect(placeOf("/nowhere").key).toBe("home");
  });

  it("finds the tab of a path (the longest matching address), or none for a place without tabs", () => {
    expect(tabOf("/work")?.href).toBe("/work");
    expect(tabOf("/work/tasks")?.href).toBe("/work/tasks");
    expect(tabOf("/work/job/x/draw")?.href).toBe("/work");
    expect(tabOf("/ads/campaigns")?.href).toBe("/ads/campaigns");
    expect(tabOf("/")).toBeNull();
    expect(tabOf("/settings")).toBeNull();
  });

  it("a tab is active on its own address only when it is the first of its place; the others also on their children; a ?view tab needs its query", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(tabIsActive("/ads", "/ads", q(""), true)).toBe(true);
    expect(tabIsActive("/ads", "/ads/campaigns", q(""), true)).toBe(false);
    expect(tabIsActive("/ads/campaigns", "/ads/campaigns", q(""))).toBe(true);
    expect(tabIsActive("/ads/videos?view=flow", "/ads/videos", q("view=flow"))).toBe(true);
    expect(tabIsActive("/ads/videos?view=flow", "/ads/videos", q(""))).toBe(false);
  });
});

describe("the old addresses (v5 · P2)", () => {
  const OLD = ["/tasks", "/workflow", "/workflow/:key", "/done", "/videos", "/decisions", "/creatives", "/reports", "/guide", "/setup"];

  it("every old address still opens somewhere", async () => {
    const list = await redirects();
    for (const from of OLD) expect(list.some((r) => r.source === from), from).toBe(true);
    expect(list.some((r) => r.source === "/" && r.has?.[0]?.value === "numbers")).toBe(true);
  });

  it("every destination is a page that exists", async () => {
    for (const r of await redirects()) {
      const dest = r.destination.split(/[?#]/)[0]!;
      if (dest === "/settings") continue; // the settings page itself (its hash is read in the browser)
      expect(pageExists(dest), `${r.source} → ${r.destination}`).toBe(true);
    }
  });

  it("never loops: a destination never matches its own rule", async () => {
    for (const r of await redirects()) {
      const dest = r.destination.split(/[?#]/)[0]!.replace(/\/:\w+/g, "/x");
      const src = r.source.replace(/\/:\w+/g, "/x");
      expect(dest === src && !r.destination.includes("?"), `${r.source} → ${r.destination}`).toBe(false);
    }
  });

  it("is never permanent (the owner may still move things)", async () => {
    for (const r of await redirects()) expect(r.permanent).toBe(false);
  });

  it("puts the rule with a condition before the plain one of the same source (or the plain one would swallow it)", async () => {
    const list = await redirects();
    for (const src of new Set(list.map((r) => r.source))) {
      const same = list.filter((r) => r.source === src);
      const firstPlain = same.findIndex((r) => !r.has);
      if (firstPlain >= 0) expect(same.slice(firstPlain + 1).every((r) => !r.has), src).toBe(true);
    }
  });

  it("sends the old data / safety tabs of the reports to «صحة البيانات», and the rest to the work reports", async () => {
    const list = await redirects();
    expect(list.find((r) => r.source === "/reports" && r.has?.length)?.destination).toBe("/ads/health");
    expect(list.find((r) => r.source === "/reports" && !r.has)?.destination).toBe("/work/reports");
  });
});

describe("the pages of v3 as the customization layer reads them (retired in P11)", () => {
  it("BUILTIN_PAGES is the seven old pages as plain data, in order", () => {
    expect(BUILTIN_PAGES.map((p) => p.key)).toEqual(LEGACY_PAGES.map((p) => p.key));
    expect(BUILTIN_PAGES.map((p) => p.key)).toEqual(["today", "ads", "videos", "tasks", "workflow", "done", "settings"]);
    expect(BUILTIN_PAGES.filter((p) => p.mobile).map((p) => p.key)).toEqual(["today", "ads", "tasks", "workflow"]);
    expect(JSON.parse(JSON.stringify(BUILTIN_PAGES))).toEqual(BUILTIN_PAGES);
  });
  it("a page of the owner's has a guide too, and the built-in ones keep theirs", () => {
    expect(guideOf("pg-1a2b3c").what.length).toBeGreaterThan(10);
    expect(guideOf("pg-1a2b3c").tour).toEqual([]);
    expect(guideOf("ads")).toBe(PAGE_GUIDE.ads);
  });
});
