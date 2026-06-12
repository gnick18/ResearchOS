import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Providers } from "@/lib/providers";
import OfflineGatedAnalytics from "@/components/OfflineGatedAnalytics";
import SelfExportResultBanner from "@/components/lab/SelfExportResultBanner";
import BeakerBotBridges from "@/components/ai/BeakerBotBridges";
import ObjectPopupHost from "@/components/ObjectPopupHost";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand + social-share metadata. metadataBase makes the opengraph-image.png /
// twitter-image.png (auto-detected from this app/ folder) resolve to absolute
// URLs so shared links render a branded preview card. Title uses a template so
// sub-pages read "Page | ResearchOS".
const SITE_URL = "https://research-os.app";
const TAGLINE = "The local-first workspace for research labs.";
const DESCRIPTION =
  "Plan experiments, design and annotate sequences, run your methods library, and keep every file on your own computer.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "ResearchOS",
    template: "%s | ResearchOS",
  },
  description: DESCRIPTION,
  applicationName: "ResearchOS",
  openGraph: {
    type: "website",
    siteName: "ResearchOS",
    title: `ResearchOS, ${TAGLINE}`,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `ResearchOS, ${TAGLINE}`,
    description: DESCRIPTION,
  },
};

// Without this, mobile browsers assume a ~980px desktop viewport and render the
// public marketing pages zoomed-out with horizontal scroll, so the responsive
// Tailwind breakpoints never engage. The actual tool is desktop-only (it needs
// the File System Access API), but the welcome / pricing / legal pages must read
// well on a phone.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        <Providers>
          {children}
          {/* Root popup host (ai popup-host bot, 2026-06-11). BeakerBot (from the
              BeakerSearch palette) asks the host to open a popup in place via
              openObjectPopup(). Mounted inside Providers so it has the
              QueryClient, FileSystem context, and PopupStack available. Renders
              nothing when no popup is open. */}
          {/* Single-registration root for the BeakerBot navigation bridge and
              message bridge (ai palette-morph bot, 2026-06-11). Registering here
              (instead of inside BeakerBotConversation) means the bridges are
              always exactly one instance whether the conversation is rendering in
              the dock, the palette, or both simultaneously. Wrapped in Suspense
              because useNavigationBridge uses useSearchParams, which requires a
              Suspense boundary for static export in Next.js 16. */}
          <Suspense fallback={null}>
            <BeakerBotBridges />
          </Suspense>
          <ObjectPopupHost />
        </Providers>
        {/* Post-disconnect confirmation for a labmate self-export. Mounted at the
            root so it survives the disconnect that self-export triggers (which
            unmounts the in-app modal) and shows on the connect screen. */}
        <SelfExportResultBanner />
        <OfflineGatedAnalytics />
      </body>
    </html>
  );
}
