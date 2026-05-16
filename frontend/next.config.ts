import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Resolve the current ResearchOS commit SHA at build time so the AI Helper
 * settings card can compare it against the SHA stamped in
 * `public/ai-helper/manifest.json` and surface a freshness callout when
 * the prompts are older than the running app.
 *
 * Order of preference:
 *  1. `VERCEL_GIT_COMMIT_SHA` — set automatically on Vercel deploys.
 *  2. `RESEARCHOS_COMMIT_SHA` — explicit override (CI, custom hosts).
 *  3. `git rev-parse HEAD` — falls back to the local checkout's HEAD.
 *
 * Returns `undefined` if none resolve (rare; e.g. building from a tarball
 * with no git binary). The Settings card treats `undefined` as "skip the
 * freshness comparison" rather than producing a false-positive callout.
 */
function resolveCommitSha(): string | undefined {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.RESEARCHOS_COMMIT_SHA) return process.env.RESEARCHOS_COMMIT_SHA;
  try {
    const sha = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

const COMMIT_SHA = resolveCommitSha();

/**
 * Content-Security-Policy locked to the surface ResearchOS actually uses.
 *
 *   script-src 'unsafe-inline': Next.js dev (and prod, for now) emits inline
 *     <script> tags for hydration and Turbopack HMR. Replacing this with a
 *     per-build nonce is the next step; tracked as a known gap.
 *   script-src https://va.vercel-scripts.com: Vercel Web Analytics loads its
 *     dev/fallback tracker from this CDN. Production deployments on Vercel
 *     also proxy the script same-origin via /_vercel/insights/script.js,
 *     which 'self' already covers.
 *   style-src 'unsafe-inline': Tailwind injects inline <style> rules.
 *   img-src blob: data:: blob URLs come from blobUrlResolver for Images/...
 *     refs; data: covers small inline icons.
 *   font-src data:: some bundled fonts ship as data: URIs.
 *   connect-src https://api.telegram.org: telegram-client.ts polls the Bot
 *     API directly from the browser (see lib/telegram/telegram-client.ts).
 *   connect-src https://vitals.vercel-insights.com: Vercel Web Analytics
 *     beacon endpoint (page-view pings; same-origin /_vercel/insights/*
 *     proxies cover production). The toggle in Settings > Offline Mode
 *     (security affordance #2, d164fd2b) prevents the <Analytics /> wrapper
 *     from mounting at all when on.
 *   frame-src blob:: PDF previews render via <iframe src=blob:...>.
 *   frame-ancestors 'none': blocks clickjacking via third-party embedding.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.telegram.org https://vitals.vercel-insights.com",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  env: {
    // Exposed to the browser as `process.env.NEXT_PUBLIC_RESEARCHOS_COMMIT`
    // and inlined at build time. Used by the AI Helper settings section to
    // detect stale prompt manifests.
    NEXT_PUBLIC_RESEARCHOS_COMMIT: COMMIT_SHA ?? "",
  },
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
