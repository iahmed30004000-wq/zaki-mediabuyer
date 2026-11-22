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
    expect(PALETTES.zaki.colors).toMatchObject({
      surface: "#EEF1EF",
      "surface-1": "#FFFFFF",
      accent: "#0F1E26",
      "accent-2": "#F2B705",
      danger: "#B93124",
      tape: "#DFE6E3",
      "key-edge": "#000000",
    });
    expect(PALETTES["zaki-dark"].colors).toMatchObject({
      surface: "#0B1318",
      "surface-1": "#131F27",
      accent: "#E8F0F2",
      "accent-fg": "#0B1318",
      "accent-2": "#F2B705",
      tape: "#0A1116",
      "key-edge": "#5F7480",
    });
  });

  it("the gold stays the same in both themes and is not the action colour (colour = state; the keys are ink)", () => {
    expect(PALETTES.zaki.colors["accent-2"]).toBe(PALETTES["zaki-dark"].colors["accent-2"]);
    for (const key of THEME_KEYS) expect(PALETTES[key].colors.accent).not.toBe(PALETTES[key].colors["accent-2"]);
  });

  it("the style values: Changa for display, 18px panels, no shadows", () => {
    for (const key of THEME_KEYS) {
      expect(PALETTES[key].style["font-display"]).toContain("Changa");
      expect(PALETTES[key].style["radius-card"]).toBe("18px");
      expect(PALETTES[key].style["shadow-card"]).toBe("none");
    }
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
