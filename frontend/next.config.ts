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
 * Resolve the collab relay origin for the CSP connect-src allowlist.
 *
 * The notes collaboration provider opens a WebSocket to the relay (Phase 3).
 * The client connect URL comes from NEXT_PUBLIC_COLLAB_RELAY_URL and defaults
 * to the local wrangler dev server. CSP connect-src needs the ORIGIN
 * (scheme://host:port) without the /ws path, and the value is already an
 * origin, so we pass it through. Deriving it from the same env var means a
 * deployed wss:// relay is auto-allowed once that var is set, with no second
 * place to update.
 */
const COLLAB_RELAY_ORIGIN =
  process.env.NEXT_PUBLIC_COLLAB_RELAY_URL ?? "ws://localhost:8787";

/**
 * Content-Security-Policy locked to the surface ResearchOS actually uses.
 *
 *   script-src 'unsafe-inline': Next.js dev (and prod, for now) emits inline
 *     <script> tags for hydration and Turbopack HMR. Replacing this with a
 *     per-build nonce is the next step; tracked as a known gap.
 *   script-src 'wasm-unsafe-eval': narrow CSP opt-in (Chrome 102+ / Firefox
 *     102+ / Safari 15.4+) that allows WebAssembly.compile + instantiate
 *     WITHOUT enabling the much broader 'unsafe-eval' (eval(), new Function(),
 *     setTimeout(string, ...)). Needed by @react-pdf/renderer's PDF export
 *     path: @react-pdf/layout depends on yoga-layout, whose browser build
 *     ships as a WASM-base64 module instantiated at runtime. PDF export
 *     errors with `CompileError: WebAssembly.instantiate(): ... violates the
 *     following Content Security policy directive` without this. See
 *     SECURITY_AUDIT.md §3.2 + AGENTS.md §6 trap entry.
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
 *   connect-src https://*.r2.cloudflarestorage.com: the cross-boundary sharing
 *     relay uploads and downloads encrypted bundles directly from the browser
 *     to Cloudflare R2 via presigned URLs (see lib/sharing/relay/client.ts).
 *     The host is <bucket>.<account>.r2.cloudflarestorage.com, so the wildcard
 *     covers any bucket/account. The bytes are sealed client-side and the URL
 *     is short-lived and presigned, so the relay never sees plaintext.
 *   connect-src data:: @react-pdf/renderer's PDF export path loads its
 *     yoga-layout engine, whose browser build (yoga-layout 3.2.1) ships the
 *     WASM as a `data:application/octet-stream;base64,...` module and loads
 *     it with `fetch(dataUrl)`. Without `data:` here that fetch is CSP-blocked
 *     and the browser logs "Fetch API cannot load data:... violates the
 *     document's Content Security Policy". yoga does fall back to decoding the
 *     embedded base64 synchronously, so the export still completes, but the
 *     violation is noisy and the fallback is fragile; allowing `data:` lets
 *     yoga use its intended load path. Scoped to connect-src ONLY: a `data:`
 *     URI is inert self-contained bytes with no remote endpoint, so it cannot
 *     be used as a data-exfiltration channel the way an attacker-controlled
 *     https: origin could. NB: react-pdf needs NO worker-src/blob: (it spawns
 *     no Worker) and NO 'unsafe-eval' (its WASM init only needs the
 *     'wasm-unsafe-eval' already granted above); verified against react-pdf
 *     4.5.1 in a production build. See AGENTS.md §6 trap entry.
 *   connect-src ${COLLAB_RELAY_ORIGIN}: the notes collaboration provider opens
 *     a WebSocket to the relay (Phase 3, lib/loro/collab/websocket-transport.ts).
 *     Defaults to the local wrangler dev origin ws://localhost:8787; a deployed
 *     wss:// relay is picked up from NEXT_PUBLIC_COLLAB_RELAY_URL. The relay
 *     fans only sealed ciphertext, so it never sees note plaintext.
 *   frame-src blob:: PDF previews render via <iframe src=blob:...>.
 *   frame-ancestors 'none': blocks clickjacking via third-party embedding.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.public.blob.vercel-storage.com",
  // Vercel Blob CDN for the welcome-page demo loop videos and their posters.
  "media-src 'self' https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  `connect-src 'self' https://api.telegram.org https://vitals.vercel-insights.com https://*.r2.cloudflarestorage.com data: ${COLLAB_RELAY_ORIGIN}`,
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
