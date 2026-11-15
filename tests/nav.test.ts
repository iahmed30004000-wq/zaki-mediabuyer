import { describe, expect, it } from "vitest";
import { PAGE_GUIDE } from "@/lib/guide";
import { PLACES, placeOf } from "@/lib/nav";

type Redirect = { source: string; destination: string; permanent: boolean; has?: { type: string; key: string; value: string }[] };

/** next.config.mjs has no types (allowJs is off), so it is loaded by address. */
async function redirects(): Promise<Redirect[]> {
  const url = new URL("../next.config.mjs", import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  return mod.default.redirects();
}

describe("the map (v3 · A)", () => {
  it("has at most seven places, in the owner's order", () => {
    expect(PLACES.length).toBeLessThanOrEqual(7);
    expect(PLACES.map((p) => p.label)).toEqual(["اليوم", "الإعلانات", "الفيديوهات", "المهام", "الورك فلو", "الإنجاز", "الإعدادات"]);
  });

  it("gives each place its own key and address, and a guide page", () => {
    expect(new Set(PLACES.map((p) => p.key)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(PLACES.length);
    for (const p of PLACES) expect(PAGE_GUIDE[p.key].what.length).toBeGreaterThan(10);
  });

  it("puts four places on the phone's bottom bar (the rest are under «المزيد»)", () => {
    expect(PLACES.filter((p) => p.mobile).map((p) => p.key)).toEqual(["today", "ads", "tasks", "workflow"]);
  });

  it("finds the place of a path and of its children; anything unknown is «اليوم»", () => {
    expect(placeOf("/").key).toBe("today");
    expect(placeOf("/ads").key).toBe("ads");
    expect(placeOf("/ads/anything").key).toBe("ads");
    expect(placeOf("/tasks").key).toBe("tasks");
    expect(placeOf("/adsense").key).toBe("today");
    expect(placeOf("/nowhere").key).toBe("today");
  });
});

describe("the old addresses (v3 · A)", () => {
  const OLD = ["/decisions", "/creatives", "/reports", "/guide", "/setup"];

  it("every old address still opens somewhere", async () => {
    const list = await redirects();
    for (const from of OLD) expect(list.some((r) => r.source === from), from).toBe(true);
  });

  it("every destination is one of the seven places", async () => {
    const hrefs = PLACES.map((p) => p.href);
    for (const r of await redirects()) {
      const path = r.destination.split(/[?#]/)[0]!;
      expect(hrefs, `${r.source} → ${r.destination}`).toContain(path);
    }
  });

  it("is never permanent (the owner may still move things)", async () => {
    for (const r of await redirects()) expect(r.permanent).toBe(false);
  });

  it("sends the old data / safety tabs of the reports to «الصحة» inside الإعلانات, and the rest to الإنجاز", async () => {
    const list = await redirects();
    const tabbed = list.find((r) => r.source === "/reports" && r.has?.length);
    expect(tabbed?.destination).toBe("/ads");
    expect(tabbed?.has?.[0]).toMatchObject({ type: "query", key: "tab", value: "(safety|data)" });
    // the conditional one must come first, or the plain one would swallow it
    expect(list.findIndex((r) => r.source === "/reports" && r.has?.length)).toBeLessThan(list.findIndex((r) => r.source === "/reports" && !r.has));
    expect(list.find((r) => r.source === "/reports" && !r.has)?.destination).toBe("/done?tab=reports");
  });
});
