// Operator endpoint to STAGE a lab for a PI (staged-pi-provisioning lane).
//
// POST /api/admin/lab-provision/stage
//   Body: { email, labName, institution?, slug, compTier, compMonths }
//   Operator-only (requireOperator gate, an unknown caller gets a 404).
//
// The operator types a PI raw email; the server hashes it to the peppered owner
// key (the SAME identifier the directory, relay, and billing use), reserves the
// slug to that hash, issues a comped-tier grant on that key, and records the
// staging row. When the PI signs in once, their client genesis consumes all of
// this (see /api/directory/labs/provision/consume). The server never sees the PI
// private keys; only this PUBLIC metadata is staged.
//
// Order matters: validate + reserve the slug FIRST, and only issue the grant once
// the slug is ours. A failed slug reserve must not leave a dangling comp grant.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureGrantsSchema, issueGrant } from "@/lib/billing/grants";
import { reserveSlug } from "@/lib/social/slug-registry-db";
import {
  upsertProvisionStaging,
  type CompTier,
} from "@/lib/lab/provision-staging-db";

export const runtime = "nodejs";

const VALID_COMP_TIERS: CompTier[] = ["solo", "lab", "dept"];

export async function POST(request: Request): Promise<Response> {
  // Match the grants route gating: operator-only, plus the sharing-enabled check
  // so the route is inert when the social/directory surface is off.
  const blocked = await requireOperator();
  if (blocked) return blocked;
  if (!isSharingEnabled()) return json(404, { error: "not found" });

  let body: {
    email?: unknown;
    labName?: unknown;
    institution?: unknown;
    slug?: unknown;
    compTier?: unknown;
    compMonths?: unknown;
    piTitle?: unknown;
    piDisplay?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const labName = typeof body.labName === "string" ? body.labName.trim() : "";
  const institution =
    typeof body.institution === "string" ? body.institution.trim() || null : null;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const piTitle =
    typeof body.piTitle === "string" ? body.piTitle.trim() || null : null;
  const piDisplay =
    typeof body.piDisplay === "string" ? body.piDisplay.trim() || null : null;

  if (!email) return json(400, { error: "email is required" });
  if (!labName) return json(400, { error: "labName is required" });
  if (!slug) return json(400, { error: "slug is required" });

  // Comp tier must be one of the three giftable tiers.
  let compTier: CompTier | null = null;
  if (
    body.compTier !== undefined &&
    body.compTier !== null &&
    body.compTier !== ""
  ) {
    if (!VALID_COMP_TIERS.includes(body.compTier as CompTier)) {
      return json(400, {
        error: `compTier must be one of: ${VALID_COMP_TIERS.join(", ")}`,
      });
    }
    compTier = body.compTier as CompTier;
  }
  if (!compTier) return json(400, { error: "compTier is required" });

  // Months must be a positive integer. A comped tier is always time-bounded (no
  // permanent comps, billing decision 3), so the operator must say how long.
  const compMonths = Number(body.compMonths);
  if (!Number.isFinite(compMonths) || compMonths <= 0) {
    return json(400, {
      error: "compMonths must be a positive number (no permanent comps)",
    });
  }
  const months = Math.round(compMonths);

  // Compute the PI owner key from the raw email (peppered HMAC, the same key the
  // directory and billing use). A missing pepper throws; surface a clean 503.
  let piEmailHash: string;
  try {
    piEmailHash = ownerKeyForEmail(email);
  } catch {
    return json(503, { error: "server not configured (missing pepper)" });
  }

  // Reserve the slug FIRST, keyed to the PI email hash. The slug is the PK so the
  // reserve is atomic; a slug already held by SOMEONE ELSE returns "taken". If the
  // PI already holds this exact slug (an idempotent re-stage), reserveSlug returns
  // "taken" too because the row exists; we treat that as authorized only when the
  // existing owner is this PI, so a re-stage of the same PI + slug succeeds.
  let reserved;
  try {
    reserved = await reserveSlug(slug, "lab", piEmailHash, piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!reserved.ok) {
    if (reserved.reason === "invalid") {
      return json(400, { error: "invalid slug", message: reserved.error });
    }
    // reason === "taken". Allow it only when the slug is already reserved to THIS
    // PI (a re-stage). Any other owner is a real conflict.
    const { getSlug } = await import("@/lib/social/slug-registry-db");
    let owner: string | null = null;
    try {
      const row = await getSlug(slug);
      owner = row?.ownerKey ?? null;
    } catch {
      return json(503, { error: "store unavailable" });
    }
    if (owner !== piEmailHash) {
      return json(409, { error: "slug taken" });
    }
    // The slug is already ours; fall through to the grant + staging upsert.
  }

  // Issue the comped-tier grant on the PI owner key. months -> expiresAt mirrors
  // the admin grants route. issueGrant throws if a tier is set without expiresAt,
  // which cannot happen here (months is validated > 0).
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  const expiresAt = d.toISOString();
  try {
    await ensureGrantsSchema();
    await issueGrant({
      ownerKey: piEmailHash,
      bonusBytes: 0,
      bonusWrites: 0,
      label: email,
      note: "staged PI provision",
      expiresAt,
      giftTier: compTier,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "grant failed";
    return json(500, { error: msg });
  }

  // Record the staging row (upsert, so a re-stage replaces it and resets to
  // pending). This is the trigger the PI client polls for on first sign-in.
  try {
    await upsertProvisionStaging({
      piEmailHash,
      labName,
      institution,
      slug,
      compTier,
      compMonths: months,
      piTitle,
      piDisplay,
    });
  } catch {
    return json(500, { error: "staging write failed" });
  }

  return json(200, { ok: true });
}
