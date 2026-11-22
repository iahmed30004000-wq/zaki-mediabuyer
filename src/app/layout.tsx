import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Changa, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegister } from "@/components/pwa-register";
import { THEME_COOKIE, rootThemeAttributes, themeOf } from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";

/** Two faces (docs/rebuild-v6/03-look.md §3). Changa (500 · 700 · 800): titles, numbers and clocks, a bold board like an airport's. */
const changa = Changa({
  subsets: ["arabic", "latin"],
  weight: ["500", "700", "800"],
  display: "swap",
  variable: "--font-changa",
});

/** IBM Plex Sans Arabic (400 · 500 · 600 · 700): all the text. */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: { default: "الميديا باير · Zaki", template: "%s · الميديا باير" },
  description: "مدير إعلانات ميتا للدفع عند الاستلام: الحقيقة من الـ OMS، الأمان تلقائي، والصرف بموافقتك.",
  applicationName: "الميديا باير",
  appleWebApp: { capable: true, title: "الميديا باير", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch.png", sizes: "180x180" }] },
};

async function chosen() {
  const store = await cookies();
  return {
    theme: themeOf(store.get(THEME_COOKIE)?.value),
  };
}

export async function generateViewport(): Promise<Viewport> {
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: themeColorOf((await chosen()).theme) };
}

/** The theme is painted on the server from the cookie, so the first frame is already right. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme } = await chosen();
  const attrs = rootThemeAttributes(theme);
  const className = [changa.variable, plex.variable, attrs.dark ? "dark" : ""].filter(Boolean).join(" ");
  return (
    <html lang="ar" dir="rtl" data-theme={attrs["data-theme"]} className={className} suppressHydrationWarning>
      <body>
        <Providers theme={theme}>
          {children}
        </Providers>
        <PwaRegister version={process.env.APP_VERSION ?? "dev"} />
      </body>
    </html>
  );
}
