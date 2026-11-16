import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

describe("the type scale (docs/rebuild/03-look.md §3)", () => {
  const sizes = config.theme?.fontSize as Record<string, [string, string]>;

  it("replaces Tailwind's scale (it is in `theme`, not `theme.extend`), with the five sizes", () => {
    expect(config.theme?.extend && "fontSize" in config.theme.extend).toBe(false);
    expect(sizes.xs).toEqual(["12px", "18px"]);
    expect(sizes.sm).toEqual(["14px", "22px"]);
    expect(sizes.base).toEqual(["16px", "26px"]);
    expect(sizes.xl).toEqual(["20px", "28px"]);
    expect(sizes["3xl"]).toEqual(["28px", "36px"]);
  });

  it("the three old names are synonyms of the nearest size until P12 removes them — and nothing else exists", () => {
    expect(sizes.lg).toEqual(sizes.base);
    expect(sizes["2xl"]).toEqual(sizes.xl);
    expect(sizes["4xl"]).toEqual(sizes["3xl"]);
    expect(Object.keys(sizes).sort()).toEqual(["2xl", "3xl", "4xl", "base", "lg", "sm", "xl", "xs"]);
  });

  it("the control radius is 10px", () => {
    expect((config.theme?.extend?.borderRadius as Record<string, string>).lg).toBe("10px");
  });
});
