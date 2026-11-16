import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, PALETTES } from "@/lib/themes/palettes";
import { checkPalette } from "@/lib/themes/contrast";
import { DEFAULT_THEME, THEME_KEYS, themeOf } from "@/lib/themes/registry";
import { renderThemesCss } from "@/lib/themes/css";
import { readFileSync } from "node:fs";

describe("the two Media Buyer themes", () => {
  it("are «فاتح» (default) and «داكن»", () => {
    expect([...THEME_KEYS]).toEqual(["zaki", "zaki-dark"]);
    expect(DEFAULT_THEME).toBe("zaki");
  });

  it("an old theme name (a cookie, a saved choice) falls back to the default", () => {
    for (const old of ["iznik", "observatory", "sunset-city", "wudooh", "system", undefined, 42]) expect(themeOf(old)).toBe("zaki");
    expect(themeOf("zaki-dark")).toBe("zaki-dark");
  });

  it("the page colours are the ones the look spec writes down", () => {
    expect(PALETTES.zaki.colors).toMatchObject({ surface: "#F5F6F8", "surface-1": "#FFFFFF", accent: "#1B2A4A", "accent-2": "#F2B705", danger: "#B42318" });
    expect(PALETTES["zaki-dark"].colors).toMatchObject({ surface: "#0E1420", "surface-1": "#161E2E", accent: "#F2B705", "accent-fg": "#172033" });
  });

  for (const key of THEME_KEYS) {
    it(`${key}: every token is set and every pair a screen draws is readable`, () => {
      expect(Object.keys(PALETTES[key].colors).sort()).toEqual([...COLOR_TOKENS].sort());
      expect(checkPalette(PALETTES[key].colors)).toEqual([]);
    });
  }

  it("themes.css is up to date with the palettes (npm run themes:css)", () => {
    expect(readFileSync("src/app/themes.css", "utf8").replace(/\r\n/g, "\n")).toBe(renderThemesCss());
  });
});
