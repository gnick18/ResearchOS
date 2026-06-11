// Shared operator gate (server-only).
//
// An operator is anyone whose signed-in OAuth email is on ADMIN_EMAILS, OR who
// holds a valid operator access-code cookie (see operator-token.ts). Every
// /api/admin/* route gates on this so the access code and the OAuth login are
// interchangeable. Fails closed.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { cookies } from "next/headers";
import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { json } from "@/lib/sharing/directory/guard";
import { OPERATOR_COOKIE, verifyOperatorToken } from "./operator-token";

/** True when a valid, unexpired operator access-code cookie is present. */
export async function hasValidOperatorCookie(): Promise<boolean> {
  try {
    const store = await cookies();
    return verifyOperatorToken(store.get(OPERATOR_COOKIE)?.value);
  } catch {
    return false;
  }
}

/** Operator if the OAuth email is allow-listed OR a valid access-code cookie is
 *  present. */
export async function isOperator(): Promise<boolean> {
  try {
    const session = await auth();
    if (isAdminEmail(session?.user?.email)) return true;
  } catch {
    // fall through to the cookie check
  }
  return hasValidOperatorCookie();
}

/**
 * Gate for operator routes. Returns a 404 Response to short-circuit the handler
 * when the caller is not an operator, or null to proceed. Returning a Response
 * (rather than a boolean) makes the gate fail closed even if a caller forgets to
 * await it. Callers keep their own isSharingEnabled() check where they have one.
 */
export async function requireOperator(): Promise<Response | null> {
  return (await isOperator()) ? null : json(404, { error: "not found" });
}
