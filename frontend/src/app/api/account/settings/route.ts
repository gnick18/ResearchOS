// Account-scoped settings, the cloud API (Phase 1).
//
// GET  /api/account/settings  -> { ciphertext | null, blobVersion? }
//   Returns the caller's stored E2E ciphertext (or null if they have none yet).
//   The server NEVER decrypts; the client holds the only key (derived from its
//   identity, account-settings-crypto.ts).
//
// PUT  /api/account/settings  body { ciphertext, blobVersion }
//   Stores the client-sealed ciphertext verbatim. The server validates only that
//   the field is a non-empty string of a sane length; it cannot read it.
//
// Authenticated by the OAuth session. The owner key is derived server-side from
// the verified email (ownerKeyForEmail), the same key the directory + billing
// use, so no plaintext email is stored.
//
// FAILS CLOSED: when NEXT_PUBLIC_ACCOUNT_SETTINGS is off, both verbs 404, so a
// deploy that has not enabled the surface behaves byte-for-byte as before.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { isAccountSettingsEnabled } from "@/lib/account/account-settings-config";
import {
  ensureAccountSettingsSchema,
  getAccountSettings,
  putAccountSettings,
} from "@/lib/account/account-settings-db";

export const runtime = "nodejs";

// Generous upper bound on the stored ciphertext, so a buggy or hostile client
// cannot park an unbounded blob. The Phase 1 fields (a handful of calendar feeds
// plus a boolean) are tiny; 256 KB leaves ample headroom for the Phase 2 field
// set while still capping abuse.
const MAX_CIPHERTEXT_LENGTH = 256 * 1024;

export async function GET(): Promise<Response> {
  // Fail closed: the whole surface is dark unless the flag is on.
  if (!isAccountSettingsEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  try {
    await ensureAccountSettingsSchema();
    const row = await getAccountSettings(ownerKey);
    if (!row) return json(200, { ciphertext: null });
    return json(200, {
      ciphertext: row.ciphertext,
      blobVersion: row.blobVersion,
    });
  } catch {
    return json(503, { error: "account settings store unavailable" });
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!isAccountSettingsEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const ciphertext = (body as { ciphertext?: unknown })?.ciphertext;
  const blobVersionRaw = (body as { blobVersion?: unknown })?.blobVersion;
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    return json(400, { error: "ciphertext is required" });
  }
  if (ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    return json(413, { error: "ciphertext too large" });
  }
  const blobVersion =
    typeof blobVersionRaw === "number" && Number.isFinite(blobVersionRaw)
      ? Math.max(1, Math.floor(blobVersionRaw))
      : 1;

  try {
    await ensureAccountSettingsSchema();
    await putAccountSettings(ownerKey, ciphertext, blobVersion);
    return json(200, { ok: true });
  } catch {
    return json(503, { error: "account settings store unavailable" });
  }
}
