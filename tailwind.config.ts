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
    // SIX text sizes only (docs/rebuild-v6/03-look.md §3). This REPLACES Tailwind's scale, so any other size does not exist.
    fontSize: {
      xs: ["12px", "18px"], // a badge, a time: never a sentence
      sm: ["14px", "22px"], // secondary text, table heads
      base: ["16px", "26px"], // the body text everywhere, and the buttons
      lg: ["20px", "28px"], // a panel title, the clock of the day board (Changa)
      xl: ["24px", "32px"], // the page title (Changa 800)
      "3xl": ["36px", "40px"], // the big number (Changa 800)
    },
    extend: {
      colors: themeColors,
      fontFamily: {
        // two faces: IBM Plex Sans Arabic for the text, Changa for titles, numbers and clocks (the root layout loads both through next/font)
        sans: ["var(--font-plex)", '"Segoe UI"', "Tahoma", "system-ui", "sans-serif"],
        display: ["var(--font-display)"],
      },
      spacing: {
        // the 52px key (a page's main action)
        13: "3.25rem",
      },
      borderRadius: {
        // a key and a field 14 · a card inside a panel 16 · a panel 18 · a chip and a lamp are `rounded-full` (03-look §4)
        lg: "14px",
        xl: "16px",
        "2xl": "18px",
        card: "var(--radius-card)",
      },
      boxShadow: {
        // no shadows: depth is a line and the edge of a key
        card: "var(--shadow-card)",
        "card-hover": "none",
        key: "0 3px 0 rgb(var(--key-edge))",
        "key-down": "0 1px 0 rgb(var(--key-edge))",
        "key-line": "0 3px 0 rgb(var(--border))",
        "key-line-down": "0 1px 0 rgb(var(--border))",
        // a lit lamp: a ring and a halo of its own state colour (03-look §6)
        "lamp-ok": "0 0 0 3px rgb(var(--ok) / 0.22), 0 0 10px rgb(var(--ok) / 0.55)",
        "lamp-run": "0 0 0 3px rgb(var(--info) / 0.22), 0 0 12px rgb(var(--info))",
        "lamp-wait": "0 0 0 3px rgb(var(--warn) / 0.25), 0 0 12px rgb(var(--warn))",
        "lamp-fail": "0 0 0 3px rgb(var(--danger) / 0.25), 0 0 12px rgb(var(--danger))",
        "diode-ok": "0 0 6px rgb(var(--ok))",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        wiggle: { "0%, 100%": { transform: "rotate(-14deg)" }, "50%": { transform: "rotate(14deg)" } },
        // the three motions of a live state (03-look §6)
        breathe: { "50%": { transform: "scale(1.25)", opacity: "0.75" } },
        blink: { "50%": { opacity: "0.35" } },
        chase: { "0%, 100%": { opacity: "0.25" }, "40%": { opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        wiggle: "wiggle 0.5s ease-in-out infinite",
        breathe: "breathe 1.4s ease-in-out infinite", // «نبض»: running
        blink: "blink 1.1s steps(2, jump-none) infinite", // «رمش»: needs you
        chase: "chase 1s linear infinite", // «جري»: the diodes behind the running step
      },
    },
  },
  plugins: [],
};

export default config;
