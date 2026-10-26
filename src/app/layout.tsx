import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { DECOR_COOKIE, THEME_COOKIE, decorLevelOf, rootThemeAttributes, themeOf } from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";

/** The body face of every theme. */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

/** The title face of «إزنيق» and «المرصد» (self-hosted, SIL OFL, not preloaded: only those themes fetch it). */
const reem = localFont({
  src: "../../public/fonts/reem-kufi-var.woff2",
  weight: "400 700",
  display: "swap",
  preload: false,
  variable: "--font-reem",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "الميديا باير · Zaki", template: "%s · الميديا باير" },
  description: "مدير إعلانات ميتا للدفع عند الاستلام: الحقيقة من الـ OMS، الأمان تلقائي، والصرف بموافقتك.",
};

function chosen() {
  const store = cookies();
  return {
    theme: themeOf(store.get(THEME_COOKIE)?.value),
    decor: decorLevelOf(store.get(DECOR_COOKIE)?.value),
  };
}

export function generateViewport(): Viewport {
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: themeColorOf(chosen().theme) };
}

/** The theme is painted on the server from the cookie, so the first frame is already right. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme, decor } = chosen();
  const attrs = rootThemeAttributes(theme, decor);
  const className = [plex.variable, reem.variable, attrs.dark ? "dark" : ""].filter(Boolean).join(" ");
  return (
    <html lang="ar" dir="rtl" data-theme={attrs["data-theme"]} data-decor={attrs["data-decor"]} className={className} suppressHydrationWarning>
      <body>
        <Providers theme={theme} decor={decor}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
