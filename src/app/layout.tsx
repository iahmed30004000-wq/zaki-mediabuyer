import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Cairo, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegister } from "@/components/pwa-register";
import { THEME_COOKIE, rootThemeAttributes, themeOf } from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";

/** One face for everything: Cairo (400 · 600 · 700 · 800). */
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-cairo",
});

/** The fallback in the font stack (not preloaded: it is only used while Cairo loads). */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "600"],
  display: "swap",
  preload: false,
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: { default: "الميديا باير · Zaki", template: "%s · الميديا باير" },
  description: "مدير إعلانات ميتا للدفع عند الاستلام: الحقيقة من الـ OMS، الأمان تلقائي، والصرف بموافقتك.",
  applicationName: "الميديا باير",
  appleWebApp: { capable: true, title: "الميديا باير", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch.png", sizes: "180x180" }] },
};

function chosen() {
  const store = cookies();
  return {
    theme: themeOf(store.get(THEME_COOKIE)?.value),
  };
}

export function generateViewport(): Viewport {
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: themeColorOf(chosen().theme) };
}

/** The theme is painted on the server from the cookie, so the first frame is already right. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme } = chosen();
  const attrs = rootThemeAttributes(theme);
  const className = [cairo.variable, plex.variable, attrs.dark ? "dark" : ""].filter(Boolean).join(" ");
  return (
    <html lang="ar" dir="rtl" data-theme={attrs["data-theme"]} className={className} suppressHydrationWarning>
      <body>
        <Providers theme={theme}>
          {children}
        </Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
