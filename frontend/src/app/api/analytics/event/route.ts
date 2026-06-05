// Anonymous feature-usage event sink (powers the /admin "Feature usage" panel).
//
// POST { name, props }. The client beacons a usage event here (share sent,
// profile published, ...). The body is run through sanitizeEvent BEFORE storage,
// so only allow-listed event names with allow-listed, low-cardinality enum /
// boolean props are ever written, never anything per-user. There is no auth, the
// data is anonymous by construction; abuse is bounded by the per-IP rate limit.
//
// Fire-and-forget: the client uses sendBeacon and ignores the response, so this
// always returns quickly and never leaks why something was dropped. A malformed
// or disallowed body is a silent 204, identical to a stored one.
//
// Reads env: SHARING_ENABLED, DATABASE_URL, KV_REST_API_URL, KV_REST_API_TOKEN.

import { sanitizeEvent } from "@/lib/analytics/event-contract";
import { ensureEventLogSchema, recordAnalyticsEvent } from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import { extractClientIp, isSharingEnabled, json } from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

const NO_CONTENT = new Response(null, { status: 204 });

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT;
  }

  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sanitized = sanitizeEvent(raw.name, raw.props);
  if (!sanitized) {
    // Unknown event name, silently ignored (no feedback to the client).
    return NO_CONTENT;
  }

  try {
    await ensureEventLogSchema();
    await recordAnalyticsEvent(sanitized.name, sanitized.props);
  } catch {
    // Best-effort, a storage hiccup must not turn into a client error.
  }
  return NO_CONTENT;
}
