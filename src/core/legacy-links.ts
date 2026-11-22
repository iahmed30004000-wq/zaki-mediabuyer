/**
 * What an address of the old map carried in its QUERY, read for the new one (v6 · P8, docs/rebuild-v6/02-screens.md §8). next.config.mjs moves the path and keeps the query as it was, so the
 * two screens that used to read a query of their own now read the old spelling too. Pure: a string in, a string out.
 */

/**
 * The comparison window of «الأرقام ← المنتجات» (`p`) from what the page was given: the new `p` as it is, else the old `d` of `/products?d=…` — `yesterday` is the window that ends yesterday
 * (`1`), `custom` stays `custom` (with its `from` and `to`), and anything else the old page knew (`today`, `7d`) or did not know is no choice at all (the screen then shows the last seven days).
 */
export function productsWindow(p: string | undefined, d: string | undefined): string | undefined {
  if (p) return p;
  if (d === "yesterday") return "1";
  if (d === "custom") return "custom";
  return undefined;
}

/** `/work/reports?r=<id>` was a report by its id: the new address of it, or null when `r` is empty. The id is written into a path, so it is escaped. */
export function oldReportAddress(r: string | undefined): string | null {
  const id = (r ?? "").trim();
  return id ? `/tasks/results/${encodeURIComponent(`report:${id}`)}` : null;
}
