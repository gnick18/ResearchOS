import { NextRequest } from "next/server";

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
 */

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.headers.get("x-telegram-token");
  const path = req.nextUrl.searchParams.get("path");

  if (!token || !path) {
    return new Response("Missing token header or path query", { status: 400 });
  }
  if (!TOKEN_RE.test(token)) {
    return new Response("Invalid token format", { status: 400 });
  }
  // Telegram file paths look like `photos/file_15.jpg` or `documents/file_…`.
  // Reject anything that could resolve outside that namespace.
  if (path.startsWith("/") || path.includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }

  const upstream = await fetch(
    `https://api.telegram.org/file/bot${token}/${path}`,
    {
      // The CDN doesn't honor a User-Agent override, but force a stable one
      // anyway in case Vercel's outbound fetch surfaces something Telegram
      // doesn't like by default.
      headers: { "user-agent": "ResearchOS/1.0" },
      cache: "no-store",
    }
  );

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream returned ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: 200, headers });
}
