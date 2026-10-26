import type { MetadataRoute } from "next";

/** Installable on the phone (spec 18.5): opens straight on «اليوم», in the «وُضوح» colours, right to left. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "الميديا باير · Zaki",
    short_name: "الميديا باير",
    description: "إعلانات ميتا على حقيقة الطلبات: الأمان تلقائي، والصرف بموافقتك.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#F4F8FA",
    theme_color: "#0C3252",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "بانتظاري", url: "/decisions", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "آخر تقرير", url: "/reports", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
