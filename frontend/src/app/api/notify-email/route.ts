// Notification email delivery route (the "lean into my inbox" channel).
//
// POST { to, title, body }. Wraps the notification in the brand layout and
// sends it via Resend. In phase 2 the recipient's own client calls this when a
// new notification lands in an email-enabled category, so `to` is the user's own
// address (set in Settings, Notifications).
//
// Anti-abuse: gated on SHARING_ENABLED (the email infra is dark otherwise) and
// per-IP rate limited (shares the invite email budget). Title and body are
// length-capped so it cannot be used to mail large arbitrary payloads.
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN,
// RESEND_API_KEY, NEXT_PUBLIC_APP_ORIGIN, DATABASE_URL.

import { getInviteLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { sendNotificationEmail } from "@/lib/notifications/notification-mailer";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "notification email failed" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

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
    return json(400, GENERIC_FAILURE);
  }

  const b = body as Record<string, unknown> | null;
  if (!b) return json(400, GENERIC_FAILURE);

  const to = b.to;
  const title = b.title;
  const message = b.body;

  if (
    !nonEmptyString(to) ||
    !EMAIL_RE.test(to.trim()) ||
    !nonEmptyString(title) ||
    !nonEmptyString(message)
  ) {
    return json(400, GENERIC_FAILURE);
  }

  try {
    await sendNotificationEmail({
      toEmail: to.trim(),
      title: title.trim().slice(0, 140),
      body: message.trim().slice(0, 500),
    });
  } catch {
    return json(502, { error: "notification email could not be sent" });
  }

  return json(200, { ok: true });
}
