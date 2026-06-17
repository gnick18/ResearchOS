// Operator-only CLEAR CLOUD SETTINGS (POST /api/admin/accounts/clear-settings).
//
// Body: { ownerKey?, email?, confirm: true }. Deletes ONE identity's
// account_settings row (the E2E account-scoped settings blob). A plain
// server-side row delete keyed by owner_key, no E2E key needed, the row is just
// ciphertext we cannot read anyway. After this the user falls back to
// folder-local settings, exactly as if they had never lifted, which un-sticks an
// account whose blob got polluted (the Owen lift misfire). Unlike the full wipe
// this touches ONLY account_settings, nothing else. Gated on ADMIN_EMAILS.
// Idempotent (0 rows when the user had none).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import {
  deleteAccountSettings,
  ensureAccountSettingsSchema,
} from "@/lib/account/account-settings-db";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const blocked = await requireOperator();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json body" });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  if (input.confirm !== true) {
    return json(400, { error: "confirm must be true to clear cloud settings" });
  }

  // Resolve the target identity. An explicit ownerKey wins, otherwise hash the
  // email with the same key billing + the directory use.
  let ownerKey: string | null =
    typeof input.ownerKey === "string" && input.ownerKey.trim()
      ? input.ownerKey.trim()
      : null;
  if (!ownerKey && typeof input.email === "string" && input.email.trim()) {
    ownerKey = ownerKeyForEmailSafe(input.email.trim());
  }
  if (!ownerKey) {
    return json(400, { error: "an ownerKey or email is required" });
  }

  try {
    await ensureAccountSettingsSchema();
    const cleared = await deleteAccountSettings(ownerKey);
    return json(200, { ok: true, ownerKey, cleared });
  } catch {
    return json(500, { error: "clear failed" });
  }
}
