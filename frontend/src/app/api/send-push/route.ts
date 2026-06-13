// Phone push delivery route (phone push P1, the wake-and-fetch buzz).
//
// POST { tokens: string[], category?: string }. Sends a GENERIC, content-free
// push to the Expo Push Service, which fans out to APNs and FCM. The recipient's
// own laptop calls this when a NEW phone-routed notification lands (the
// NotificationDesktopWatcher, after it has already published the sealed snapshot
// to the relay). On receipt the companion wakes and fetches + locally decrypts
// the snapshot it already reads, so the plaintext only ever exists on the phone.
//
// THE SINGLE MOST IMPORTANT RULE: the push payload carries NO research content.
// No notification text, no item name, no lab data. Only a generic body ("New
// activity in your lab") and a coarse category hint (the same five categories
// the user sees in Settings, never an item). The quiet-hours + per-category
// phone gate runs on the laptop BEFORE this route is ever called
// (pushChannelsForNotification), so a category the user did not route to the
// phone never reaches here.
//
// Anti-abuse: gated on SHARING_ENABLED (the relay/push infra is dark otherwise)
// and per-IP rate limited (shares the invite email budget). Token count is
// capped and every token is shape-validated, so it cannot fan out arbitrarily.
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN.

import { getInviteLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** A real Expo push token looks like ExponentPushToken[xxxx] or
 *  ExpoPushToken[xxxx]. Reject anything else so a malformed value never reaches
 *  Expo and so this route cannot be coerced into posting arbitrary strings. */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

/** A small cap so one call can only ever buzz a handful of paired phones. */
const MAX_TOKENS = 20;

/** Generic, content-FREE bodies keyed by the coarse category. These are the
 *  same category names the user sees in Settings, never an item or any text from
 *  the notification itself. Default covers any unknown / future category. */
const GENERIC_BODY: Record<string, string> = {
  shared: "Something new was shared with you",
  comments: "You have a new comment or mention",
  lab: "New lab activity",
  purchases: "An order update is waiting",
  reminders: "You have a reminder",
};
const DEFAULT_BODY = "New activity in your lab";

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getInviteLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "push send failed" });
  }

  const b = body as Record<string, unknown> | null;
  if (!b) return json(400, { error: "push send failed" });

  const rawTokens = Array.isArray(b.tokens) ? b.tokens : [];
  const tokens = Array.from(
    new Set(
      rawTokens.filter(
        (t): t is string => typeof t === "string" && EXPO_TOKEN_RE.test(t),
      ),
    ),
  ).slice(0, MAX_TOKENS);

  if (tokens.length === 0) {
    // No valid token to send to is not an error from the caller's side (a phone
    // may simply not have granted the OS notification permission); ack quietly.
    return json(200, { ok: true, sent: 0 });
  }

  const category = typeof b.category === "string" ? b.category : "";
  const messageBody = GENERIC_BODY[category] ?? DEFAULT_BODY;

  // One Expo message per token. The body is generic; `data` carries only the
  // coarse category hint and the snapshot kind the phone should refresh, never
  // any notification content. high priority so the wake-and-fetch is prompt.
  const messages = tokens.map((to) => ({
    to,
    title: "ResearchOS",
    body: messageBody,
    sound: "default" as const,
    priority: "high" as const,
    data: { kind: "notifications", category: category || undefined },
  }));

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      return json(502, { error: "push service rejected the send" });
    }
  } catch {
    return json(502, { error: "push could not be sent" });
  }

  return json(200, { ok: true, sent: tokens.length });
}
