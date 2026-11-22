/** @type {import('next').NextConfig} */
/**
 * Every old address still opens, on its new home (v5, docs/rebuild/02-structure.md §5; v6 · P8, docs/rebuild-v6/02-screens.md §8): the table below is the whole of it.
 * Not permanent (307): the owner may still move things around. A request's query string is carried over. The order matters:
 * the one with a condition (`has`) comes before the plain one of the same source, and a longer address before the shorter one that would swallow it
 * (`/work/job/:key/draw` before `/work/job/:key`). tests/nav.test.ts holds this table, and tests/old-routes.test.ts keeps the code from linking to any source of it.
 *
 * Left out on purpose: `/?tab=summary` and `/ads?tab=products` — their destination IS the source, so Next would loop (the pages ignore `tab`). So is `/ads?tab=campaigns` (the campaigns
 * table IS `/ads` since v6 · P6). `/ads?product=…` is not here either: `product` is the table's own filter. `/tasks` is a real place («المهام»), not an old address.
 *
 * The drawing board of a job (`/work/job/:key/draw`) was removed in P8 (Q4): its old address opens the steps screen of the same job. The pages a person made in the old edit mode
 * (`/p/:key`) were removed too (Q5): a board of tasks is one of the boards of the team's tasks now, so the old address opens `/tasks/team`.
 */
const tab = (value) => [{ type: "query", key: "tab", value }];

export const LEGACY_REDIRECTS = [
  // the places of v5: «الشغل» is «المهام», «التشغيل» and «المنتجات» are «الأرقام»
  { source: "/work", destination: "/tasks/all", permanent: false },
  { source: "/work/today", destination: "/tasks/day", permanent: false },
  { source: "/work/tasks", destination: "/tasks/team", permanent: false },
  { source: "/work/reports", destination: "/tasks/results", permanent: false },
  { source: "/work/reports/:id", destination: "/tasks/results/:id", permanent: false },
  { source: "/work/job/:key/draw", destination: "/tasks/:key/edit", permanent: false },
  { source: "/work/job/:key", destination: "/tasks/:key", permanent: false },
  { source: "/ops", destination: "/numbers/ops", permanent: false },
  { source: "/ops/confirm", destination: "/numbers/ops", permanent: false },
  { source: "/ops/shipping", destination: "/numbers/ops", permanent: false },
  { source: "/ops/stock", destination: "/numbers/stock", permanent: false },
  { source: "/products", destination: "/numbers/products", permanent: false },
  { source: "/products/:code", destination: "/numbers/products/:code", permanent: false },
  { source: "/ads/campaigns", destination: "/ads", permanent: false },
  // the pages of the old edit mode
  { source: "/p/:key", destination: "/tasks/team", permanent: false },
  // the addresses of v3 and v4
  { source: "/", has: tab("numbers"), destination: "/numbers/products", permanent: false },
  { source: "/workflow/:key", destination: "/tasks/:key", permanent: false },
  { source: "/workflow", destination: "/tasks/all", permanent: false },
  { source: "/done", has: tab("reports"), destination: "/tasks/results", permanent: false },
  { source: "/done", destination: "/tasks/day", permanent: false },
  { source: "/videos", has: tab("flow"), destination: "/ads/videos?view=flow", permanent: false },
  { source: "/videos", destination: "/ads/videos", permanent: false },
  { source: "/ads", has: tab("tests"), destination: "/ads/tests", permanent: false },
  { source: "/ads", has: tab("(health|safety|data|naming)"), destination: "/ads/health", permanent: false },
  { source: "/ads", has: tab("scale"), destination: "/ads/scale", permanent: false },
  { source: "/decisions", destination: "/inbox", permanent: false },
  { source: "/creatives", destination: "/ads/videos?view=flow", permanent: false },
  { source: "/reports", has: tab("(safety|data)"), destination: "/ads/health", permanent: false },
  { source: "/reports", destination: "/tasks/results", permanent: false },
  { source: "/guide", destination: "/settings/advanced/guide", permanent: false },
  { source: "/setup", destination: "/settings/connections", permanent: false },
];

/**
 * Headers on every answer (v6 P0-1, N-17): the site is not framed, the browser does not guess a type, the connection stays https, and the address is not sent to other sites.
 * Kept to what cannot break a page: a full script policy waits for the look phase (Next writes inline scripts).
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // the site has no pictures that need Next's image optimizer (the code never uses next/image), so the optimizer endpoint is switched off
  images: { unoptimized: true },
  // Next 15+: the stable name (`instrumentation.ts` needs no flag any more); these packages are left out of the bundle
  serverExternalPackages: ["bcryptjs", "@prisma/client", "exceljs"],
  async redirects() {
    return LEGACY_REDIRECTS;
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
