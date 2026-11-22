import { describe, expect, it } from "vitest";
import { isEmptyReport } from "@/core/report-empty";
import { costPerConfirmedText, spendText } from "@/core/morning-text";

/** U-07 · R-15 — a report with nothing in it is not sent and not listed; a missing figure is «—»; the cost of a confirmed order of a day that has not matured is «— (مبدئي)». */
describe("the code's three reports (plan · attribution · analysis)", () => {
  it("empty lists and null figures are empty — the words of the code («good», «by») are not content", () => {
    expect(isEmptyReport("plan", JSON.stringify({ total_usd: 0, daily_allocation: [], risks: [], creative_needs: [], by: "code" }))).toBe(true);
    expect(isEmptyReport("attribution", JSON.stringify({ gaps: [], attribution_health: "good", attributed_pct: null, capi_accepted_pct: null, capi_issues: [], notify: [] }))).toBe(true);
    expect(isEmptyReport("analysis", JSON.stringify({ products: [], top_decisions: [], by: "code" }))).toBe(true);
  });

  it("anything real in them makes them worth keeping", () => {
    expect(isEmptyReport("plan", JSON.stringify({ total_usd: 40, daily_allocation: [{ product_code: "X", bucket: "scale", usd: 40 }], by: "code" }))).toBe(false);
    expect(isEmptyReport("attribution", JSON.stringify({ gaps: [], attributed_pct: 62.5, capi_accepted_pct: null, capi_issues: [] }))).toBe(false);
    expect(isEmptyReport("analysis", JSON.stringify({ products: [{ code: "X" }] }))).toBe(false);
  });

  it("a text that is not JSON is never called empty, and a blank one always is", () => {
    expect(isEmptyReport("plan", "not json")).toBe(false);
    expect(isEmptyReport("plan", "  ")).toBe(true);
  });
});

describe("the morning report", () => {
  const empty = ["تقرير الإعلانات — الأحد", "(الإسناد: 7d | الرقم مبدئي | الحقيقة على الطلبات الناضجة)", "", "1) الحساب: صرف — · طلبات 0 · مؤكد 0 (—) · تكلفة المؤكد — [حقيقي]", "2) لكل منتج:", "3) أفضل 3 إعلانات:", "   — بيانات غير كافية", "8) صحة البيانات: فرق ميتا/حقيقي —% · صرف يتيم — · آخر سحب ميتا — · آخر مزامنة OMS —"].join("\n");
  const old = empty.replace("صرف —", "صرف 0.00$");
  const real = ["تقرير الإعلانات — الأحد", "", "1) الحساب: صرف 120.00$ · طلبات 22 · مؤكد 12 (60.0%) · تكلفة المؤكد 10.00$ [حقيقي]", "2) لكل منتج:", "   كمأة: صرف 120.00$ · تكلفة المؤكد 10.00$ (السقف 11.00$)", "3) أفضل 3 إعلانات:", "   — بيانات غير كافية"].join("\n");

  it("no spend, no orders, no product line: empty (and the old zero-style one too)", () => {
    expect(isEmptyReport("morning", empty)).toBe(true);
    expect(isEmptyReport("morning", old)).toBe(true);
  });

  it("a day with spend and orders is a real report", () => {
    expect(isEmptyReport("morning", real)).toBe(false);
  });

  it("a day with orders but no spend row is still a real report (the orders are real)", () => {
    expect(isEmptyReport("morning", real.replace("صرف 120.00$ · طلبات 22", "صرف — · طلبات 22"))).toBe(false);
  });

  it("weekly and monthly are never called empty here", () => {
    expect(isEmptyReport("weekly", "x")).toBe(false);
  });
});

describe("the figures of the morning report", () => {
  it("no spend is «—», never 0.00$", () => {
    expect(spendText(null)).toBe("—");
    expect(spendText(0)).toBe("—");
    expect(spendText(120, false)).toBe("—");
    expect(spendText(120)).toBe("120.00$");
  });

  it("cost per confirmed: a number only when every order of the day matured", () => {
    expect(costPerConfirmedText({ spend: 120, confirmed: 12, orders: 22, matureOrders: 22 })).toBe("10.00$");
    expect(costPerConfirmedText({ spend: 120, confirmed: 1, orders: 22, matureOrders: 5 })).toBe("— (مبدئي)");
    expect(costPerConfirmedText({ spend: 120, confirmed: 0, orders: 22, matureOrders: 22 })).toBe("—");
    expect(costPerConfirmedText({ spend: 0, confirmed: 0, orders: 0, matureOrders: 0 })).toBe("—");
    expect(costPerConfirmedText({ spend: null, confirmed: 3, orders: 3, matureOrders: 3 })).toBe("—");
  });
});
