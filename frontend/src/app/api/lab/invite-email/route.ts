// Lab-invite email delivery route (the OPTION for ResearchOS to email a lab
// invite on the head's behalf, alongside the existing copy-the-link flow).
//
// POST { toEmail, senderLabel, labName, inviteUrl }. The inviteUrl is the lab
// system's own /lab/join link (with its #inv= fragment). This route does NOT
// build or interpret that link, it only wraps it in the brand layout and sends
// it, so it is decoupled from the lab membership internals.
//
// Anti-abuse: gated on SHARING_ENABLED (the email infra is dark otherwise),
// per-IP rate limited, and it REFUSES any inviteUrl that is not one of our own
// ${origin}/lab/join links, so it cannot be used to mail arbitrary URLs to
// arbitrary addresses.
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN,
// RESEND_API_KEY, NEXT_PUBLIC_APP_ORIGIN, DATABASE_URL.

import { getInviteLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { emailAssetOrigin } from "@/lib/email/layout";
import { sendLabInviteEmail } from "@/lib/lab/invite-mailer";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "lab invite email failed" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Accept only our own /lab/join links. Prevents the endpoint from being used as
 * an open relay to mail arbitrary URLs. Matches the canonical origin's
 * /lab/join path (the fragment carries the actual invite).
 */
function isOwnLabJoinUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = new URL(emailAssetOrigin());
    return (
      parsed.protocol === "https:" &&
      parsed.host === origin.host &&
      parsed.pathname === "/lab/join"
    );
  } catch {
    return false;
  }
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

  const toEmail = b.toEmail;
  const senderLabel = b.senderLabel;
  const labName = b.labName;
  const inviteUrl = b.inviteUrl;

  if (
    !nonEmptyString(toEmail) ||
    !EMAIL_RE.test(toEmail.trim()) ||
    !nonEmptyString(senderLabel) ||
    !nonEmptyString(labName) ||
    !nonEmptyString(inviteUrl) ||
    !isOwnLabJoinUrl(inviteUrl.trim())
  ) {
    return json(400, GENERIC_FAILURE);
  }

  try {
    await sendLabInviteEmail({
      toEmail: toEmail.trim(),
      senderLabel: senderLabel.trim(),
      labName: labName.trim(),
      inviteUrl: inviteUrl.trim(),
    });
  } catch {
    return json(502, { error: "invite email could not be sent" });
  }

  return json(200, { ok: true });
}
