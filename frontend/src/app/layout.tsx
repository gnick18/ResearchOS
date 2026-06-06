import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/providers";
import OfflineGatedAnalytics from "@/components/OfflineGatedAnalytics";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ResearchOS",
  description: "Research project management with smart GANTT scheduling",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark-mode no-FOUC: set data-theme + color-scheme on <html> from the
            stored preference BEFORE first paint, so there is no white flash and
            the preference is honored on every route (app, wiki, auth) uniformly.
            Runs synchronously ahead of hydration; the useTheme hook keeps React
            in sync afterward. See docs/proposals/dark-mode-toggle.md §5. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('researchos-theme')||'light';if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
        {/* frappe-gantt CSS served from public/ rather than imported from
            node_modules: frappe-gantt@1.0.4 ships a strict `exports` map
            that only exposes `.` (with style: ./dist/frappe-gantt.css as
            a bundler hint, not a usable subpath). Next.js respects the
            exports map and refuses the direct `dist/` subpath import. The
            public/frappe-gantt.css file is byte-identical to the package's
            dist/ copy and is the working approach until frappe-gantt
            relaxes its exports or we vendor the file under src/. */}
        <link rel="stylesheet" href="/frappe-gantt.css" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
        <OfflineGatedAnalytics />
      </body>
    </html>
  );
}
