// Lab slug rename API (Phase PI-slug-rename, social lane).
//
//   POST /api/social/lab-site/rename-slug
//
// Lets a lab head change their lab's public web address to a different, unclaimed
// slug. The old slug is kept as a permanent 308 redirect so existing links and
// paper citations never break. This is additive and alias-only: no labId-keyed
// data (notes, members, R2 objects) is touched.
//
// AUTHZ (same gate as sibling lab-site write routes, fail closed):
//   1. flag       isSharingEnabled() must be true, else 404.
//   2. signed in  callerOwnerKey resolved from the SESSION (resolveCallerOwnerKey),
//                 never the body. No key = 401.
//   3. entitled   isLabPublishEntitled(callerOwnerKey) = true (active paid lab
//                 tier). Not entitled = 403.
//   4. owns lab   rebindLabSlug verifies the lab_sites row belongs to the caller
//                 (old slug matches this ownerKey). Mismatch = 403 / 404.
//
// Body: { labId: string, newSlug: string }
// labId = the billing owner key for the lab (same as callerOwnerKey by
// construction for create-site; we derive it from the session here rather than
// trusting the body).
//
// Status map:
//   200 { ok: true, slug: newSlug }   rename succeeded
//   400                               newSlug is malformed
//   401                               not signed in
//   403                               not entitled OR not the lab owner
//   404                               flag off OR lab not found
//   409                               newSlug already taken (with suggestions)
//   503                               store unavailable
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import { rebindLabSlug } from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import {
  isSlugAvailable,
  normalizeSlug,
  suggestSlugs,
} from "@/lib/social/slug-registry";
import { loadTakenSlugsWithPrefix } from "@/lib/social/slug-registry-db";

export const runtime = "nodejs";

function asRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function parseBody(raw: unknown): { newSlug: string } | null {
  const b = asRecord(raw);
  if (!b) return null;
  if (typeof b.newSlug !== "string" || !b.newSlug.trim()) return null;
  return { newSlug: b.newSlug.trim() };
}

export async function POST(request: Request): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  // A slug rename targets the caller's own lab by construction (a lab is keyed
  // by its billing owner key), matching the create-site authz pattern.
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return json(verdict.status, { error: verdict.error });
  }
  const ownerKey = callerOwnerKey as string;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    rawBody = null;
  }
  const parsed = parseBody(rawBody);
  if (!parsed) return json(400, { error: "invalid request" });

  const newSlug = normalizeSlug(parsed.newSlug);

  // Pre-flight availability check (same pattern as create-site POST). We use
  // the taken-prefix scan to build meaningful suggestions if the slug is taken.
  let taken: Set<string>;
  try {
    taken = await loadTakenSlugsWithPrefix(newSlug);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  if (!isSlugAvailable(newSlug, { taken })) {
    const suggestions = suggestSlugs(newSlug, { taken });
    return json(409, { error: "slug taken", slug: newSlug, suggestions });
  }

  // Derive the old slug from the request body if provided; otherwise
  // rebindLabSlug derives it from the lab_sites row (it verifies ownership
  // by matching lab_sites WHERE lab_owner_key = ownerKey AND lab_slug = oldSlug,
  // so we need the current slug). Accept it from the body for now so the
  // client can pass both; rebindLabSlug is the authoritative owner gate.
  const b = asRecord(rawBody);
  const rawOldSlug = typeof b?.oldSlug === "string" ? b.oldSlug.trim() : "";
  const oldSlug = normalizeSlug(rawOldSlug);
  if (!oldSlug) {
    return json(400, { error: "oldSlug required" });
  }

  let result;
  try {
    result = await rebindLabSlug({ ownerKey, oldSlug, newSlug });
  } catch {
    return json(503, { error: "store unavailable" });
  }

  if (!result.ok) {
    switch (result.reason) {
      case "taken":
        return json(409, { error: "slug taken", slug: newSlug });
      case "invalid":
        return json(400, { error: "invalid slug" });
      case "not-owner":
        return json(403, { error: "forbidden" });
      case "not-found":
        return json(404, { error: "not found" });
    }
  }

  return json(200, { ok: true, slug: newSlug });
}
