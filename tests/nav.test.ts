import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_GUIDE, guideOf } from "@/lib/guide";
import { ROLE_PLACES } from "@/core/roles";
import { BUILTIN_PAGES, LEGACY_PAGES, NAV_COOKIE, PLACES, PLACES_V6, READY_PLACES, SETTINGS, hrefOfPlace, navMapFor, placeOf, placesFor, tabOf } from "@/lib/nav";
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

  it("all five places are in the menu (التشغيل came with P9)", () => {
    expect(PLACES.every((p) => p.ready)).toBe(true);
    expect(READY_PLACES.map((p) => p.key)).toEqual(["home", "inbox", "work", "ads", "ops"]);
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

describe("the new map (v6 · P3, docs/rebuild-v6/02-screens.md §1) — a trial next to the old one", () => {
  it("has four places in this order, each with its own key, address, question and guide", () => {
    expect(PLACES_V6.map((p) => p.label)).toEqual(["الرئيسية", "المهام", "الأرقام", "الإعلانات"]);
    expect(new Set(PLACES_V6.map((p) => p.key)).size).toBe(4);
    for (const p of PLACES_V6) {
      expect(p.question.length).toBeGreaterThan(5);
      expect(PAGE_GUIDE[p.key].what.length).toBeGreaterThan(10);
    }
  });

  it("«المهام» has four tabs and the first is the place; every tab is a page that exists", () => {
    const tasks = PLACES_V6.find((p) => p.key === "tasks")!;
    expect(tasks.tabs.map((t) => t.label)).toEqual(["هلق", "جدول اليوم", "كل المهام", "النتائج"]);
    expect(tasks.tabs[0]!.href).toBe(tasks.href);
    for (const t of tasks.tabs) expect(pageExists(t.href), t.href).toBe(true);
  });

  it("a place whose screens are not built leads to its old counterpart: «الأرقام» opens the operations screens until P6", () => {
    const numbers = PLACES_V6.find((p) => p.key === "numbers")!;
    expect(numbers.ready).toBe(false);
    expect(hrefOfPlace(numbers)).toBe("/ops");
    expect(pageExists(hrefOfPlace(numbers))).toBe(true);
    expect(hrefOfPlace(PLACES_V6[1]!)).toBe("/tasks");
  });

  it("the owner and the manager get the new map by default; everybody else keeps the old one until P8; the cookie decides when it is there; anything else in it is ignored", () => {
    expect(navMapFor(undefined, "OWNER")).toBe("v6");
    expect(navMapFor(null, "MANAGER")).toBe("v6");
    expect(navMapFor(undefined, "TEAM_LEAD")).toBe("old");
    expect(navMapFor(undefined, "MEMBER")).toBe("old");
    expect(navMapFor("old", "OWNER")).toBe("old");
    expect(navMapFor("v6", "MEMBER")).toBe("v6");
    expect(navMapFor("garbage", "OWNER")).toBe("v6");
    expect(navMapFor("garbage", "VIEWER")).toBe("old");
    expect(NAV_COOKIE).toBe("mb_nav");
  });

  it("the places of a role's bar, in the new map: «المهام» is the work place, «الأرقام» the operations place", () => {
    expect(placesFor("v6", ROLE_PLACES.OWNER).map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(placesFor("v6", ROLE_PLACES.ADS_MANAGER).map((p) => p.key)).toEqual(["home", "tasks", "ads"]);
    expect(placesFor("v6", ROLE_PLACES.MEMBER).map((p) => p.key)).toEqual(["tasks"]);
    expect(placesFor("old", ROLE_PLACES.OWNER).map((p) => p.key)).toEqual(["home", "inbox", "work", "ads", "ops"]);
  });

  it("each map finds the place of an address: the new one keeps the old work and operations addresses inside «المهام» and «الأرقام»; the old one keeps «/tasks» inside «الشغل»", () => {
    expect(placeOf("/tasks/day", "v6").key).toBe("tasks");
    expect(placeOf("/tasks/night/runs/r1", "v6").key).toBe("tasks");
    expect(placeOf("/work/job/x", "v6").key).toBe("tasks");
    expect(placeOf("/ops/stock", "v6").key).toBe("numbers");
    expect(placeOf("/products/X", "v6").key).toBe("numbers");
    expect(placeOf("/ads/campaigns", "v6").key).toBe("ads");
    expect(placeOf("/inbox/later", "v6")).toMatchObject({ key: "inbox", title: "بانتظارك" });
    expect(placeOf("/settings/team", "v6").key).toBe("settings");
    expect(placeOf("/", "v6").key).toBe("home");
    expect(placeOf("/tasks/day", "old").key).toBe("work");
    expect(placeOf("/tasks", "old").key).toBe("work");
    expect(placeOf("/ops", "old").key).toBe("ops");
    expect(tabOf("/tasks/results/run%3Ax", "v6")?.href).toBe("/tasks/results");
    expect(tabOf("/tasks/night", "v6")?.href).toBe("/tasks");
  });

  it("«الأرقام» is not a place of its own yet: no tab, and nothing in the old map changed", () => {
    expect(PLACES_V6.find((p) => p.key === "numbers")!.tabs).toEqual([]);
    expect(PLACES.map((p) => p.key)).toEqual(["home", "inbox", "work", "ads", "ops"]);
  });
});

describe("the old addresses (v5 · P2)", () => {
  const OLD = ["/workflow", "/workflow/:key", "/done", "/videos", "/decisions", "/creatives", "/reports", "/guide", "/setup"];

  it("every old address still opens somewhere", async () => {
    const list = await redirects();
    for (const from of OLD) expect(list.some((r) => r.source === from), from).toBe(true);
    expect(list.some((r) => r.source === "/" && r.has?.[0]?.value === "numbers")).toBe(true);
  });

  it("«/tasks» is a real place now (v6 · P3): it is no longer an old address that leads to «/inbox», and its pages exist", async () => {
    const list = await redirects();
    expect(list.some((r) => r.source === "/tasks" || r.source.startsWith("/tasks/"))).toBe(false);
    for (const a of ["/tasks", "/tasks/day", "/tasks/all", "/tasks/results", "/tasks/results/:id", "/tasks/team", "/tasks/:key", "/tasks/:key/runs/:id", "/tasks/:key/edit"]) expect(pageExists(a), a).toBe(true);
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
