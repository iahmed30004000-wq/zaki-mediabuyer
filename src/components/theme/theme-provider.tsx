"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_THEME,
  THEME_COOKIE,
  THEME_LIST,
  isDarkTheme,
  prefCookieString,
  themeOf,
  type ThemeInfo,
  type ThemeKey,
} from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";

/**
 * The theme on the client. The SERVER already painted the right theme (the root layout reads the
 * `zaki_theme` cookie), so this provider never repaints on load: it only changes things when a
 * person picks something. A choice is applied at once (the attribute and the `dark` class on
 * <html>, the browser bar colour), remembered in its cookie for a year,.
 */

export interface ThemeContextValue {
  theme: ThemeKey;
  setTheme: (key: ThemeKey) => void;
  themes: readonly ThemeInfo[];
}

let saving: Promise<void> = Promise.resolve();

/**
 * The Media Buyer keeps the choice in the cookie only (one owner, few devices). When accounts land
 * (T1.2), a per-person save goes here.
 */
function save(_body: { theme: ThemeKey }): void {}

/** Resolves when every choice made so far has been sent (tests, and anything that must wait for it). */
export function savedPreferences(): Promise<void> {
  return saving;
}

function remember(name: string, value: string): void {
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = prefCookieString(name, value, secure);
}

/** Apply, remember and save a theme. Works without the provider (it only touches the page, the cookie and the API). */
export function chooseTheme(key: ThemeKey): void {
  const theme = themeOf(key);
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-theme", theme);
  html.classList.toggle("dark", isDarkTheme(theme));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColorOf(theme));
  remember(THEME_COOKIE, theme);
  save({ theme });
}

/**
 * Outside a provider (an isolated render) `useTheme()` still answers: the default theme, and
 * setters that apply and save without re-rendering anything.
 */
const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: chooseTheme,
  themes: THEME_LIST,
});

export function ThemeProvider({
  initialTheme,
  children,
}: {
  /** What the server painted (the cookie): anything unknown is the default. */
  initialTheme?: string;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<ThemeKey>(() => themeOf(initialTheme));

  // A server refresh brings the cookie's current value (another tab may have changed it): follow it.
  useEffect(() => setThemeState(themeOf(initialTheme)), [initialTheme]);

  const setTheme = useCallback((key: ThemeKey) => {
    const next = themeOf(key);
    setThemeState(next);
    chooseTheme(next);
  }, []);
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, themes: THEME_LIST }),
    [theme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current theme, and how to change it. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
