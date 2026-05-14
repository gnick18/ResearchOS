import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/**
 * Shared SSRF + safe-fetch primitives for the two server-side proxy routes
 * (`/api/telegram-file`, `/api/calendar-feed`). Both routes fetch URLs
 * influenced by untrusted client input, so they need:
 *
 *   - scheme allowlist (no `file://`, `gopher://`, etc.),
 *   - DNS resolution + private/loopback/metadata IP rejection,
 *   - optional host allowlist (Telegram's CDN host is fixed),
 *   - manual redirect handling so each hop is re-validated,
 *   - response-size cap (streamed; aborts when exceeded),
 *   - timeout via AbortController,
 *   - response content-type allowlist where applicable.
 *
 * The route handlers default to the Node.js runtime on Vercel, which gives us
 * `node:dns` / `node:net`. If a future change flips a handler to the edge
 * runtime, this helper will break — keep the routes on Node or replace the
 * DNS lookup with an edge-compatible probe.
 *
 * Known limitation: there is a small TOCTOU window between the DNS lookup
 * here and the actual TCP connect inside `fetch`. The classic SSRF bypass
 * (DNS rebinding) flips the A record in that window. A complete fix would
 * pin the resolved IP and pass the original Host header, but undici doesn't
 * expose that cleanly from a Next.js route — leaving this as a follow-up.
 */

// Numeric [start, end] ranges (inclusive). Compared against IPv4 addresses
// converted to a 32-bit big-endian integer.
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8           "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8          private
  [0x64400000, 0x647fffff], // 100.64.0.0/10       CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8         loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16      link-local incl. cloud metadata (169.254.169.254)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12       private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24        IETF protocol assignments
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24        TEST-NET-1
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16      private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15       benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24     TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24      TEST-NET-3
  [0xe0000000, 0xefffffff], // 224.0.0.0/4         multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4         reserved + 255.255.255.255 broadcast
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_IPV4_RANGES.some(([start, end]) => n >= start && n <= end);
}

function isPrivateIPv6(ip: string): boolean {
  const clean = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (clean === "::1" || clean === "::") return true;
  // fc00::/7 unique-local
  if (/^f[cd][0-9a-f]{2}:/.test(clean)) return true;
  // fe80::/10 link-local (fe80 .. febf)
  if (/^fe[89ab][0-9a-f]:/.test(clean)) return true;
  // ff00::/8 multicast
  if (/^ff[0-9a-f]{2}:/.test(clean)) return true;
  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const mappedDecimal = clean.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDecimal && isPrivateIPv4(mappedDecimal[1])) return true;
  // IPv4-mapped IPv6 in hex form: ::ffff:7f00:0001
  const mappedHex = clean.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const a = parseInt(mappedHex[1], 16);
    const b = parseInt(mappedHex[2], 16);
    const v4 = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
    if (isPrivateIPv4(v4)) return true;
  }
  // 64:ff9b::/96 IPv4/IPv6 translation
  if (/^64:ff9b:/.test(clean)) return true;
  return false;
}

export function isPrivateIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return false;
}

export type UrlGuardOptions = {
  /** Allowed schemes. Defaults to `["https:", "http:"]`. */
  allowedSchemes?: string[];
  /** Optional host allowlist; entries are matched case-insensitively as exact strings or RegExp. */
  allowedHosts?: ReadonlyArray<string | RegExp>;
};

export type UrlGuardResult =
  | { ok: true; url: URL }
  | { ok: false; status: number; error: string };

/**
 * Validate that `raw` is safe to fetch from a server-side proxy:
 *
 *   - parses cleanly,
 *   - uses an allowlisted scheme,
 *   - carries no embedded credentials (`user:pass@`),
 *   - hostname matches the optional allowlist,
 *   - every IP it resolves to is NOT private / loopback / link-local /
 *     multicast / metadata.
 */
export async function assertSafeUrl(
  raw: string,
  opts: UrlGuardOptions = {}
): Promise<UrlGuardResult> {
  const allowedSchemes = opts.allowedSchemes ?? ["https:", "http:"];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400, error: "Malformed URL" };
  }
  if (!allowedSchemes.includes(url.protocol)) {
    return { ok: false, status: 400, error: `Scheme ${url.protocol} is not allowed` };
  }
  if (url.username || url.password) {
    return { ok: false, status: 400, error: "URL must not contain embedded credentials" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, status: 400, error: "URL has no host" };
  }
  if (opts.allowedHosts) {
    const lowerHost = host.toLowerCase();
    const matches = opts.allowedHosts.some((h) =>
      typeof h === "string" ? h.toLowerCase() === lowerHost : h.test(host)
    );
    if (!matches) {
      return { ok: false, status: 403, error: "Host is not on the allowlist" };
    }
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      const records = await dns.lookup(host, { all: true, verbatim: true });
      addresses = records.map((r) => r.address);
    } catch {
      return { ok: false, status: 400, error: "Host failed DNS resolution" };
    }
    if (addresses.length === 0) {
      return { ok: false, status: 400, error: "Host did not resolve to any address" };
    }
  }
  for (const addr of addresses) {
    if (isPrivateIP(addr)) {
      return {
        ok: false,
        status: 403,
        error: "Host resolves to a private / loopback / metadata address",
      };
    }
  }
  return { ok: true, url };
}

