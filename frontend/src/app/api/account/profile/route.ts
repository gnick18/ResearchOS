// Cloud-accounts Phase 1 (Chunk B): the account's own profile (@handle + name).
//
// GET  /api/account/profile  -> { profile | null, suggestedHandle }
//   Authenticated by the OAuth session. Returns the caller's account profile, or
//   null with a suggested free handle (derived from their email) if unclaimed.
//
// POST /api/account/profile  body { handle, displayName?, affiliation? }
//   Claims/updates the caller's @handle + profile. Validated + uniqueness
//   enforced. NO keypair or client signature: the OAuth session IS the proof,
//   the owner key is derived server-side from the verified email (the cloud,
//   device-independent account model).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import {
  ensureAccountProfileSchema,
  getAccountProfile,
  upsertAccountProfile,
  suggestHandle,
} from "@/lib/account/account-profile";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  try {
    await ensureAccountProfileSchema();
    const profile = await getAccountProfile(ownerKey);
    if (profile) return json(200, { profile });
    const suggestedHandle = await suggestHandle(email);
    return json(200, { profile: null, suggestedHandle });
  } catch {
    return json(500, { error: "could not read your profile" });
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  let body: {
    handle?: unknown;
    displayName?: unknown;
    affiliation?: unknown;
    avatarUrl?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const handle = typeof body.handle === "string" ? body.handle : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() || null : null;
  const affiliation =
    typeof body.affiliation === "string" ? body.affiliation.trim() || null : null;
  if (!handle) return json(400, { error: "a handle is required" });

  // Phase 3 Chunk 3A: the avatar is optional. Omit the key to leave the existing
  // avatar untouched; send a data URL to set it, or null to clear it. The cap +
  // MIME check are enforced authoritatively in upsertAccountProfile.
  const hasAvatar = Object.prototype.hasOwnProperty.call(body, "avatarUrl");
  const avatarUrl = hasAvatar
    ? typeof body.avatarUrl === "string"
      ? body.avatarUrl
      : null
    : undefined;

  try {
    await ensureAccountProfileSchema();
    const result = await upsertAccountProfile(ownerKey, {
      handle,
      displayName,
      affiliation,
      ...(hasAvatar ? { avatarUrl } : {}),
    });
    if (!result.ok) return json(409, { error: result.error });
    return json(200, { ok: true, profile: result.profile });
  } catch {
    return json(500, { error: "could not save your profile" });
  }
}
