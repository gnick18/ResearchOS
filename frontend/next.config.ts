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
const COLLAB_RELAY_WS =
  process.env.NEXT_PUBLIC_COLLAB_RELAY_URL ?? "ws://localhost:8787";
// The relay also serves an HTTP GET /snapshot (canonical-read for the fork-fix
// adopt, storage migration chunk 5), fetched cross-origin from the app. CSP
// connect-src must allow the http(s) origin too, not just the ws(s) one. Derive
// it by swapping the scheme (wss->https, ws->http) so a single env var drives
// both.
const COLLAB_RELAY_HTTP = COLLAB_RELAY_WS.replace(/^ws/, "http");
const COLLAB_RELAY_ORIGIN = `${COLLAB_RELAY_WS} ${COLLAB_RELAY_HTTP}`;

// The mobile capture relay (bench-photo upload + E2E snapshot download) is an
// https origin the web app fetches cross-origin (devices, inbox poll, snapshot
// publish). CSP connect-src must allow it. Defaults to the deployed worker, the
// same default as lib/mobile-relay/client.ts captureRelayUrl(), overridable via
// NEXT_PUBLIC_CAPTURE_RELAY_URL. The relay only ever holds signed/sealed bytes.
const CAPTURE_RELAY_ORIGIN =
  process.env.NEXT_PUBLIC_CAPTURE_RELAY_URL ??
  "https://researchos-collab-relay.gnick317.workers.dev";

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
 *   connect-src https://api.ncbi.nlm.nih.gov, https://eutils.ncbi.nlm.nih.gov: the
 *     NCBI integration calls these public government databases browser-direct (no
 *     proxy). api.ncbi.nlm.nih.gov is the Datasets v2 API (taxonomy lineage +
 *     tree, gene/genome metadata, package downloads); eutils.ncbi.nlm.nih.gov is
 *     efetch for annotated GenBank records. Both are CORS-open and read-only; only
 *     a typed organism/accession is sent, never the user's own data.
 *   connect-src ${COLLAB_RELAY_ORIGIN}: the notes collaboration provider opens
 *     a WebSocket to the relay (Phase 3, lib/loro/collab/websocket-transport.ts).
 *     Defaults to the local wrangler dev origin ws://localhost:8787; a deployed
 *     wss:// relay is picked up from NEXT_PUBLIC_COLLAB_RELAY_URL. The relay
 *     fans only sealed ciphertext, so it never sees note plaintext.
 *   connect-src https://pubchem.ncbi.nlm.nih.gov: the chemistry workbench calls
 *     PubChem PUG-REST / PUG-View browser-direct (no proxy) for compound import
 *     (name to CID to SMILES/InChI/SDF/2D) and the literature companion
 *     (compound to linked PubMed papers + patents via xrefs, and substructure
 *     search via fastsubstructure). CORS-open and read-only; only a typed name
 *     or structure is sent, never the user's own data. Note this is a different
 *     host than the api/eutils NCBI entries above (those serve sequences).
 *   connect-src https://www.ebi.ac.uk: the chemistry literature companion calls
 *     Europe PMC (search + the Annotations text-mining API) browser-direct for
 *     full-text papers that mention a compound. CORS-open, no key, read-only.
 *   connect-src https://www.surechembl.org: the chemistry literature companion
 *     calls SureChEMBL (EMBL-EBI patent chemistry) browser-direct to find
 *     patents containing a drawn substructure. CORS-open, no key, read-only;
 *     only the query structure is sent.
 *   worker-src 'self' blob:: Ketcher's standalone struct service runs Indigo
 *     compiled to wasm inside a Web Worker that ketcher-standalone spawns from a
 *     Blob URL (confirmed: new Worker + Blob + createObjectURL in its dist), so
 *     the editor canvas needs blob: workers. Without it the in-browser engine is
 *     CSP-blocked. Scoped to worker-src, the worker code is our own bundled
 *     ketcher chunk, not remote.
 *   script-src 'unsafe-eval': the same Indigo wasm module is built with Emscripten
 *     glue that uses new Function / eval to bootstrap, which 'wasm-unsafe-eval'
 *     does not cover. Without 'unsafe-eval' the worker silently hangs (the
 *     violation fires in worker scope and never reaches the main console), so the
 *     editor sits on its loading spinner forever. Verified live against the
 *     /chemistry-embed-check probe. The policy already allows 'unsafe-inline'
 *     scripts, so this is an incremental relaxation, not a new class of risk.
 *   frame-src blob:: PDF previews render via <iframe src=blob:...>.
 *   frame-ancestors 'none': blocks clickjacking via third-party embedding.
 */
