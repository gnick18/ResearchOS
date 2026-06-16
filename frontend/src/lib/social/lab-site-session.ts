// Lab companion-site authoring, server session -> owner key resolution
// (lab-domains Phase 3a, social lane).
//
// The ONE place the write routes turn an Auth.js session into the caller's
// billing owner key. Kept out of the pure authoring module so that module stays
// IO-free and unit-testable; this thin shim does the impure part (read the
// session email, hash it to the owner key) and is the single import surface the
// route handlers use.
//
// Mirrors how app/api/directory/profile/route.ts resolves identity: the email is
// read from the SESSION (auth()), never from the request body. The owner key is
// the same peppered email hash billing uses (ownerKeyForEmail), so a lab is
// referenced only by its lab_owner_key and no new identity is minted here.
//
// IMPORTANT: this module only READS from lib/billing/owner (ownerKeyForEmail) and
// lib/sharing/auth (auth). It does not import the directory or identity schema,
// and it does not write anything.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";

/**
 * Resolves the caller's billing owner key from the current Auth.js session, or
 * null when the request is not authenticated with an email (so authorizeWrite
 * fails closed with a 401). The email comes from the proven session, never the
 * body. Returns null rather than throwing on a missing pepper so the route can
 * map it to a clean 401/503 instead of an opaque 500.
 *
 * ORCID-only sessions (no email) cannot own a lab site, because the billing owner
 * key is derived from the email hash; such a session resolves to null here.
 */
export async function resolveCallerOwnerKey(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return ownerKeyForEmailSafe(email);
}
