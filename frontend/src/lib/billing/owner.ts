// Flat-plan billing, the owner key.
//
// Billing keys a paying lab by the SAME peppered email hash the directory and
// relay use, so a purchased quota and the storage enforcement line up on one
// identifier and no plaintext email is stored in the billing tables. Stripe
// still holds the customer email for receipts; our tables hold only the hash.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { getPepper } from "@/lib/sharing/directory/guard";

/** The peppered hash of an email, the billing/quota owner key. */
export function ownerKeyForEmail(email: string): string {
  return hashEmail(canonicalizeEmail(email), getPepper());
}

/**
 * Same as ownerKeyForEmail, but returns null instead of throwing when the hash
 * cannot be computed (the usual cause is a missing DIRECTORY_HMAC_PEPPER on the
 * server). Callers should treat null as a clean 503 rather than letting the throw
 * escape as an opaque empty 500. The real error is logged server-side so a
 * misconfig is debuggable.
 */
export function ownerKeyForEmailSafe(email: string): string | null {
  try {
    return ownerKeyForEmail(email);
  } catch (e) {
    console.error(
      "[billing] could not hash the owner key (is DIRECTORY_HMAC_PEPPER set?):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
