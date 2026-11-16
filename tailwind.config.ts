import type { Config } from "tailwindcss";
import { COLOR_TOKENS } from "./src/lib/themes/palettes";

/**
 * Every colour is a theme token (src/lib/themes/palettes.ts -> src/app/themes.css), exposed as
 * `rgb(var(--x) / <alpha-value>)` so opacity modifiers work: `bg-ok/10`, `border-warn/40`,
 * `text-cat-3`. Write new code with these semantic names, never with a palette colour
 * (`text-red-500`): a token follows the theme, a palette colour does not.
 */
const themeColors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, `rgb(var(--${token}) / <alpha-value>)`]));

const config: Config = {
  // the dark themes also carry the `dark` class on <html>, so `dark:` keeps working
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // FIVE text sizes only (docs/rebuild/03-look.md §3). This REPLACES Tailwind's scale, so any other size does not exist.
    // lg / 2xl / 4xl are TEMPORARY synonyms of the nearest size so the old screens do not break; P12 removes them.
    fontSize: {
      xs: ["12px", "18px"],
      sm: ["14px", "22px"],
      base: ["16px", "26px"],
      xl: ["20px", "28px"],
      "3xl": ["28px", "36px"],
      lg: ["16px", "26px"],
      "2xl": ["20px", "28px"],
      "4xl": ["28px", "36px"],
    },
    extend: {
      colors: themeColors,
      fontFamily: {
        // one face: Cairo (the root layout loads it through next/font as --font-cairo), IBM Plex as the fallback
        sans: ["var(--font-cairo)", "var(--font-plex)", '"Segoe UI"', "Tahoma", "system-ui", "sans-serif"],
        display: ["var(--font-display)"],
      },
      borderRadius: {
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        card: "var(--radius-card)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "0 2px 6px rgb(0 0 0 / 0.07)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        wiggle: { "0%, 100%": { transform: "rotate(-14deg)" }, "50%": { transform: "rotate(14deg)" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        wiggle: "wiggle 0.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
