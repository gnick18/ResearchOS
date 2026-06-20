// PI-side lookup for a pending staged lab (staged-pi-provisioning lane).
//
// GET /api/directory/labs/provision/pending
//   Session-auth (signed-in user). The server hashes the SESSION email to the PI
//   owner key and returns the staging row ONLY when one exists with
//   status='pending'. The email hash is derived server-side from the session, so
//   a caller can never read another user's staging (no email or hash is accepted
//   from the body or query).
//
//   Shape: { pending: { labName, institution, slug, piTitle, piDisplay } | null }
//
// This is the trigger the client boot-resume (LabProvisionResume) polls on first
// sign-in. It returns only the cosmetic branding the genesis needs; the comp tier
// and months are not surfaced (the grant was already issued at stage time and the
// client does not need them).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getProvisionStaging } from "@/lib/lab/provision-staging-db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "unauthorized" });

  let piEmailHash: string;
  try {
    piEmailHash = ownerKeyForEmail(email);
  } catch {
    return json(503, { error: "server not configured (missing pepper)" });
  }

  let staging;
  try {
    staging = await getProvisionStaging(piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  // Only a fresh (pending) staging is actionable. A consumed row, or no row, both
  // resolve to pending:null so the client does nothing.
  if (!staging || staging.status !== "pending") {
    return json(200, { pending: null });
  }

  return json(200, {
    pending: {
      labName: staging.labName,
      institution: staging.institution,
      slug: staging.slug,
      piTitle: staging.piTitle,
      piDisplay: staging.piDisplay,
    },
  });
}
