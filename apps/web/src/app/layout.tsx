import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/providers/QueryProvider";
import { AnalyticsProvider } from "@/providers/AnalyticsProvider";
import { FontSizeSync } from "@/components/FontSizeSync";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karibu",
  description: "Karibu microlearning platform",
  manifest: "/site.webmanifest",
};

// Applies the cached font-size preference before paint to avoid a flash of the
// default size on load (mirrors how next-themes applies the theme). Keep the
// storage key in sync with FONT_SIZE_STORAGE_KEY in FontSizeSync.
const FONT_SIZE_INIT_SCRIPT = `
(function () {
  try {
    var v = localStorage.getItem("karibu:font-size");
    var allowed = ["sm", "base", "lg", "xl"];
    document.documentElement.setAttribute(
      "data-font-size",
      allowed.indexOf(v) !== -1 ? v : "base"
    );
  } catch (e) {
    document.documentElement.setAttribute("data-font-size", "base");
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <QueryProvider>
            <FontSizeSync />
            <AnalyticsProvider>{children}</AnalyticsProvider>
          </QueryProvider>
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
