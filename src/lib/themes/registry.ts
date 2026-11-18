/**
 * The two themes of the Media Buyer: «فاتح» (`zaki`, the default) and «داكن» (`zaki-dark`). A pure module (no React, no server imports, no `@/` imports — the
 * Tailwind config reaches it through palettes.ts): the root layout, the client provider, the
 * decoration engine and the tests all read the theme list from here.
 *
 * A theme is the `data-theme` attribute on <html>; the dark ones also carry the `dark` class so
 * Tailwind's `dark:` variants keep working. The chosen key lives in the cookie `mb_theme` (so the
 * server paints the right theme with no flash) and in `User.theme` (so it follows the person).
 * The colours are in palettes.ts; the stylesheet they become is src/app/themes.css (generated).
 */

export const THEME_KEYS = ["zaki", "zaki-dark"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** «فاتح»: the default for everybody who has not chosen. */
export const DEFAULT_THEME: ThemeKey = "zaki";

export interface ThemeInfo {
  key: ThemeKey;
  /** Dark themes also get the `dark` class. */
  dark: boolean;
}

export const THEMES: Record<ThemeKey, ThemeInfo> = {
  zaki: { key: "zaki", dark: false },
  "zaki-dark": { key: "zaki-dark", dark: true },
};

/** The themes in the order the picker shows them. */
export const THEME_LIST: readonly ThemeInfo[] = THEME_KEYS.map((key) => THEMES[key]);

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

/**
 * Whatever was stored (`User.theme` used to hold "system" for the old light/dark/system toggle, a
 * cookie can be edited) becomes a real theme: anything that is not one of the two (the four old theme names included) is the default.
 */
export function themeOf(value: unknown): ThemeKey {
  return isThemeKey(value) ? value : DEFAULT_THEME;
}

export function isDarkTheme(key: ThemeKey): boolean {
  return THEMES[key].dark;
}

/** The dictionary keys of a theme's Arabic name and one-line mood (src/lib/i18n/ar.theme.json). */
export function themeLabelKey(key: ThemeKey): string {
  return `theme.${key}`;
}
export function themeMoodKey(key: ThemeKey): string {
  return `theme.${key}.mood`;
}

/**
 * The cookie that carries the theme to the server, so the first paint is already right. Not
 * httpOnly: the client provider writes it the moment somebody picks a theme, and POST /api/me/theme
 * sets it again from the server (a server-set cookie keeps its full year on Safari, which caps the
 * ones a script writes).
 */
export const THEME_COOKIE = "mb_theme";

/** What <html> carries for a theme (the root layout and the client provider agree through this). */
export function rootThemeAttributes(theme: ThemeKey): { "data-theme": ThemeKey; dark: boolean } {
  return { "data-theme": theme, dark: isDarkTheme(theme) };
}

/** Both preference cookies live a year. */
export const PREF_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** The options of a preference cookie set by the server (`response.cookies.set(name, value, options)`). */
export function prefCookieOptions(secure: boolean): {
  path: "/";
  maxAge: number;
  sameSite: "lax";
  httpOnly: false;
  secure: boolean;
} {
  return { path: "/", maxAge: PREF_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false, secure };
}

/** The same cookie as the browser writes it (`document.cookie = ...`). Values are plain keys: nothing to encode. */
export function prefCookieString(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
