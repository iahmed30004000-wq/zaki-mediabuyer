/** @type {import('next').NextConfig} */
/**
 * The old places live inside the new ones (v5, docs/rebuild/02-structure.md §5): every old address still opens, on its new home.
 * Not permanent (307): the owner may still move things around. A request's query string is carried over. The order matters:
 * the one with a condition (`has`) comes before the plain one of the same source. tests/nav.test.ts holds this table.
 *
 * Left out on purpose: `/?tab=summary` and `/ads?tab=products` — their destination IS the source, so Next would loop (the pages ignore `tab`).
 * `/tasks` is NOT here any more (v6 · P3): it is a real place now («المهام»). It used to lead to `/inbox`, so every `href: "/tasks"` the code and the database kept for a
 * decision was moved to `/inbox` (the code, and a data migration for the alerts and notices already written).
 */
const tab = (value) => [{ type: "query", key: "tab", value }];

export const LEGACY_REDIRECTS = [
  { source: "/", has: tab("numbers"), destination: "/products", permanent: false },
  { source: "/workflow/:key", destination: "/work/job/:key", permanent: false },
  { source: "/workflow", destination: "/work", permanent: false },
  { source: "/done", has: tab("reports"), destination: "/work/reports", permanent: false },
  { source: "/done", destination: "/work/today", permanent: false },
  { source: "/videos", has: tab("flow"), destination: "/ads/videos?view=flow", permanent: false },
  { source: "/videos", destination: "/ads/videos", permanent: false },
  { source: "/ads", has: [{ type: "query", key: "product", value: "(?<code>[A-Za-z0-9_-]+)" }], destination: "/products/:code", permanent: false },
  { source: "/ads", has: tab("campaigns"), destination: "/ads/campaigns", permanent: false },
  { source: "/ads", has: tab("tests"), destination: "/ads/tests", permanent: false },
  { source: "/ads", has: tab("(health|safety|data|naming)"), destination: "/ads/health", permanent: false },
  { source: "/ads", has: tab("scale"), destination: "/ads/scale", permanent: false },
  { source: "/decisions", destination: "/inbox", permanent: false },
  { source: "/creatives", destination: "/ads/videos?view=flow", permanent: false },
  { source: "/reports", has: tab("(safety|data)"), destination: "/ads/health", permanent: false },
  { source: "/reports", destination: "/work/reports", permanent: false },
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