export type SafeFetchOptions = UrlGuardOptions & {
  /** Max redirect hops; each redirected URL is re-validated. Default 3. */
  maxRedirects?: number;
  /** Hard cap on response body bytes; the stream is aborted past this. Default 10 MiB. */
  maxBytes?: number;
  /** End-to-end timeout (connect + read). Default 20 s. */
  timeoutMs?: number;
  /** Request headers forwarded to the upstream. */
  headers?: Record<string, string>;
  /**
   * Optional content-type allowlist; the upstream Content-Type must
   * start with one of these (case-insensitive) or match a RegExp.
   * `application/octet-stream` is commonly used as a fallback; include it
   * explicitly when you want to permit it.
   */
  allowedContentTypes?: ReadonlyArray<string | RegExp>;
  /**
   * Optional content-type denylist applied even when the allowlist matches.
   * Useful for blocking `text/html` on routes that otherwise accept `*\/*`.
   */
  forbiddenContentTypes?: ReadonlyArray<string | RegExp>;
};

export type SafeFetchOk = {
  ok: true;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  finalUrl: URL;
};

export type SafeFetchResult = SafeFetchOk | { ok: false; status: number; error: string };

/**
 * Fetch `rawUrl` with SSRF guards, manual redirect re-validation,
 * a streaming size cap, and an overall timeout. The returned `body` stream
 * errors out if the upstream exceeds `maxBytes`, so the caller MUST be
 * prepared to handle a mid-stream abort (consume via `Response(body).text()`
 * / `.arrayBuffer()` inside try/catch, or pipe straight through and let the
 * downstream client see the aborted stream).
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = rawUrl;
  let redirectsLeft = maxRedirects;

  try {
    // Track visited URLs to break redirect loops even within the redirect budget.
    const visited = new Set<string>();

    while (true) {
      const guard = await assertSafeUrl(currentUrl, opts);
      if (!guard.ok) return guard;

      const canonical = guard.url.toString();
      if (visited.has(canonical)) {
        return { ok: false, status: 502, error: "Redirect loop detected" };
      }
      visited.add(canonical);

      let upstream: Response;
      try {
        upstream = await fetch(canonical, {
          method: "GET",
          headers: opts.headers,
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === "AbortError") {
          return { ok: false, status: 504, error: "Upstream fetch timed out" };
        }
        const msg = err instanceof Error ? err.message : "Unknown fetch error";
        return { ok: false, status: 502, error: `Upstream fetch failed: ${msg}` };
      }

      // Manual redirect handling: revalidate the target through assertSafeUrl
      // on the next loop iteration. Without this an attacker could supply
      // `https://attacker.com` that 302-redirects to `http://127.0.0.1`.
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
        const location = upstream.headers.get("location");
        // Drain the redirect body so the connection is released.
        upstream.body?.cancel().catch(() => {});
        if (!location) {
          return { ok: false, status: 502, error: "Upstream redirect missing Location header" };
        }
        if (redirectsLeft <= 0) {
          return { ok: false, status: 502, error: "Too many redirects" };
        }
        redirectsLeft--;
        try {
          currentUrl = new URL(location, guard.url).toString();
        } catch {
          return { ok: false, status: 502, error: "Upstream redirect to malformed URL" };
        }
        continue;
      }

      if (!upstream.ok) {
        return {
          ok: false,
          status: upstream.status >= 500 ? 502 : upstream.status,
          error: `Upstream returned ${upstream.status}`,
        };
      }

      const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
      if (opts.allowedContentTypes) {
        const allowed = opts.allowedContentTypes.some((t) =>
          typeof t === "string" ? contentType.startsWith(t.toLowerCase()) : t.test(contentType)
        );
        if (!allowed) {
          upstream.body?.cancel().catch(() => {});
          return {
            ok: false,
            status: 415,
            error: `Disallowed upstream content-type: ${contentType || "(missing)"}`,
          };
        }
      }
      if (opts.forbiddenContentTypes) {
        const forbidden = opts.forbiddenContentTypes.some((t) =>
          typeof t === "string" ? contentType.startsWith(t.toLowerCase()) : t.test(contentType)
        );
        if (forbidden) {
          upstream.body?.cancel().catch(() => {});
          return {
            ok: false,
            status: 415,
            error: `Forbidden upstream content-type: ${contentType}`,
          };
        }
      }

      const contentLengthHeader = upstream.headers.get("content-length");
      if (contentLengthHeader) {
        const declared = Number(contentLengthHeader);
        if (Number.isFinite(declared) && declared > maxBytes) {
          upstream.body?.cancel().catch(() => {});
          return {
            ok: false,
            status: 413,
            error: `Upstream advertised ${declared} bytes (cap is ${maxBytes})`,
          };
        }
      }

      if (!upstream.body) {
        return { ok: false, status: 502, error: "Upstream returned no body" };
      }

      // Wrap the body so we can enforce the byte cap as the stream drains
      // and clear the connect/read timeout once the body completes.
      const limited = withSizeLimit(upstream.body, maxBytes, () => clearTimeout(timer));
      return {
        ok: true,
        status: upstream.status,
        headers: upstream.headers,
        body: limited,
        finalUrl: guard.url,
      };
    }
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    return { ok: false, status: 502, error: `Safe-fetch crashed: ${msg}` };
  }
}

function withSizeLimit(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  onSettle: () => void
): ReadableStream<Uint8Array> {
  let received = 0;
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          onSettle();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          const err = new Error(`Response exceeds ${maxBytes} bytes`);
          controller.error(err);
          reader.cancel(err).catch(() => {});
          onSettle();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        onSettle();
      }
    },
    cancel(reason) {
      onSettle();
      return reader.cancel(reason);
    },
  });
}
