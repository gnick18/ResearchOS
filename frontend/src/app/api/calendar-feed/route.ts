import { NextRequest } from "next/server";

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
 * The endpoint refuses to fetch private / loopback / link-local hosts so it
 * can't be used as an SSRF jump-box against internal Vercel infrastructure.
 *
 * Returns 200 with the raw ICS text on success. Cache-Control: max-age=900
 * (15 min) so Vercel's edge cache absorbs repeat hits — keeps the function
 * invocation budget close to zero even with many users.
 */

const FORBIDDEN_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^fe80:/i, // ipv6 link-local
  /^fc00:/i, // ipv6 unique local
  /^fd00:/i, // ipv6 unique local
  /^::1$/,
  /^\[::1\]$/,
];

function normalizeUrl(input: string): string {
  // iCloud share links arrive as `webcal://` — same wire protocol as HTTPS for
  // their endpoints, browsers/clients just rewrite the scheme.
  if (input.startsWith("webcal://")) return "https://" + input.slice("webcal://".length);
  if (input.startsWith("webcals://")) return "https://" + input.slice("webcals://".length);
  return input;
}

function isAllowedUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Malformed URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) URLs are supported" };
  }
  const host = url.hostname;
  if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, error: "Private / loopback hosts are not allowed" };
  }
  return { ok: true, url };
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return new Response("Missing url query parameter", { status: 400 });
  }

  const normalized = normalizeUrl(raw);
  const check = isAllowedUrl(normalized);
  if (!check.ok) {
    return new Response(check.error, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(check.url.toString(), {
      headers: {
        "user-agent": "ResearchOS-calendar-sync/1.0",
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
      },
      // The upstream caches are usually fine; we don't want Next's own data
      // cache to retain these (cache lives one layer up on the response).
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    return new Response(`Upstream fetch failed: ${message}`, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`Upstream returned ${upstream.status}`, {
      status: upstream.status >= 500 ? 502 : upstream.status,
    });
  }

  const text = await upstream.text();
  // Loose sanity check: published iCal feeds begin with `BEGIN:VCALENDAR`,
  // possibly preceded by a BOM. A login redirect to e.g. Outlook would return
  // HTML, which would crash the client parser otherwise.
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
    },
  });
}
