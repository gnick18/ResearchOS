import { NextRequest } from "next/server";
import { safeFetch } from "@/lib/api/url-guards";
import { withRateLimit } from "@/lib/api/rate-limit";

/**
 * Server-side proxy for Telegram's file CDN.
 *
 * Telegram's JSON API (api.telegram.org/bot…/method) sets
 * `Access-Control-Allow-Origin: *`, so the browser can hit getMe / getUpdates
 * / getFile / sendMessage directly. The file CDN
 * (api.telegram.org/file/bot…/path) does NOT, so the browser blocks the
 * actual photo download with a CORS error. This route runs server-side
 * (Next dev server in development, Vercel function in production) and
 * proxies the bytes through with the original Content-Type.
 *
 * The bot token is passed via `x-telegram-token` header rather than a query
 * parameter so it doesn't end up in URL access logs. Token shape is
 * validated to keep this from being abused as a generic SSRF proxy.
 *
 * Defenses layered here:
 *   - Token shape regex (numeric:base64-ish).
 *   - File-path allowlist: only chars Telegram itself uses; no `..`, no
 *     leading slash, no query/fragment splicing, no percent-encoding tricks.
 *   - Final URL parsed via `new URL()` and asserted to live on `api.telegram.org`
 *     even after construction.
 *   - `safeFetch` enforces: HTTPS only, host pinned to api.telegram.org,
 *     manual redirects re-validated through the same allowlist (3 hops max),
 *     20 MiB body cap (Telegram's bot-API file cap), 30 s timeout,
 *     content-type denylist (HTML / JS to keep this from being weaponised
 *     as an XSS open-redirect via a malicious upstream).
 */

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
// Telegram file paths look like `photos/file_15.jpg`, `documents/file_42.pdf`,
// `videos/file_3.mp4`, etc. Be strict: letters, digits, `_`, `-`, `.`, `/`.
// No `..`, no leading `/`, no query/fragment characters, no percent-encoding
// (so `%2e%2e` traversal can't sneak through).
const TELEGRAM_PATH_RE = /^[A-Za-z0-9_./-]+$/;

const TELEGRAM_FILE_HOST = "api.telegram.org";
const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024; // Bot API hard cap is 20 MB.

async function handleGet(req: NextRequest): Promise<Response> {
  const token = req.headers.get("x-telegram-token");
  const path = req.nextUrl.searchParams.get("path");

  if (!token || !path) {
    return new Response("Missing token header or path query", { status: 400 });
  }
  if (!TOKEN_RE.test(token)) {
    return new Response("Invalid token format", { status: 400 });
  }
  // Real Telegram `file_path` values are well under 80 chars
  // (e.g. `photos/file_15.jpg`, `documents/file_42.pdf`). Cap at 80 to keep a
  // malicious caller from forcing a pathologically long signed URL or driving
  // log-blow-up.
  if (
    path.length === 0 ||
    path.length > 80 ||
    path.startsWith("/") ||
    path.includes("..") ||
    !TELEGRAM_PATH_RE.test(path)
  ) {
    return new Response("Invalid path", { status: 400 });
  }

  // Build the URL via `new URL` so the runtime parser, not string interpolation,
  // determines the final host. Then re-assert the host as belt-and-suspenders;
  // a malformed token wouldn't get this far thanks to TOKEN_RE, but parsing
  // catches edge cases (e.g. unicode normalisation) we'd rather not chase.
  let target: URL;
  try {
    target = new URL(`https://${TELEGRAM_FILE_HOST}/file/bot${token}/${path}`);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  if (target.hostname !== TELEGRAM_FILE_HOST) {
    return new Response("Invalid path", { status: 400 });
  }

  const result = await safeFetch(target.toString(), {
    allowedSchemes: ["https:"],
    allowedHosts: [TELEGRAM_FILE_HOST],
    maxRedirects: 3,
    maxBytes: MAX_TELEGRAM_FILE_BYTES,
    timeoutMs: 30_000,
    headers: { "user-agent": "ResearchOS/1.0" },
    // Block content types that could become XSS vectors if a downstream
    // caller naively opens the proxied URL in a new tab. The legitimate
    // Telegram surface is images / video / audio / pdf / generic binaries,
    // none of which need text/html or application/javascript.
    forbiddenContentTypes: [
      "text/html",
      "application/xhtml+xml",
      "application/javascript",
      "text/javascript",
      "application/ecmascript",
      "text/ecmascript",
      // SVG can execute scripts when loaded as a top-level document; the
      // client only uses these via blob URLs in <img>, but denying SVG
      // here is cheap defence-in-depth.
      "image/svg+xml",
    ],
  });

  if (!result.ok) {
    // Don't echo `result.error` to the client — it may contain upstream
    // status codes, internal node error messages, advertised-byte counts,
    // etc. that fingerprint the proxy or the upstream. The status code is
    // enough; log the detail server-side for debugging.
    console.warn("[telegram-file] upstream failed", {
      status: result.status,
      error: result.error,
    });
    return new Response(genericErrorMessage(result.status), { status: result.status });
  }

  const headers = new Headers();
  const contentType = result.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentLength = result.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  headers.set("cache-control", "no-store");
  // Defence in depth: even if a bad content-type slips through, tell the
  // browser not to sniff it into something executable.
  headers.set("x-content-type-options", "nosniff");

  return new Response(result.body, { status: 200, headers });
}

export const GET = withRateLimit(handleGet, {
  limit: 30,
  windowMs: 60_000,
  name: "telegram-file",
});

function genericErrorMessage(status: number): string {
  if (status === 400) return "Bad request";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Upstream not found";
  if (status === 413) return "Response too large";
  if (status === 415) return "Unsupported response content type";
  if (status === 504) return "Upstream timed out";
  return "Upstream fetch failed";
}
