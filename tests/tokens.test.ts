import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

describe("the type scale (docs/rebuild-v6/03-look.md §3)", () => {
  const sizes = config.theme?.fontSize as Record<string, [string, string]>;

  it("replaces Tailwind's scale (it is in `theme`, not `theme.extend`), with the six sizes", () => {
    expect(config.theme?.extend && "fontSize" in config.theme.extend).toBe(false);
    expect(sizes.xs).toEqual(["12px", "18px"]);
    expect(sizes.sm).toEqual(["14px", "22px"]);
    expect(sizes.base).toEqual(["16px", "26px"]);
    expect(sizes.lg).toEqual(["20px", "28px"]);
    expect(sizes.xl).toEqual(["24px", "32px"]);
    expect(sizes["3xl"]).toEqual(["36px", "40px"]);
  });

  it("the six sizes are the only sizes that exist (2xl, 4xl and bigger are gone)", () => {
    expect(Object.keys(sizes).sort()).toEqual(["3xl", "base", "lg", "sm", "xl", "xs"]);
  });

  it("the radii: a key and a field 14, a card inside a panel 16, a panel 18 (the panel is the card token)", () => {
    const r = config.theme?.extend?.borderRadius as Record<string, string>;
    expect(r.lg).toBe("14px");
    expect(r.xl).toBe("16px");
    expect(r["2xl"]).toBe("18px");
    expect(r.card).toBe("var(--radius-card)");
  });

  it("no shadows: the card shadow is none, and the depth is the edge of a key", () => {
    const s = config.theme?.extend?.boxShadow as Record<string, string>;
    expect(s["card-hover"]).toBe("none");
    expect(s.key).toContain("var(--key-edge)");
    expect(s["key-down"]).toContain("var(--key-edge)");
  });

  it("the three motions of a live state exist: breathe 1.4s · blink 1.1s · chase 1s", () => {
    const a = config.theme?.extend?.animation as Record<string, string>;
    expect(a.breathe).toMatch(/^breathe 1\.4s/);
    expect(a.blink).toMatch(/^blink 1\.1s/);
    expect(a.chase).toMatch(/^chase 1s/);
  });
});
