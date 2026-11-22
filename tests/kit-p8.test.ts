/**
 * The three small pieces v6 · P8 added to the kit so that no screen writes a raw `<button>`, `<table>` or radio by hand (`rawButtons` and `rawControls` are 0), and the two readers of an old
 * address' query. The ratchet says WHERE a raw element may live (here, in the kit); this says what the pieces do.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeDelta } from "@/components/ads/change-delta";
import { Radio } from "@/components/ui/radio";
import { Table } from "@/components/ui/table";
import { Tap } from "@/components/ui/tap";
import { oldReportAddress, productsWindow } from "@/core/legacy-links";

describe("Tap — a tap that is part of a row, never a key of its own", () => {
  it("is a real button that does not submit a form unless it is asked to", () => {
    expect(render(h(Tap, { "aria-label": "افتح" }, "x"))).toMatch(/^<button type="button"/);
    expect(render(h(Tap, { type: "submit" }, "x"))).toContain('type="submit"');
  });

  it("draws nothing of its own: the caller's classes, a pointer, and a grown touch area only when asked", () => {
    const plain = render(h(Tap, { className: "text-start" }, "x"));
    expect(plain).toContain("text-start");
    expect(plain).toContain("cursor-pointer");
    expect(plain).not.toContain("after:");
    expect(render(h(Tap, { grow: true }, "x"))).toContain("after:-inset-3");
  });

  it("carries the state and the name a screen reader needs", () => {
    const out = render(h(Tap, { "aria-expanded": true, "aria-label": "سكّر", disabled: true }, "x"));
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-label="سكّر"');
    expect(out).toContain("disabled");
  });
});

describe("Radio — one choice of a group", () => {
  it("with words: the whole row is the touch target and carries the 44px floor on a phone", () => {
    const out = render(h(Radio, { name: "scope", value: "all", label: "كل الحسابات", defaultChecked: true }));
    expect(out).toContain("<label");
    expect(out).toContain('type="radio"');
    expect(out).toContain('name="scope"');
    expect(out).toContain("كل الحسابات");
    expect(out).toContain("max-md:min-h-11");
  });

  it("bare: only the input, for a card that is itself the label", () => {
    const out = render(h(Radio, { bare: true, name: "theme", value: "dark", className: "sr-only", "aria-label": "داكن" }));
    expect(out).not.toContain("<label");
    expect(out).toContain('type="radio"');
    expect(out).toContain('class="sr-only"');
    expect(out).toContain('aria-label="داكن"');
  });
});

describe("Table — only the tag, in the kit", () => {
  it("always has a name for a screen reader and keeps the caller's classes", () => {
    const out = render(h(Table, { "aria-label": "الحملات", className: "min-w-max text-sm" }, h("tbody")));
    expect(out).toMatch(/^<table /);
    expect(out).toContain('aria-label="الحملات"');
    expect(out).toContain("min-w-max");
    expect(out).toContain("border-collapse");
  });
});

describe("ChangeDelta — the small arrow of the campaigns table", () => {
  const say = (now: number | null, base: number | null, good: "up" | "down" | "none") => render(h(ChangeDelta, { now, base, good }));

  it("is a dash when there is nothing to compare with", () => {
    expect(say(5, null, "up")).toContain("—");
    expect(say(null, 5, "up")).toContain("—");
  });

  it("green when the way is good for THIS number, red when it is bad, grey for spend", () => {
    expect(say(130, 100, "up")).toContain("text-ok"); // more orders
    expect(say(130, 100, "down")).toContain("text-danger"); // a dearer order
    expect(say(80, 100, "down")).toContain("text-ok");
    expect(say(130, 100, "none")).toContain("text-fg-muted");
    expect(say(130, 100, "up")).toContain("30%");
  });

  it("never a sentence at twelve pixels", () => {
    expect(say(130, 100, "up")).not.toContain("text-xs");
  });
});

describe("what an old address carried in its query, read for the new screens", () => {
  it("the comparison window of the products: the new `p` wins, the old `d` is read, anything else is no choice", () => {
    expect(productsWindow("7", undefined)).toBe("7");
    expect(productsWindow("7", "yesterday")).toBe("7");
    expect(productsWindow(undefined, "yesterday")).toBe("1");
    expect(productsWindow(undefined, "custom")).toBe("custom");
    expect(productsWindow(undefined, "today")).toBeUndefined();
    expect(productsWindow(undefined, "7d")).toBeUndefined();
    expect(productsWindow(undefined, undefined)).toBeUndefined();
  });

  it("an old report address `?r=<id>` is the report's own page; an empty one is no report", () => {
    expect(oldReportAddress("42")).toBe("/tasks/results/report%3A42");
    expect(oldReportAddress(" abc/def ")).toBe("/tasks/results/report%3Aabc%2Fdef");
    expect(oldReportAddress("")).toBeNull();
    expect(oldReportAddress("   ")).toBeNull();
    expect(oldReportAddress(undefined)).toBeNull();
  });
});
