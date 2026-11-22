/**
 * WHO OPENS «الأرقام» (v6 · P6): the summary is for a role that has the ads' numbers or the operations' (it holds both families); the products are the ads', the confirmation, shipping and stock screens are
 * the operations'. A role is never shown a tab that answers «هالصفحة مش من صلاحياتك», and the old addresses keep their old rules.
 */
import { describe, expect, it } from "vitest";
import { ROLES, canOpenPath } from "@/core/roles";
import { homePlan } from "@/core/home";

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
