import { NextRequest } from "next/server";
import { safeFetch } from "@/lib/api/url-guards";

/**
 * Server-side proxy for external ICS calendar feeds (Google, Outlook, iCloud,
 * and arbitrary other public iCal URLs).
 *
 * Direct browser fetches against `calendar.google.com`, `outlook.live.com`,
 * `*.icloud.com`, etc. fail because those CDNs don't set
 * `Access-Control-Allow-Origin`. This route runs server-side (Next dev server
 * locally, Vercel function in production) and proxies the bytes through with
 * a stable text/calendar content type.
 *
 * The user supplies an arbitrary URL, so we treat every defence in the
 * `safeFetch` helper as load-bearing here:
 *
 *   - scheme allowlist (http + https only — no `file://`, `gopher://`, etc.;
 *     `webcal://` / `webcals://` are rewritten upstream of the guard),
 *   - DNS resolution and rejection of private / loopback / link-local /
 *     metadata IPs (including IPv4-mapped IPv6 forms),
 *   - manual redirect handling: each hop is re-validated, capped at 3 hops,
 *   - 10 MiB streamed body cap (largest published ICS feeds I've seen are
 *     well under a megabyte; 10 MiB is generous headroom),
 *   - 20 s end-to-end timeout,
 *   - content-type denylist for HTML so a login redirect can't reach the
 *     iCal parser as text/calendar,
 *   - body sanity check: the payload must start with `BEGIN:VCALENDAR`
 *     (handles servers that misreport content-type as text/plain or
 *     application/octet-stream).
 *
 * Returns 200 with the raw ICS text on success. Cache-Control: max-age=900
 * (15 min) so Vercel's edge cache absorbs repeat hits — keeps the function
 * invocation budget close to zero even with many users.
 */

const MAX_ICS_BYTES = 10 * 1024 * 1024;

function normalizeUrl(input: string): string {
  // iCloud share links arrive as `webcal://` — same wire protocol as HTTPS for
  // their endpoints, browsers/clients just rewrite the scheme.
  if (input.startsWith("webcal://")) return "https://" + input.slice("webcal://".length);
  if (input.startsWith("webcals://")) return "https://" + input.slice("webcals://".length);
  return input;
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return new Response("Missing url query parameter", { status: 400 });
  }

  const normalized = normalizeUrl(raw);

  const result = await safeFetch(normalized, {
    allowedSchemes: ["https:", "http:"],
    maxRedirects: 3,
    maxBytes: MAX_ICS_BYTES,
    timeoutMs: 20_000,
    headers: {
      "user-agent": "ResearchOS-calendar-sync/1.0",
      accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
    },
    // No allowlist — users legitimately subscribe to feeds from arbitrary
    // hosts (random university calendars, individual Google share links, …).
    // The IP-level SSRF guard inside safeFetch is the real defence.
    forbiddenContentTypes: [
      "text/html",
      "application/xhtml+xml",
      "application/javascript",
      "text/javascript",
    ],
  });

  if (!result.ok) {
    return new Response(result.error, { status: result.status });
  }

  // Drain to text behind a try/catch: the stream errors with `Response exceeds
  // N bytes` if the upstream blew past the cap, and we want that to surface
  // as a 413 instead of a 500.
  let text: string;
  try {
    text = await new Response(result.body).text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown stream error";
    const status = msg.includes("exceeds") ? 413 : 502;
    return new Response(`Upstream body read failed: ${msg}`, { status });
  }

  // Loose sanity check: published iCal feeds begin with `BEGIN:VCALENDAR`,
  // possibly preceded by a BOM. A login redirect to e.g. Outlook would return
  // HTML, which would crash the client parser otherwise. This is also a
  // backstop in case a server serves the file under a permissive content-type
  // (text/plain / application/octet-stream) that we couldn't reject upstream.
  const stripped = text.replace(/^﻿/, "").trimStart();
  if (!stripped.startsWith("BEGIN:VCALENDAR")) {
    return new Response(
      "Upstream did not return an iCal feed (got HTML or other content). " +
        "If this is a published-calendar share URL, make sure it's the public/ICS variant.",
      { status: 422 }
    );
  }

  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
