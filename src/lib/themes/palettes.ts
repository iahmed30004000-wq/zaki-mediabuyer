/**
 * THE TWO PALETTES of the Media Buyer — every colour a screen may use, per theme, by ROLE and never by look (docs/rebuild/03-look.md §2).
 *
 * «فاتح» (`zaki`, the default): white paper, navy ink, a gold line. «داكن» (`zaki-dark`): the same on a night surface, where the gold
 * becomes the primary colour. `src/app/themes.css` is GENERATED from this file (`npm run themes:css`) and tests/themes-palettes.test.ts
 * runs every palette through the contrast gate. Meanings (ok / warn / danger) keep their roles in both; danger is for risk only.
 * The gold (`accent-2`) is a signal only — the line under a title, the active tab, a number, the focus ring — never a text colour on white.
 */
import { DEFAULT_THEME, type ThemeKey } from "./registry";
import { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA, hexToTriplet } from "./contrast";

export { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA };

/** The colour tokens, in the order they are written. Tailwind exposes each as `bg-x`, `text-x`, `border-x/40`, ... */
export const COLOR_TOKENS = [
  "surface",
  "surface-1",
  "surface-2",
  "border",
  "muted",
  "fg",
  "fg-muted",
  "accent",
  "accent-fg",
  "accent-2",
  "ok",
  "warn",
  "danger",
  "info",
  "ok-fg",
  "warn-fg",
  "danger-fg",
  "info-fg",
  "scrim",
  "cat-1",
  "cat-2",
  "cat-3",
  "cat-4",
  "cat-5",
  "cat-6",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** The categorical colours (labels, departments, chart series): 1 violet · 2 fuchsia · 3 rose · 4 teal · 5 lime · 6 indigo. */
export const CAT_TOKENS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;

/** The per-theme values that are not colours. */
export const STYLE_TOKENS = ["font-display", "radius-card", "shadow-card"] as const;
export type StyleToken = (typeof STYLE_TOKENS)[number];

export interface Palette {
  /** `#RRGGBB`, upper case. The stylesheet carries them as `R G B` triplets. */
  colors: Record<ColorToken, string>;
  style: Record<StyleToken, string>;
}

/** One face for everything: Cairo (loaded by the root layout through next/font as --font-cairo), IBM Plex Sans Arabic as the fallback. */
const CAIRO_STACK = 'var(--font-cairo, "Cairo"), var(--font-plex, "IBM Plex Sans Arabic"), "Segoe UI", Tahoma, sans-serif';

const STYLE: Palette["style"] = {
  "font-display": CAIRO_STACK,
  "radius-card": "14px",
  "shadow-card": "0 1px 2px rgb(16 24 40 / 0.04)",
};

export const PALETTES: Record<ThemeKey, Palette> = {
  /** «فاتح» — white paper (muted / ok / warn / three category colours are one step darker than the first sketch so every pair passes the contrast gate), navy ink, a gold line. The default. */
  zaki: {
    colors: {
      surface: "#F5F6F8",
      "surface-1": "#FFFFFF",
      "surface-2": "#EEF1F5",
      border: "#DCE1E9",
      muted: "#626C7B",
      fg: "#172033",
      "fg-muted": "#5A657A",
      accent: "#1B2A4A", // navy
      "accent-fg": "#FFFFFF",
      "accent-2": "#F2B705", // gold, as a signal only
      ok: "#167049",
      warn: "#975506",
      danger: "#B42318",
      info: "#1F4FBF",
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#0B1220",
      "cat-1": "#6C5A9E",
      "cat-2": "#9D3D8D",
      "cat-3": "#9A526B",
      "cat-4": "#0B6F7F",
      "cat-5": "#5B6B17",
      "cat-6": "#384DB8",
    },
    style: STYLE,
  },

  /** «داكن» — the same on a night surface; the gold is the primary colour. */
  "zaki-dark": {
    colors: {
      surface: "#0E1420",
      "surface-1": "#161E2E",
      "surface-2": "#1D2739",
      border: "#2A3650",
      muted: "#8896AD",
      fg: "#E9EDF5",
      "fg-muted": "#9BA7BD",
      accent: "#F2B705",
      "accent-fg": "#172033",
      "accent-2": "#F2B705",
      ok: "#4CC38A",
      warn: "#E8913A",
      danger: "#FF8A7A",
      info: "#8FB2FF",
      "ok-fg": "#10151F",
      "warn-fg": "#10151F",
      "danger-fg": "#10151F",
      "info-fg": "#10151F",
      scrim: "#05080F",
      "cat-1": "#B592F5",
      "cat-2": "#E07AD0",
      "cat-3": "#F38BAF",
      "cat-4": "#6FD0DD",
      "cat-5": "#B5DA6A",
      "cat-6": "#7DA2F2",
    },
    style: STYLE,
  },
};

/** One theme as CSS custom properties, in a fixed order: colours as `R G B` triplets, then the style values. */
export function themeVariables(key: ThemeKey): Array<[string, string]> {
  const { colors, style } = PALETTES[key];
  return [
    ...COLOR_TOKENS.map((token): [string, string] => [`--${token}`, hexToTriplet(colors[token])]),
    ...STYLE_TOKENS.map((token): [string, string] => [`--${token}`, style[token]]),
  ];
}

/** The browser chrome colour (`<meta name="theme-color">`) of a theme: its page colour. */
export function themeColorOf(key: ThemeKey): string {
  return PALETTES[key].colors.surface;
}

/** The default theme's palette — what an unthemed page (`:root`) shows. */
export const DEFAULT_PALETTE: Palette = PALETTES[DEFAULT_THEME];
