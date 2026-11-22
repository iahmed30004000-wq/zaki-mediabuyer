import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_GUIDE, guideOf } from "@/lib/guide";
import { ROLE_PLACES } from "@/core/roles";
import { INBOX_TABS, PLACES, SETTINGS, placeOf, placesFor, tabOf } from "@/lib/nav";
import { tabIsActive } from "@/components/ui/tabs";

type Redirect = { source: string; destination: string; permanent: boolean; has?: { type: string; key: string; value: string }[] };

/** next.config.mjs has no types (allowJs is off), so it is loaded by address. */
async function redirects(): Promise<Redirect[]> {
  const url = new URL("../next.config.mjs", import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  return mod.default.redirects();
}

const APP = path.resolve(__dirname, "../src/app/(app)");
/** True when an address is a page of the app: `/tasks/:key/edit` ↔ `tasks/[key]/edit/page.tsx`. */
const pageExists = (address: string) => existsSync(path.join(APP, ...address.split("/").filter(Boolean).map((seg) => (seg.startsWith(":") ? `[${seg.slice(1)}]` : seg)), "page.tsx"));

/** What an old address becomes: the same table the site uses, applied to a real address (`:key` fills in; the query is carried over). */
function target(list: Redirect[], from: string): string | null {
  const [pathname, query] = from.split("?");
  for (const r of list) {
    if (r.has) continue;
    const names: string[] = [];
    const re = new RegExp("^" + r.source.replace(/:(\w+)/g, (_, n: string) => (names.push(n), "([^/]+)")) + "$");
    const m = re.exec(pathname!);
    if (!m) continue;
    let dest = r.destination;
    names.forEach((n, i) => (dest = dest.replace(`:${n}`, m[i + 1]!)));
    return query ? `${dest}${dest.includes("?") ? "&" : "?"}${query}` : dest;
  }
  return null;
}

describe("the map (v6 · P8, docs/rebuild-v6/02-screens.md §1): four places and the settings, the only map", () => {
  it("has four places in this order, and the settings apart", () => {
    expect(PLACES.map((p) => p.label)).toEqual(["الرئيسية", "المهام", "الأرقام", "الإعلانات"]);
    expect(PLACES.map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(SETTINGS.href).toBe("/settings");
  });

  it("gives each place its own key and address, a question and a guide", () => {
    expect(new Set(PLACES.map((p) => p.key)).size).toBe(4);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(4);
    for (const p of PLACES) {
      expect(p.question.length).toBeGreaterThan(5);
      expect(PAGE_GUIDE[p.key].what.length).toBeGreaterThan(10);
      expect(PAGE_GUIDE[p.key].next.length).toBeGreaterThan(10);
    }
    // the decisions list and the settings have a guide too; the places of v5 («الشغل» · «التشغيل» · «المنتجات») do not any more
    expect(PAGE_GUIDE.inbox.what.length).toBeGreaterThan(10);
    expect(PAGE_GUIDE.settings.what.length).toBeGreaterThan(10);
    expect(Object.keys(PAGE_GUIDE).sort()).toEqual(["ads", "home", "inbox", "numbers", "settings", "tasks"]);
  });

  it("every place has at most four tabs and its first tab IS the place", () => {
    for (const p of PLACES) {
      expect(p.tabs.length).toBeLessThanOrEqual(4);
      if (p.tabs.length) expect(p.tabs[0]!.href).toBe(p.href);
    }
    expect(INBOX_TABS.map((t) => t.href)).toEqual(["/inbox", "/inbox/later", "/inbox/done"]);
  });

  it("the tabs are the ones of the plan, and every place and tab is a page that exists (no «قريباً» screens)", () => {
    const labels = (k: string) => PLACES.find((p) => p.key === k)!.tabs.map((t) => t.label);
    expect(labels("tasks")).toEqual(["هلق", "جدول اليوم", "كل المهام", "النتائج"]);
    expect(labels("numbers")).toEqual(["الخلاصة", "المنتجات", "التأكيد والشحن", "المخزون"]);
    expect(labels("ads")).toEqual(["الحملات", "الفيديوهات", "الاختبارات"]);
    for (const p of PLACES) {
      expect(pageExists(p.href === "/" ? "" : p.href) || p.href === "/", p.href).toBe(true);
      for (const t of p.tabs) expect(pageExists(t.href.split("?")[0]!), t.href).toBe(true);
    }
    for (const t of INBOX_TABS) expect(pageExists(t.href), t.href).toBe(true);
    for (const a of ["/settings", "/ads/health", "/ads/scale", "/tasks/new", "/tasks/team", "/tasks/:key", "/tasks/:key/edit", "/tasks/:key/runs/:id", "/tasks/results/:id", "/numbers/products/:code"]) expect(pageExists(a), a).toBe(true);
  });

  it("the screens of v5 are gone: no page is left under the old addresses", () => {
    for (const a of ["/work", "/work/today", "/work/tasks", "/work/reports", "/work/reports/:id", "/work/job/:key", "/work/job/:key/draw", "/ops", "/ops/confirm", "/ops/shipping", "/ops/stock", "/products", "/products/:code", "/ads/campaigns", "/p/:key"]) expect(pageExists(a), a).toBe(false);
  });

  it("finds the place of a path and of its children; the decisions list and the settings are no places; anything unknown is the home", () => {
    expect(placeOf("/").key).toBe("home");
    expect(placeOf("/ads").key).toBe("ads");
    expect(placeOf("/ads/health").key).toBe("ads");
    expect(placeOf("/tasks/day").key).toBe("tasks");
    expect(placeOf("/tasks/night/runs/r1").key).toBe("tasks");
    expect(placeOf("/numbers/products/TRF01").key).toBe("numbers");
    expect(placeOf("/numbers/stock").key).toBe("numbers");
    expect(placeOf("/inbox/later")).toMatchObject({ key: "inbox", title: "بانتظارك" });
    expect(placeOf("/settings/team").key).toBe("settings");
    expect(placeOf("/adsense").key).toBe("home");
    expect(placeOf("/nowhere").key).toBe("home");
    // an old address is no place: it is redirected before any page asks (the home is the fallback only)
    expect(placeOf("/work/job/x").key).toBe("home");
  });

  it("finds the tab of a path (the longest matching address), or none for a place without tabs", () => {
    expect(tabOf("/tasks")?.href).toBe("/tasks");
    expect(tabOf("/tasks/results/run%3Ax")?.href).toBe("/tasks/results");
    expect(tabOf("/tasks/night")?.href).toBe("/tasks");
    expect(tabOf("/tasks/team")?.href).toBe("/tasks");
    expect(tabOf("/numbers")?.href).toBe("/numbers");
    expect(tabOf("/numbers/products/TRF01")?.href).toBe("/numbers/products");
    expect(tabOf("/numbers/ops")?.href).toBe("/numbers/ops");
    expect(tabOf("/numbers/stock")?.href).toBe("/numbers/stock");
    expect(tabOf("/ads/videos")?.href).toBe("/ads/videos");
    expect(tabOf("/ads/health")?.href).toBe("/ads");
    expect(tabOf("/")).toBeNull();
    expect(tabOf("/settings")).toBeNull();
  });

  it("the places of a role's bar: «المهام» is the work place, «الأرقام» is the ads' numbers and the operations' together (a role that has either is given it)", () => {
    expect(placesFor(ROLE_PLACES.OWNER).map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(placesFor(ROLE_PLACES.MANAGER).map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(placesFor(ROLE_PLACES.ADS_MANAGER).map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(placesFor(ROLE_PLACES.OPS_MANAGER).map((p) => p.key)).toEqual(["home", "tasks", "numbers"]);
    expect(placesFor(ROLE_PLACES.TEAM_LEAD).map((p) => p.key)).toEqual(["tasks", "numbers"]);
    expect(placesFor(ROLE_PLACES.MEMBER).map((p) => p.key)).toEqual(["tasks"]);
    expect(placesFor(ROLE_PLACES.ANALYST).map((p) => p.key)).toEqual(["home", "tasks", "numbers", "ads"]);
    expect(placesFor(ROLE_PLACES.VIEWER).map((p) => p.key)).toEqual(["home", "numbers", "ads"]);
  });

  it("a tab is active on its own address only when it is the first of its place; the others also on their children; a ?view tab needs its query", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(tabIsActive("/ads", "/ads", q(""), true)).toBe(true);
    expect(tabIsActive("/ads", "/ads/videos", q(""), true)).toBe(false);
    expect(tabIsActive("/ads/videos", "/ads/videos", q(""))).toBe(true);
    expect(tabIsActive("/ads/videos?view=flow", "/ads/videos", q("view=flow"))).toBe(true);
    expect(tabIsActive("/ads/videos?view=flow", "/ads/videos", q(""))).toBe(false);
  });
});

describe("the old addresses: the table of docs/rebuild-v6/02-screens.md §8 (v6 · P8), all of them still open", () => {
  it("sends every old address of v5 to where its screen went", async () => {
    const list = await redirects();
    const table: [string, string][] = [
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
      ["/p/pg-1a2b3c", "/tasks/team"],
    ];
    for (const [from, to] of table) expect(target(list, from), from).toBe(to);
  });

  it("carries the query over (a day, a filter, a board, an old choice of period)", async () => {
    const list = await redirects();
    expect(target(list, "/work/today?day=2026-11-20")).toBe("/tasks/day?day=2026-11-20");
    expect(target(list, "/work/reports?domain=ops&day=2026-11-20")).toBe("/tasks/results?domain=ops&day=2026-11-20");
    expect(target(list, "/work/tasks?board=leak")).toBe("/tasks/team?board=leak");
    expect(target(list, "/products?d=yesterday")).toBe("/numbers/products?d=yesterday");
    expect(target(list, "/ads/campaigns?open=123")).toBe("/ads?open=123");
  });

  it("the longer address comes before the shorter one that would swallow it (`/draw` before the job)", async () => {
    const list = await redirects();
    const at = (s: string) => list.findIndex((r) => r.source === s);
    expect(at("/work/job/:key/draw")).toBeLessThan(at("/work/job/:key"));
    expect(at("/work/reports")).toBeGreaterThanOrEqual(0);
  });

  it("still sends the addresses of v3 and v4 to their new homes", async () => {
    const list = await redirects();
    const OLD = ["/workflow", "/workflow/:key", "/done", "/videos", "/decisions", "/creatives", "/reports", "/guide", "/setup"];
    for (const from of OLD) expect(list.some((r) => r.source === from), from).toBe(true);
    expect(list.find((r) => r.source === "/" && r.has?.[0]?.value === "numbers")?.destination).toBe("/numbers/products");
    expect(target(list, "/workflow/daily-check")).toBe("/tasks/daily-check");
    expect(list.find((r) => r.source === "/workflow")?.destination).toBe("/tasks/all");
    expect(list.find((r) => r.source === "/done" && !r.has)?.destination).toBe("/tasks/day");
    expect(list.find((r) => r.source === "/done" && r.has)?.destination).toBe("/tasks/results");
    expect(list.find((r) => r.source === "/reports" && !r.has)?.destination).toBe("/tasks/results");
    expect(list.find((r) => r.source === "/reports" && r.has?.length)?.destination).toBe("/ads/health");
  });

  it("«/tasks» is a real place (v6 · P3): it is no longer an old address that leads to «/inbox»", async () => {
    const list = await redirects();
    expect(list.some((r) => r.source === "/tasks" || r.source.startsWith("/tasks/"))).toBe(false);
    for (const a of ["/tasks", "/tasks/day", "/tasks/all", "/tasks/results", "/tasks/results/:id", "/tasks/team", "/tasks/:key", "/tasks/:key/runs/:id", "/tasks/:key/edit"]) expect(pageExists(a), a).toBe(true);
  });

  it("«/ads» is the campaigns table (v6 · P6): no rule sends it to a product page or to itself; the old tabs of the dashboard still lead somewhere", async () => {
    const list = await redirects();
    expect(list.some((r) => r.source === "/ads" && r.has?.some((h) => h.key === "product"))).toBe(false);
    expect(list.filter((r) => r.source === "/ads").map((r) => r.destination).sort()).toEqual(["/ads/health", "/ads/scale", "/ads/tests"]);
  });

  it("every destination is a page that exists, and no source is a page that exists (nothing is shadowed or forgotten)", async () => {
    for (const r of await redirects()) {
      const dest = r.destination.split(/[?#]/)[0]!;
      if (dest === "/settings") continue; // the settings page itself (its hash is read in the browser)
      expect(pageExists(dest) || dest === "/", `${r.source} → ${r.destination}`).toBe(true);
      if (!r.has) expect(pageExists(r.source), `${r.source} is still a page`).toBe(false);
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
});

describe("the guide of a page", () => {
  it("a key that is no place says the home's guide, and the places keep theirs", () => {
    expect(guideOf("pg-1a2b3c")).toBe(PAGE_GUIDE.home);
    expect(guideOf("ads")).toBe(PAGE_GUIDE.ads);
    expect(guideOf("tasks")).toBe(PAGE_GUIDE.tasks);
  });
});
