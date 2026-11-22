/**
 * WHO OPENS «الأرقام» (v6 · P6): the summary is for a role that has the ads' numbers or the operations' (it holds both families); the products are the ads', the confirmation, shipping and stock screens are
 * the operations'. A role is never shown a tab that answers «هالصفحة مش من صلاحياتك», and the old addresses keep their old rules.
 */
import { describe, expect, it } from "vitest";
import { ROLES, canOpenPath } from "@/core/roles";
import { homePlan } from "@/core/home";
import { compareForRole, seesAdsNumbers } from "@/core/numbers-scope";

const opens = (path: string) => ROLES.filter((r) => canOpenPath(r, path));

describe("canOpenPath — the new addresses", () => {
  it("the summary: every role that has the ads place or the operations place", () => {
    expect(opens("/numbers")).toEqual(["OWNER", "MANAGER", "ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "ANALYST", "VIEWER"]);
    expect(canOpenPath("MEMBER", "/numbers")).toBe(false);
  });

  it("the products and a product: the ads' roles, like the old «المنتجات»", () => {
    for (const p of ["/numbers/products", "/numbers/products/TRF01"]) expect(opens(p), p).toEqual(opens("/products"));
    expect(opens("/numbers/products")).toEqual(["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST", "VIEWER"]);
  });

  it("confirmation, shipping and stock: the operations' roles, like the old «التشغيل»", () => {
    for (const p of ["/numbers/ops", "/numbers/stock"]) expect(opens(p), p).toEqual(opens("/ops"));
    expect(opens("/numbers/ops")).toEqual(["OWNER", "MANAGER", "OPS_MANAGER", "TEAM_LEAD", "VIEWER"]);
  });

  it("an address that only starts like one is not one of them", () => {
    expect(canOpenPath("MEMBER", "/numbersx")).toBe(true); // matches no rule: open to any signed-in person (the login door), as any unknown address
    expect(canOpenPath("MEMBER", "/numbers/products")).toBe(false);
  });

  it("the old addresses keep their rules", () => {
    expect(canOpenPath("ANALYST", "/ops/stock")).toBe(false);
    expect(canOpenPath("ADS_MANAGER", "/products")).toBe(true);
    expect(canOpenPath("ADS_MANAGER", "/ads")).toBe(true);
  });

  it("the home's «كل الأرقام» leads to the summary for every role that has it", () => {
    for (const r of ROLES.filter((x) => canOpenPath(x, "/numbers"))) expect(homePlan(r).numbersHref, r).toBe("/numbers");
  });
});

describe("the summary's ads side is for the roles that have the ads' numbers", () => {
  const full = {
    tiles: [
      { key: "realCost", now: 4.2 as number | null },
      { key: "orders", now: 30 as number | null },
      { key: "confirmRate", now: 61 as number | null },
      { key: "spend", now: 120 as number | null },
    ],
    readiness: [{ key: "spend" }, { key: "orders" }, { key: "breakeven" }, { key: "names" }, { key: "stock" }],
    products: [{ code: "A1", cost: 3.1 }],
    series: { realCost: [1, 2], spend: [5, 6] } as Record<string, unknown>,
    target: 5 as number | null,
    breakeven: 7 as number | null,
    allMissing: false,
  };

  it("only a role with ads.view sees the ads' side", () => {
    expect(ROLES.filter(seesAdsNumbers)).toEqual(["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST", "VIEWER"]);
  });

  it("an ads role gets the data whole", () => {
    expect(compareForRole(full, "ADS_MANAGER")).toBe(full);
  });

  it("the operations' roles get no spend, no cost, no products, no chart lines and no target", () => {
    for (const r of ["TEAM_LEAD", "OPS_MANAGER"] as const) {
      const c = compareForRole(full, r);
      expect(c.tiles.map((t) => t.key), r).toEqual(["orders", "confirmRate"]);
      expect(c.readiness.map((x) => x.key), r).toEqual(["orders", "stock"]);
      expect(c.products, r).toEqual([]);
      expect(c.series, r).toEqual({});
      expect(c.target, r).toBeNull();
      expect(c.breakeven, r).toBeNull();
      expect(JSON.stringify(c), r).not.toMatch(/"spend"|realCost|"A1"/);
    }
  });

  it("when the orders have no number the operations' roles see the readiness of the orders, not four ads' tiles", () => {
    const c = compareForRole({ ...full, tiles: full.tiles.map((t) => ({ ...t, now: t.key === "orders" || t.key === "confirmRate" ? null : t.now })) }, "OPS_MANAGER");
    expect(c.allMissing).toBe(true);
  });
});
