/** @type {import('next').NextConfig} */
/**
 * The old places live inside the new ones (v3, DECISIONS D18): every old address still opens, on its new home.
 * Not permanent (307): the owner may still move things around. A request's query string is carried over, so
 * /reports?r=<id> lands on /done?tab=reports&r=<id>. tests/nav.test.ts holds this table.
 */
export const LEGACY_REDIRECTS = [
  { source: "/decisions", destination: "/tasks", permanent: false },
  { source: "/creatives", destination: "/videos?tab=flow", permanent: false },
  // alerts used to point at /reports?tab=safety|data — those two tabs are «الصحة» inside الإعلانات now
  { source: "/reports", has: [{ type: "query", key: "tab", value: "(safety|data)" }], destination: "/ads", permanent: false },
  { source: "/reports", destination: "/done?tab=reports", permanent: false },
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
