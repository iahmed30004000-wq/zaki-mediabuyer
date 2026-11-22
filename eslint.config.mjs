// ESLint flat config (v6 P0-4). `next lint` is gone in Next 16, so the CLI runs it: `npm run lint`.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // The «React Compiler» rules that came with eslint-plugin-react-hooks 7 judge how the screens were WRITTEN (state set inside an effect,
    // a ref read while rendering…), not what they do. Fixing them means rewriting working screens, which is the look phase's job, not a library upgrade's.
    // The classic rules (rules-of-hooks, exhaustive-deps) stay on. Where each one is switched off: docs/rebuild-v6/NOTES.md (P0-4).
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts", "public/**", "vendor/**", "coverage/**", "tests/fixtures/**"]),
]);
