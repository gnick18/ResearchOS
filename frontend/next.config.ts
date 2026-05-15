import type { NextConfig } from "next";

/**
 * Content-Security-Policy locked to the surface ResearchOS actually uses.
 *
 *   script-src 'unsafe-inline': Next.js dev (and prod, for now) emits inline
 *     <script> tags for hydration and Turbopack HMR. Replacing this with a
 *     per-build nonce is the next step; tracked as a known gap.
 *   style-src 'unsafe-inline': Tailwind injects inline <style> rules.
 *   img-src blob: data:: blob URLs come from blobUrlResolver for Images/...
 *     refs; data: covers small inline icons.
 *   font-src data:: some bundled fonts ship as data: URIs.
 *   connect-src https://api.telegram.org: telegram-client.ts polls the Bot
 *     API directly from the browser (see lib/telegram/telegram-client.ts).
 *   frame-src blob:: PDF previews render via <iframe src=blob:...>.
 *   frame-ancestors 'none': blocks clickjacking via third-party embedding.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.telegram.org",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
