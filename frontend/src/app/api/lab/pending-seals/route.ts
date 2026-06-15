// Lab tier Phase 4A: the head reads which token-joined members to consider for a
// deferred lab-data-key seal.
//
// GET /api/lab/pending-seals
//   Authenticated. The signed-in caller is the lab head; we key off their
//   session-derived owner key (which IS the lab's billing owner). Returns the
//   email labels of the lab's ACTIVE billing members, so the head's browser can
//   resolve each one's published X25519 pubkey from the directory and seal the
//   lab key to them client-side (the actual reconciliation, lab-deferred-seal-
//   reconcile.ts).
//
//   The head already possesses these addresses (they invited or sponsor each
//   member), so returning them to the head leaks nothing new, same privacy stance
//   as the dept roster. NO key material is involved here at all; this route never
//   sees or returns anything sealed. The lab DATA KEY never touches the server.
//
// Dark unless LAB_TOKENS_V2 is enabled. Sign-in required.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { isLabTokensV2Enabled } from "@/lib/lab/lab-tokens-config";
import { ensureLabSchema, listLabMembers } from "@/lib/billing/lab";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isLabTokensV2Enabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const headOwnerKey = ownerKeyForEmailSafe(email);
  if (!headOwnerKey) return json(503, { error: "billing identity unavailable" });

  try {
    await ensureLabSchema();
    const members = await listLabMembers(headOwnerKey);
    // Only active members with a stored email label are candidates. The label is
    // the email the member joined with (see /api/lab/join). A blank label means we
    // have no address to resolve a directory pubkey from, so we omit it.
    const emails = members
      .filter((m) => m.status === "active" && m.label && m.label.includes("@"))
      .map((m) => m.label as string);
    return json(200, { ok: true, emails });
  } catch {
    return json(500, { error: "could not read pending seals" });
  }
}
