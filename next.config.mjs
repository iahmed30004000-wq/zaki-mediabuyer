/** @type {import('next').NextConfig} */
/**
 * The old places live inside the new ones (v5, docs/rebuild/02-structure.md §5): every old address still opens, on its new home.
 * Not permanent (307): the owner may still move things around. A request's query string is carried over. The order matters:
 * the one with a condition (`has`) comes before the plain one of the same source. tests/nav.test.ts holds this table.
 *
 * Left out on purpose: `/?tab=summary` and `/ads?tab=products` — their destination IS the source, so Next would loop (the pages ignore `tab`).
 */
const tab = (value) => [{ type: "query", key: "tab", value }];

export const LEGACY_REDIRECTS = [
  { source: "/", has: tab("numbers"), destination: "/products", permanent: false },
  { source: "/tasks", destination: "/inbox", permanent: false },
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
  { source: "/guide", destination: "/settings#guide", permanent: false },
  { source: "/setup", destination: "/settings#setup", permanent: false },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ["bcryptjs", "@prisma/client", "exceljs"],
  },
  async redirects() {
    return LEGACY_REDIRECTS;
  },
};

export default nextConfig;
