// Metered-storage billing, lab roster management (the PI side).
//
// POST   /api/billing/lab/members   body { email }   invite a member to the lab.
// DELETE /api/billing/lab/members   body { email }   remove a member or rescind
//                                                     an invite.
//
// The PI invites by email; we resolve it to the peppered owner-key hash and never
// store the address. The member must accept (see ./respond) before the lab starts
// paying for them. Removing a member reverts them to individual billing; nothing
// is deleted from their storage.
//
// Dark unless BILLING_ENABLED is on. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, getSubscription } from "@/lib/billing/db";
import { ensureLabSchema, inviteMember, removeMember } from "@/lib/billing/lab";

export const runtime = "nodejs";

async function callerKey(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  return email ? ownerKeyForEmail(email) : null;
}

function memberKeyFromBody(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!email || !email.includes("@")) return null;
  return ownerKeyForEmail(email);
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const ownerKey = await callerKey();
  if (!ownerKey) return json(401, { error: "sign in required" });

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const memberKey = memberKeyFromBody(body.email);
  if (!memberKey) return json(400, { error: "a valid member email is required" });
  if (memberKey === ownerKey) {
    return json(400, { error: "you cannot invite yourself" });
  }

  try {
    await ensureBillingSchema();
    await ensureLabSchema();

    // Only a PI with an active subscription can sponsor members.
    const sub = await getSubscription(ownerKey);
    if (sub?.status !== "active") {
      return json(409, {
        error: "Add a payment method first to sponsor your lab.",
        needsCheckout: true,
      });
    }

    await inviteMember(ownerKey, memberKey);
    return json(200, { ok: true, invited: memberKey });
  } catch {
    return json(500, { error: "invite failed" });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const ownerKey = await callerKey();
  if (!ownerKey) return json(401, { error: "sign in required" });

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const memberKey = memberKeyFromBody(body.email);
  if (!memberKey) return json(400, { error: "a valid member email is required" });

  try {
    await ensureLabSchema();
    await removeMember(ownerKey, memberKey);
    return json(200, { ok: true, removed: memberKey });
  } catch {
    return json(500, { error: "remove failed" });
  }
}
