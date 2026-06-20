// Operator control for gift pools (allowance grants to beta testers etc).
//
// GET    /api/admin/grants   list every grant (newest first).
// POST   /api/admin/grants   issue a gift pool. Two resolution paths:
//   { email, ... }           resolve email -> ownerKey (original flow).
//   { ownerKey, ... }        use the ownerKey directly (roster-row gift flow).
//   Both accept: bonusGb, bonusWritesMillions, note?, expiresAt?, giftTier?,
//   months?. When giftTier is set, months is required (no permanent comped
//   tiers, decision 3). expiresAt from months takes precedence over raw
//   expiresAt. Providing both email and ownerKey is an error (prevents silent
//   identity mismatch).
// DELETE /api/admin/grants   { id }   revoke a grant.
//
// Operator-only, gated exactly like /api/admin/breaker (an unknown email gets a
// 404). A grant lifts the owner's storage + activity allowance for free; on a
// PI's email it lifts the whole lab pool (the pool resolves to the PI key). The
// grant data can be seeded now and takes effect once BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { BYTES_PER_GB } from "@/lib/billing/config";
import {
  ensureGrantsSchema,
  issueGrant,
  listGrants,
  revokeGrant,
  type GiftTier,
} from "@/lib/billing/grants";

export const runtime = "nodejs";

const WRITES_PER_MILLION = 1_000_000;
const VALID_GIFT_TIERS: GiftTier[] = ["solo", "lab", "dept"];

async function gate(): Promise<Response | null> {
  const blocked = await requireOperator();
  if (blocked) return blocked;
  return null;
}

export async function GET(): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;
  try {
    await ensureGrantsSchema();
    return json(200, { grants: await listGrants() });
  } catch {
    return json(500, { error: "list failed" });
  }
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: {
    email?: unknown;
    ownerKey?: unknown;
    bonusGb?: unknown;
    bonusWritesMillions?: unknown;
    note?: unknown;
    expiresAt?: unknown;
    giftTier?: unknown;
    months?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const rawOwnerKey = typeof body.ownerKey === "string" ? body.ownerKey.trim() : "";

  // Exactly one identity source must be provided. Accepting both would allow a
  // silent mismatch where the caller passes an email for display but an
  // unrelated ownerKey for the actual write.
  if (email && rawOwnerKey) {
    return json(400, { error: "Provide email or ownerKey, not both." });
  }
  if (!email && !rawOwnerKey) {
    return json(400, { error: "email or ownerKey is required" });
  }

  const bonusGb = Number(body.bonusGb);
  const bonusWritesMillions = Number(body.bonusWritesMillions);
  if (!Number.isFinite(bonusGb) || bonusGb < 0) {
    return json(400, { error: "bonusGb must be a non-negative number" });
  }
  if (!Number.isFinite(bonusWritesMillions) || bonusWritesMillions < 0) {
    return json(400, { error: "bonusWritesMillions must be non-negative" });
  }

  // Resolve the comped tier (optional). Must be one of the three valid tiers.
  let giftTier: GiftTier | null = null;
  if (body.giftTier !== undefined && body.giftTier !== null && body.giftTier !== "") {
    if (!VALID_GIFT_TIERS.includes(body.giftTier as GiftTier)) {
      return json(400, {
        error: `giftTier must be one of: ${VALID_GIFT_TIERS.join(", ")}`,
      });
    }
    giftTier = body.giftTier as GiftTier;
  }

  // Resolve the expiry. When months is provided, compute from now; when a raw
  // expiresAt string is provided use that. When giftTier is set, one of these
  // must resolve to a date (no permanent comped tiers, decision 3).
  let expiresAt: string | null = null;
  const months = Number(body.months);
  if (Number.isFinite(months) && months > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() + Math.round(months));
    expiresAt = d.toISOString();
  } else if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const t = Date.parse(body.expiresAt);
    if (Number.isNaN(t)) return json(400, { error: "expiresAt is not a date" });
    expiresAt = new Date(t).toISOString();
  }

  // Decision 3: a comped tier requires a fixed duration.
  if (giftTier && !expiresAt) {
    return json(400, {
      error:
        "A comped tier requires a month count. Permanent comped tiers are not " +
        "allowed (Grant 2026-06-19, decision 3). Provide months (e.g. 12).",
    });
  }

  // At least one thing must be gifted.
  const hasAllowance = bonusGb > 0 || bonusWritesMillions > 0;
  if (!giftTier && !hasAllowance) {
    return json(400, {
      error: "Provide bonusGb, bonusWritesMillions, or a giftTier.",
    });
  }

  // Resolve ownerKey. When the caller passes ownerKey directly (the roster-row
  // gift path), use it as-is and record the key itself as the label so the
  // admin roster stays readable. When the caller passes email (the existing
  // GiftPoolsPanel path), hash it to the owner key and use the email as the
  // label. The two paths are mutually exclusive (validated above).
  const resolvedOwnerKey = rawOwnerKey || ownerKeyForEmail(email);
  const label = email || rawOwnerKey;

  try {
    await ensureGrantsSchema();
    const id = await issueGrant({
      ownerKey: resolvedOwnerKey,
      bonusBytes: Math.round(bonusGb * BYTES_PER_GB),
      bonusWrites: Math.round(bonusWritesMillions * WRITES_PER_MILLION),
      label,
      note: typeof body.note === "string" ? body.note.trim() || null : null,
      expiresAt,
      giftTier,
    });
    return json(200, { ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "issue failed";
    return json(500, { error: msg });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json(400, { error: "valid id required" });
  }

  try {
    await revokeGrant(id);
    return json(200, { ok: true });
  } catch {
    return json(500, { error: "revoke failed" });
  }
}
