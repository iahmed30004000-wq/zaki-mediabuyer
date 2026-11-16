import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVANCED_PAGES, SETTINGS_HASH, SETTINGS_PAGES, settingsFromHash, settingsParent, settingsTitle } from "@/lib/settings-nav";

const pageFile = (href: string) => join(process.cwd(), "src", "app", "(app)", ...href.split("/").filter(Boolean), "page.tsx");

describe("the settings are a list of six pages and five more under «متقدّم» (02 §3.7)", () => {
  it("six pages, in the owner's order", () => {
    expect(SETTINGS_PAGES.map((p) => p.href)).toEqual(["/settings/connections", "/settings/team", "/settings/rules", "/settings/products", "/settings/look", "/settings/advanced"]);
    expect(ADVANCED_PAGES.map((p) => p.href)).toEqual(["/settings/advanced/customize", "/settings/advanced/automation", "/settings/advanced/manual", "/settings/advanced/log", "/settings/advanced/guide"]);
  });
  it("every page of the list exists as a screen, and so does the list itself", () => {
    for (const p of [...SETTINGS_PAGES, ...ADVANCED_PAGES, { href: "/settings" }, { href: "/settings/advanced" }]) expect(existsSync(pageFile(p.href)), p.href).toBe(true);
  });
  it("two levels at most: a page, then its parent; the list has none", () => {
    expect(settingsParent("/settings")).toBeNull();
    expect(settingsParent("/settings/team")).toEqual({ href: "/settings", title: "الإعدادات" });
    expect(settingsParent("/settings/advanced/log")).toEqual({ href: "/settings/advanced", title: "متقدّم" });
    expect(settingsTitle("/settings/advanced/automation")).toBe("الأتمتة والجدولة");
    expect(settingsTitle("/settings")).toBeNull();
  });
});

describe("the old anchors of the long page still arrive", () => {
  it("each old #anchor lands on a real page", () => {
    const real = new Set([...SETTINGS_PAGES, ...ADVANCED_PAGES].map((p) => p.href));
    for (const [hash, dest] of Object.entries(SETTINGS_HASH)) expect(real.has(dest), `#${hash} → ${dest}`).toBe(true);
  });
  it("the ones the spec names", () => {
    expect(settingsFromHash("#setup")).toBe("/settings/connections");
    expect(settingsFromHash("readiness")).toBe("/settings/connections");
    expect(settingsFromHash("#campaign-rules")).toBe("/settings/rules");
    expect(settingsFromHash("#mode")).toBe("/settings/rules");
    expect(settingsFromHash("#products")).toBe("/settings/products");
    expect(settingsFromHash("#agents")).toBe("/settings/team");
    expect(settingsFromHash("#team")).toBe("/settings/team");
    expect(settingsFromHash("#import")).toBe("/settings/advanced/manual");
    expect(settingsFromHash("#guide")).toBe("/settings/advanced/guide");
    expect(settingsFromHash("#look")).toBe("/settings/look");
    expect(settingsFromHash("#nothing")).toBeNull();
    expect(settingsFromHash("")).toBeNull();
  });
  it("/guide and /setup go straight to the new pages (no anchor to lose)", async () => {
    const mod = (await import(new URL("../next.config.mjs", import.meta.url).href)) as { LEGACY_REDIRECTS: { source: string; destination: string }[] };
    expect(mod.LEGACY_REDIRECTS.find((r) => r.source === "/guide")?.destination).toBe("/settings/advanced/guide");
    expect(mod.LEGACY_REDIRECTS.find((r) => r.source === "/setup")?.destination).toBe("/settings/connections");
  });
});
