import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, PALETTES } from "@/lib/themes/palettes";
import { checkPalette } from "@/lib/themes/contrast";
import { DEFAULT_THEME, THEME_KEYS } from "@/lib/themes/registry";
import { renderThemesCss } from "@/lib/themes/css";
import { readFileSync } from "node:fs";

describe("the four Media Buyer themes", () => {
  it("are «إزنيق» (default), «المرصد», «مدينة الغروب» and «وُضوح»", () => {
    expect([...THEME_KEYS]).toEqual(["iznik", "observatory", "sunset-city", "wudooh"]);
    expect(DEFAULT_THEME).toBe("iznik");
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
