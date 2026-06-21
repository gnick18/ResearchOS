// Public researcher-labs endpoint for the /u/[handle] profile page.
//
// GET /api/account/public/labs?handle=<handle>
//   No auth. Returns the publicly-listed labs a researcher actively belongs to
//   (as member or PI), with each lab's name, institution, slug, and whether
//   the researcher is the PI.
//
//   Only LISTED labs (directory_labs.listed = true) are returned. A lab that
//   is not publicly listed is omitted entirely; a listed lab without a companion
//   site (no lab_sites row) is returned with slug=null (no public link).
//
//   The owner_key is resolved server-side and is NEVER returned.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { json } from "@/lib/sharing/directory/guard";
import { normalizeHandle, ensureAccountProfileSchema } from "@/lib/account/account-profile";
import { getResearcherPublicLabs } from "@/lib/account/researcher-labs";
import { LAB_SITES_ENABLED } from "@/lib/social/config";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // Guard: if lab sites are not enabled, the section is inert. Return an empty
  // list so the profile renders nothing without erroring. This mirrors the
  // LAB_SITES_ENABLED client gate in the profile page.
  if (!LAB_SITES_ENABLED) {
    return json(200, { labs: [] });
  }

  const handle = normalizeHandle(
    new URL(request.url).searchParams.get("handle") ?? "",
  );
  if (!handle) return json(400, { error: "handle is required" });

  try {
    await ensureAccountProfileSchema();
    const labs = await getResearcherPublicLabs(handle);
    return json(200, { labs });
  } catch {
    // Degrade gracefully: the profile still renders without the Labs section.
    return json(200, { labs: [] });
  }
}
