/**
 * `npm run ui:baseline` — prints the UI-rule counts and writes tests/ui-rules.baseline.json with them.
 * It writes only when nothing went UP (the first run, with no file yet, writes whatever there is). A number that went up means
 * a rule was broken: fix the code, do not raise the baseline. `npm run ui:baseline -- --where` also lists the files per metric.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { METRICS, METRIC_NOTE, countRepo, overBaseline, type Counts } from "./ui-rules";

const root = path.resolve(__dirname, "..");
const file = path.join(root, "tests", "ui-rules.baseline.json");
const { total, byFile } = countRepo(root);

console.log("UI rules — current counts (a number only goes down):");
for (const m of METRICS) console.log(`  ${m.padEnd(16)} ${String(total[m]).padStart(5)}   ${METRIC_NOTE[m]}`);

if (process.argv.includes("--where")) {
  for (const m of METRICS) {
    const rows = Object.entries(byFile).filter(([, c]) => c[m] > 0).sort((a, b) => b[1][m] - a[1][m]).slice(0, 12);
    if (rows.length) console.log(`\n${m}:\n${rows.map(([f, c]) => `  ${String(c[m]).padStart(4)}  ${f}`).join("\n")}`);
  }
}

const had = existsSync(file);
const baseline: Partial<Counts> = had ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Counts>) : {};
const up = had ? overBaseline(total, baseline) : [];
if (up.length) {
  console.error(`\nRefused: ${up.map((u) => `${u.metric} ${u.allowed} -> ${u.now}`).join(" · ")}. Fix the code; the baseline never goes up.`);
  process.exit(1);
}
writeFileSync(file, JSON.stringify(Object.fromEntries(METRICS.map((m) => [m, total[m]])), null, 2) + "\n");
console.log(`\n${had ? "Baseline updated" : "Baseline created"}: ${path.relative(root, file)}`);
