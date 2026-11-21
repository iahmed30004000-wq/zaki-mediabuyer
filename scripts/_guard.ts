/**
 * The demo scripts wipe tables (deleteMany with no condition) to start from a known state. They must only ever run against a database on
 * THIS machine — never the production one, even from a terminal opened inside the container (v6 P0-1, N-09).
 * `assertLocalDatabase()` goes right after the imports of every `scripts/demo-*.ts`, `full-check.ts` and `full-path.ts`.
 */
export const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

/** Pure: is this DATABASE_URL on this machine? Anything that does not parse is NOT local. */
export function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function assertLocalDatabase(url = process.env.DATABASE_URL): void {
  if (!isLocalDatabase(url)) {
    console.error("✗ refusing to run: this script clears tables and only runs against a database on 127.0.0.1 / localhost (DATABASE_URL points elsewhere or is missing).");
    process.exit(1);
  }
}
