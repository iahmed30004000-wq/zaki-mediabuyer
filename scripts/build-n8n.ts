/**
 * Writes the eight n8n starter workflows to n8n/media-buyer/*.json from the seeded jobs (src/core/n8n-starters.ts).
 * `npm run n8n:build` rewrites them; tests/n8n-starters.test.ts fails if a committed file differs from what this would write.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { starterFile, starterText, starters } from "../src/core/n8n-starters";

const dir = join(process.cwd(), "n8n", "media-buyer");
mkdirSync(dir, { recursive: true });
for (const s of starters()) {
  writeFileSync(join(dir, starterFile(s.key)), starterText(s));
  console.log("wrote", join("n8n", "media-buyer", starterFile(s.key)));
}
