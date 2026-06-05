// Metered-storage billing, the owner key.
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
