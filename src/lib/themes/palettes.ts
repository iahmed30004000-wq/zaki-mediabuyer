/**
 * THE TWO PALETTES of the Media Buyer — every colour a screen may use, per theme, by ROLE and never by look (docs/rebuild-v6/03-look.md §2).
 *
 * v6 «غرفة تحكم»: colour tells a STATE and nothing else (green done · blue running · orange needs you · red stopped). The actions are ink keys:
 * dark ink on the light page (`zaki`, the default), pale ink on the night page (`zaki-dark`). The names of the tokens never changed, so the
 * whole site re-colours by itself; `tape` (the groove a light strip runs in) and `key-edge` (the edge under a key) are the two new ones.
 * `src/app/themes.css` is GENERATED from this file (`npm run themes:css`) and tests/themes-palettes.test.ts runs every palette through the
 * contrast gate. Danger is for risk only. The gold (`accent-2`) is the logo and the job number only — never a text colour, never a state.
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
  "tape",
  "key-edge",
  "scrim",
  "cat-1",
  "cat-2",
  "cat-3",
  "cat-4",
  "cat-5",
  "cat-6",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** The categorical colours (labels, departments, chart series): 1 violet · 2 fuchsia · 3 rose · 4 teal · 5 lime · 6 indigo. They live inside charts only. */
export const CAT_TOKENS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;

/** The per-theme values that are not colours. */
export const STYLE_TOKENS = ["font-display", "radius-card", "shadow-card"] as const;
export type StyleToken = (typeof STYLE_TOKENS)[number];

export interface Palette {
  /** `#RRGGBB`, upper case. The stylesheet carries them as `R G B` triplets. */
  colors: Record<ColorToken, string>;
  style: Record<StyleToken, string>;
}

/** Two faces (03-look §3): Changa for titles, numbers and clocks (the root layout loads it through next/font as --font-changa), IBM Plex Sans Arabic (--font-plex) for all the text. */
const DISPLAY_STACK = 'var(--font-changa, "Changa"), var(--font-plex, "IBM Plex Sans Arabic"), "Segoe UI", Tahoma, sans-serif';

const STYLE: Palette["style"] = {
  "font-display": DISPLAY_STACK,
  "radius-card": "18px",
  // no shadows: depth is a line and the edge of a key (03-look §4)
  "shadow-card": "none",
};

export const PALETTES: Record<ThemeKey, Palette> = {
  /** «فاتح» — a cool grey-green page, white panels, ink keys. The default. */
  zaki: {
    colors: {
      surface: "#EEF1EF",
      "surface-1": "#FFFFFF",
      "surface-2": "#F5F7F6",
      border: "#D3DBD8",
      muted: "#C3CECA", // an unlit lamp, a locked control: a SHAPE, never a text colour
      fg: "#0F1E26",
      "fg-muted": "#56666F",
      accent: "#0F1E26", // ink
      "accent-fg": "#FFFFFF",
      "accent-2": "#F2B705", // gold: the logo and the job number only
      ok: "#0D714F", // one notch darker than the sketch (#0E7A55): the 10% status chip on the page must reach 4.5:1
      warn: "#905709", // sketch #A8650A, darkened for the same reason
      danger: "#B93124", // sketch #BF3325
      info: "#1564B6", // sketch #1565B8
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      tape: "#DFE6E3",
      "key-edge": "#000000",
      scrim: "#0B1220",
      "cat-1": "#6C5A9E",
      "cat-2": "#9D3D8D",
      "cat-3": "#944F67",
      "cat-4": "#0B6E7E",
      "cat-5": "#5B6B17",
      "cat-6": "#384DB8",
    },
    style: STYLE,
  },

  /** «داكن» — the same on a night page: pale ink keys, lamps that glow. */
  "zaki-dark": {
    colors: {
      surface: "#0B1318",
      "surface-1": "#131F27",
      "surface-2": "#182730",
      border: "#273944",
      muted: "#2C3F4A",
      fg: "#E8F0F2",
      "fg-muted": "#8FA4AF",
      accent: "#E8F0F2",
      "accent-fg": "#0B1318",
      "accent-2": "#F2B705",
      ok: "#35D49A",
      warn: "#FFC24D",
      danger: "#FF7466",
      info: "#5BB4FF",
      "ok-fg": "#0B1318",
      "warn-fg": "#0B1318",
      "danger-fg": "#0B1318",
      "info-fg": "#0B1318",
      tape: "#0A1116",
      "key-edge": "#5F7480",
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
