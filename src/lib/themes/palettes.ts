/**
 * THE FOUR PALETTES of the Media Buyer — every colour a screen may use, per theme, by ROLE and never by look.
 *
 * New designs for this system (the token engine came from Zaki Workspace): «إزنيق» (Iznik tiles, the default),
 * «المرصد» (astrolabe at night), «مدينة الغروب» (a city at golden hour, real photographs) and «وُضوح» (the
 * spec's own identity, section 18.1). `src/app/themes.css` is GENERATED from this file
 * (`npm run themes:css`) and tests/themes-palettes.test.ts runs every palette through the contrast gate.
 * Meanings (ok / warn / danger) keep their roles in every theme; danger is for risk only (spec 18.1).
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

/**
 * Titles. IBM Plex Sans Arabic is the body face of every theme; Reem Kufi (public/fonts, SIL OFL,
 * loaded by the root layout through next/font/local with preload off, so only an Islamic theme
 * ever downloads it) is the face of the Islamic themes' h1-h3. Each `var()` carries a fallback so a
 * page rendered without the font classes still gets a valid stack.
 */
const PLEX_STACK = 'var(--font-plex, "IBM Plex Sans Arabic"), "Segoe UI", Tahoma, sans-serif';
const KUFI_STACK = `var(--font-reem, "Reem Kufi"), ${PLEX_STACK}`;

export const PALETTES: Record<ThemeKey, Palette> = {
  /** «إزنيق» — Iznik tiles: ivory glaze, cobalt blue, turquoise. Light. The default. */
  iznik: {
    colors: {
      surface: "#F7F4EC",
      "surface-1": "#FFFFFF",
      "surface-2": "#EEF1F5",
      border: "#D3DAE3",
      muted: "#56657E",
      fg: "#14213D",
      "fg-muted": "#3E4F6B",
      accent: "#1D4AA0", // cobalt
      "accent-fg": "#FFFFFF",
      "accent-2": "#138486", // turquoise glaze, as a shape only
      ok: "#17703A",
      warn: "#8E5B06",
      danger: "#B42318",
      info: "#0A6C8C",
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#0B1428",
      "cat-1": "#6A35B0",
      "cat-2": "#A3288F",
      "cat-3": "#B02A55",
      "cat-4": "#0B6F7C",
      "cat-5": "#5A6B0A",
      "cat-6": "#3236A8",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "0.875rem",
      "shadow-card": "0 1px 2px rgb(20 33 61 / 0.06), 0 2px 6px rgb(20 33 61 / 0.06)",
    },
  },

  /** «المرصد» — an astrolabe at night: indigo-black sky and brass. Dark. */
  observatory: {
    colors: {
      surface: "#0B1022",
      "surface-1": "#121A33",
      "surface-2": "#1C2645",
      border: "#34406A",
      muted: "#A49C8C",
      fg: "#EDEAE2",
      "fg-muted": "#C2B9A6",
      accent: "#D9A55B", // brass
      "accent-fg": "#120C04",
      "accent-2": "#6FC3D6", // lapis-sky
      ok: "#3FD07F",
      warn: "#F27A3D",
      danger: "#F7718A",
      info: "#7DA9F0",
      "ok-fg": "#0B1022",
      "warn-fg": "#0B1022",
      "danger-fg": "#0B1022",
      "info-fg": "#0B1022",
      scrim: "#04070F",
      "cat-1": "#B592F5",
      "cat-2": "#E07AD0",
      "cat-3": "#F38BAF",
      "cat-4": "#6FD0DD",
      "cat-5": "#B5DA6A",
      "cat-6": "#7DA2F2",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "0.875rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.55), 0 2px 8px rgb(0 0 0 / 0.30)",
    },
  },

  /** «مدينة الغروب» — a city at golden hour: dusk purple, sunset orange, magenta. Dark. Original work, no game reference. */
  "sunset-city": {
    colors: {
      surface: "#160F1E",
      "surface-1": "#20172B",
      "surface-2": "#2C2039",
      border: "#4A3A5E",
      muted: "#B9A296",
      fg: "#FBF1E6",
      "fg-muted": "#DCC5B4",
      accent: "#FF9A3C", // sunset orange
      "accent-fg": "#1A0F05",
      "accent-2": "#FF5FA8", // magenta sky
      ok: "#5FD38D",
      warn: "#FFD15C",
      danger: "#FF6B6B",
      info: "#7FB8FF",
      "ok-fg": "#160F1E",
      "warn-fg": "#160F1E",
      "danger-fg": "#160F1E",
      "info-fg": "#160F1E",
      scrim: "#0A0610",
      "cat-1": "#C9A0FA",
      "cat-2": "#F27FE0",
      "cat-3": "#FF7FA8",
      "cat-4": "#5FD6D6",
      "cat-5": "#C3E06A",
      "cat-6": "#8A9BFF",
    },
    style: {
      "font-display": PLEX_STACK,
      "radius-card": "1rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.6), 0 4px 14px rgb(0 0 0 / 0.35)",
    },
  },

  /** «وُضوح» — the spec's own identity (section 18.1): navy, petrol, cyan on white. Light. */
  wudooh: {
    colors: {
      surface: "#F4F8FA",
      "surface-1": "#FFFFFF",
      "surface-2": "#E9F0F3",
      border: "#D5E1E6",
      muted: "#5E6B72",
      fg: "#1F2933",
      "fg-muted": "#44535C",
      accent: "#1A6382", // petrol
      "accent-fg": "#FFFFFF",
      "accent-2": "#2A98AE", // cyan, a shade darker for 3:1
      ok: "#1A7043",
      warn: "#7A6000",
      danger: "#C00000",
      info: "#2B57C4",
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#071A2B",
      "cat-1": "#705EA2",
      "cat-2": "#9D3D8D",
      "cat-3": "#9A526B",
      "cat-4": "#0C7383",
      "cat-5": "#5F7019",
      "cat-6": "#384DB8",
    },
    style: {
      "font-display": PLEX_STACK,
      "radius-card": "0.75rem",
      "shadow-card": "0 1px 2px rgb(12 50 82 / 0.06), 0 1px 3px rgb(12 50 82 / 0.08)",
    },
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