// Shared directives that are identical across all CSP variants. Keep as a typed
// tuple so the per-variant arrays below each get precise type narrowing.
const CSP_SHARED_DIRECTIVES = [
  "default-src 'self'",
  // assets.research-os.com: the smart-icon-search semantic layer dynamically
  // imports onnxruntime-web's wasm loader (`ort-wasm-simd-threaded.jsep.mjs`) as
  // an ES module from our R2 CDN. A module import is governed by script-src (not
  // connect-src), so the CDN must be allowed here too, not only in connect-src.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval' https://va.vercel-scripts.com https://assets.research-os.com",
  "style-src 'self' 'unsafe-inline'",
  // Welcome-page demo loop videos + posters. They moved from Vercel Blob to the
  // R2 custom domain (assets.research-os.com/welcome/*.mp4), so the R2 origin must
  // be in media-src too.
  "media-src 'self' https://*.public.blob.vercel-storage.com https://assets.research-os.com",
  "font-src 'self' data:",
  // assets.research-os.com: loadAssetManifest + fetchAssetSvg fetch the icon
  // library manifest + SVGs from the R2 custom domain (not the *.r2 wildcard).
  `connect-src 'self' https://api.telegram.org https://vitals.vercel-insights.com https://*.r2.cloudflarestorage.com https://assets.research-os.com https://api.ncbi.nlm.nih.gov https://eutils.ncbi.nlm.nih.gov https://pubchem.ncbi.nlm.nih.gov https://www.ebi.ac.uk https://www.surechembl.org data: ${COLLAB_RELAY_ORIGIN} ${CAPTURE_RELAY_ORIGIN}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
] as const;

// Authed-app CSP (research-os.app and localhost). Keeps img-src locked to our own
// hosts only (Vercel Blob + R2 CDN + self).
//   assets.research-os.com: the open-asset (icon library) CDN on Cloudflare R2.
//   Thumbnails load via <img>, so the custom domain must be in img-src (the R2
//   wildcard below only covers the s3 endpoint, not the custom domain).
const CSP = [
  ...CSP_SHARED_DIRECTIVES,
  "img-src 'self' blob: data: https://*.public.blob.vercel-storage.com https://assets.research-os.com",
].join("; ");

// Public lab-site CSP (*.research-os.com subdomains, rewritten to /:labSlug/*).
// These pages are cookie-isolated, no-auth, and render README content from third-
// party GitHub repos. READMEs routinely embed remote badge images (shields.io,
// anaconda.org, raw.githubusercontent.com, badgen.net, etc.) that are blocked by
// the locked-down authed-app img-src. Since this origin carries no auth cookies and
// no sensitive state, broadening img-src to https: is the right trade-off: any
// https image is allowed, which is consistent with how a public GitHub README
// renders in a browser. The authed .app origin is unaffected.
const CSP_LAB_PUBLIC = [
  ...CSP_SHARED_DIRECTIVES,
  "img-src 'self' blob: data: https: https://*.public.blob.vercel-storage.com https://assets.research-os.com",
].join("; ");

const nextConfig: NextConfig = {
  // Ketcher (the chemistry workbench editor) ships ESM that Turbopack fails to
  // bundle as-is: importing the ketcher-react canvas crashed the dev server with
  // "RangeError: Maximum call stack size exceeded" (a known Next 16 Turbopack
  // duplicate-package recursion class, vercel/next.js#56614). Transpiling the
  // ketcher packages through Next's own pipeline resolves the recursion. Scoped
  // to the three ketcher packages only; everything else bundles unchanged.
  transpilePackages: ["ketcher-react", "ketcher-core", "ketcher-standalone"],
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
      {
        // Public lab pages served from <slug>.research-os.com (cookie-isolated, no
        // auth). Scoped by HOST, not path: the broadened img-src (https:, for README
        // badge images from shields.io / anaconda.org / zenodo.org /
        // raw.githubusercontent.com) applies ONLY to lab subdomains. A path-based rule
        // would wrongly loosen img-src on authed app routes like /datahub/x AND would
        // miss lab pages served at the subdomain root (proxy.ts rewrites the path, so
        // the incoming path is "/" not "/:labSlug"). The host condition matches any
        // <sub>.research-os.com (the apex and research-os.app do not match, keeping the
        // authed-app CSP strict). Source "/(.*)" so every path on the lab host wins
        // over the global strict CSP above.
        source: "/(.*)",
        has: [
          {
            type: "host",
            value: "(?<labhost>[a-z0-9-]+\\.research-os\\.com)",
          },
        ],
        headers: [
          { key: "Content-Security-Policy", value: CSP_LAB_PUBLIC },
        ],
      },
      {
        // The self-hosted DuckDB-WASM engine for the Data Hub large-dataset lane
        // is ~34-39 MB across version-pinned binaries (the .wasm files, the
        // worker, the bundled ESM, and the versioned parquet extension under
        // v<ver>/). They only change on a deliberate DuckDB upgrade (which is a
        // code change), so cache them aggressively: without this the browser
        // re-downloads tens of MB on every reload, which is the bulk of the
        // "switch to large-dataset mode stalls" complaint.
        source: "/duckdb/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
