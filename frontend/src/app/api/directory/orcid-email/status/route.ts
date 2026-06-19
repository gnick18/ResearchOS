// ORCID-login email-capture, status route (section 18.7).
//
// GET. Tells the client whether the CURRENT signed-in ORCID session still needs
// to capture an email. The entry-flow routing uses this to decide whether to show
// the capture step ahead of the account/folder gate. It reports only a boolean
// plus whether the session is an ORCID session at all, never the email itself
// (the session already carries that once resolved).
//
//   - not signed in / not an ORCID session  -> { orcid: false, needsEmail: false }
//   - ORCID session WITH a resolved email    -> { orcid: true,  needsEmail: false }
//   - ORCID session with NO email on file     -> { orcid: true,  needsEmail: true }
//
// The "has an email" check reads session.user.email (which the auth jwt callback
// populates from the encrypted binding when one exists) and falls back to a
// direct lookupEmailByOrcid so a brand-new binding written this request still
// reads as resolved even before the token refreshes. Resilient: any failure
// reports needsEmail:false for an ORCID session so a transient error never traps
// the user in the capture step (the downstream account flow still gates on a real
// email, so a false "no email needed" here is safe, it just falls through).
//
// Reads env: SHARING_ENABLED, ORCID_EMAIL_ENC_KEY, DATABASE_URL, plus the AUTH_*
// vars used by the session.

import { auth } from "@/lib/sharing/auth";
import { lookupEmailByOrcid } from "@/lib/sharing/directory/db";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  let orcidId: string | null = null;
  let sessionEmail: string | null = null;
  try {
    const session = await auth();
    orcidId = session?.orcidId ?? null;
    sessionEmail = session?.user?.email ?? null;
  } catch {
    return json(200, { orcid: false, needsEmail: false });
  }

  // Not an ORCID session, nothing for the capture step to do.
  if (!orcidId) {
    return json(200, { orcid: false, needsEmail: false });
  }

  // The session already resolved an email (the jwt callback found a binding), so
  // no capture is needed.
  if (sessionEmail) {
    return json(200, { orcid: true, needsEmail: false });
  }

  // No email on the session. Re-check the binding directly so a capture completed
  // this same load (before the token refreshes) is reflected immediately.
  let resolved: string | null = null;
  try {
    resolved = await lookupEmailByOrcid(orcidId);
  } catch {
    // A lookup failure must not trap the user. Report no-email-needed and let the
    // downstream account flow re-gate on a real email.
    return json(200, { orcid: true, needsEmail: false });
  }

  return json(200, { orcid: true, needsEmail: resolved === null });
}
