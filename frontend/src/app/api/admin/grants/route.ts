// Operator control for gift pools (allowance grants to beta testers etc).
//
// GET    /api/admin/grants   list every grant (newest first).
// POST   /api/admin/grants   { email, bonusGb, bonusWritesMillions, note?, expiresAt? }
//                            issue a gift pool to that email's owner key.
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
} from "@/lib/billing/grants";

export const runtime = "nodejs";

const WRITES_PER_MILLION = 1_000_000;

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
    bonusGb?: unknown;
    bonusWritesMillions?: unknown;
    note?: unknown;
    expiresAt?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const bonusGb = Number(body.bonusGb);
  const bonusWritesMillions = Number(body.bonusWritesMillions);
  if (!email) return json(400, { error: "email is required" });
  if (!Number.isFinite(bonusGb) || bonusGb < 0) {
    return json(400, { error: "bonusGb must be a non-negative number" });
  }
  if (!Number.isFinite(bonusWritesMillions) || bonusWritesMillions < 0) {
    return json(400, { error: "bonusWritesMillions must be non-negative" });
  }
  // Validate the optional expiry as a parseable date.
  let expiresAt: string | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const t = Date.parse(body.expiresAt);
    if (Number.isNaN(t)) return json(400, { error: "expiresAt is not a date" });
    expiresAt = new Date(t).toISOString();
  }

  try {
    await ensureGrantsSchema();
    const id = await issueGrant({
      ownerKey: ownerKeyForEmail(email),
      bonusBytes: Math.round(bonusGb * BYTES_PER_GB),
      bonusWrites: Math.round(bonusWritesMillions * WRITES_PER_MILLION),
      label: email,
      note: typeof body.note === "string" ? body.note.trim() || null : null,
      expiresAt,
    });
    return json(200, { ok: true, id });
  } catch {
    return json(500, { error: "issue failed" });
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
