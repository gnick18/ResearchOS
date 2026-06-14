// Cloud-accounts Phase 2, Chunk 2B: provision-on-demand against the cloud account.
//
// When a signed-in (OAuth) account-first user who has NO E2E keypair yet takes a
// first action that needs keys (sharing, publishing to the directory), this mints
// a keypair on the device, publishes ONLY the public keys plus the encrypted
// backup blob to the directory (via the existing OAuth bind), parks the keys in
// the session + at-rest vault, and hands back the recovery words for a one-time
// "save these" kit. NO data folder is involved (the folderless sibling of the
// folder-based createLocalIdentity, with no sidecar write).
//
// The crypto is reused verbatim from setup.ts, so the payload + signature this
// builds are byte-for-byte the ones /api/directory/oauth-bind reconstructs and
// verifies:
//   - createIdentityMaterial() mints the keypair + recovery-words-wrapped backup
//     envelope (the same v2 key_backup_blob the folder path uploads).
//   - buildBindRequest() canonicalizes the session email, builds the v2 binding
//     payload (buildBindingPayload), and signs it with the just-minted Ed25519
//     private key. The route re-derives the SAME bytes from the session email and
//     verifies the signature before storing the binding.
//
// The recovery words are returned to the UI to show ONCE and are NEVER sent to
// the server; only the mnemonic-wrapped blob (which the server cannot read) goes
// up. Private keys are never logged or transmitted.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { decodePublicKey, type IdentityKeys } from "./keys";
import {
  type IdentityMaterial,
  buildBindRequest,
  createIdentityMaterial,
} from "./setup";
import { generateDeviceSalt, type KdfParams } from "./backup";
import { persistKeysAtRest } from "./device-vault";
import { setSessionIdentity } from "./session-key";
import { mnemonicToRecoveryCode } from "./recovery-code";

/** The session shape the auth endpoint returns; we only read the email. */
interface SessionShape {
  user?: { email?: string | null; name?: string | null } | null;
}

/** A typed outcome so the UI can show the right message without parsing strings. */
export type ProvisionResult =
  | {
      ok: true;
      /** Shown once: the friendlier base32 rendering of the recovery secret. */
      recoveryCode: string;
      /** Shown once: the 12 words (same secret). NEVER persisted or sent up. */
      recoveryWords: string;
      /** The new identity's Ed25519 fingerprint, for the recovery-confirm stamp. */
      fingerprint: string;
    }
  | { ok: false; reason: "unauthorized" | "offline" | "publish-failed" };

export interface ProvisionOptions {
  /** Optional display name to seed the directory profile (route upserts it). */
  displayName?: string;
  /**
   * Argon2id cost params for wrapping the private bundle under the recovery
   * words. Defaults to PROD_KDF_PARAMS (heavy, run off the paint path). Tests
   * pass fast params.
   */
  params?: KdfParams;
}

/**
 * Reassembles the live IdentityKeys from the freshly minted material. The public
 * halves are decoded from their hex, the private halves are the raw bytes the
 * material already holds. Used to park the keys in the session + at-rest vault.
 */
function keysFromMaterial(material: IdentityMaterial): IdentityKeys {
  return {
    encryption: {
      publicKey: decodePublicKey(material.x25519PublicKey),
      privateKey: material.x25519PrivateKey,
    },
    signing: {
      publicKey: decodePublicKey(material.ed25519PublicKey),
      privateKey: material.ed25519PrivateKey,
    },
  };
}

/** Reads the OAuth-verified email from the session endpoint, or null when absent. */
async function fetchSessionEmail(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const session = (await res.json()) as SessionShape;
    return session?.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Provisions a fresh E2E keypair for a signed-in account-first user and publishes
 * it to the directory. On success returns the recovery words/code to show ONCE.
 *
 * Sequence:
 *   1. Read the OAuth-verified email from the session (the route re-reads it
 *      server-side, so we must sign over the SAME canonical email; missing email
 *      means the caller is not signed in -> unauthorized).
 *   2. Mint the keypair + recovery-words-wrapped backup envelope.
 *   3. Build + sign the v2 binding payload over the canonical email, exactly as
 *      the folder publish path does (buildBindRequest), so the server signature
 *      check passes unchanged.
 *   4. POST /api/directory/oauth-bind (authed by the OAuth session) with the
 *      public keys, the key_backup_blob envelope, the signature, and issuedAt.
 *   5. Only on a successful publish, park the keys in the session + at-rest vault
 *      (a key the directory does not know about would be useless), and return the
 *      recovery words for the one-time kit.
 *
 * Never throws on an expected failure; returns a typed result. PERFORMANCE: step
 * 2 runs Argon2id (heavy under PROD params), so the UI calls this off the paint
 * path with a spinner shown.
 */
export async function provisionDeviceKeyForAccount(
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  // 1. The email proves nothing on its own (the server trusts only its own
  // session), but the client must sign over the SAME canonical email the server
  // reconstructs, so we need it here. No email means no signed-in session.
  const email = await fetchSessionEmail();
  if (!email) {
    return { ok: false, reason: "unauthorized" };
  }

  // 2. Mint the keypair and the recovery-words-wrapped backup envelope. The
  // recovery words live only in this material object and the returned result;
  // they never go to the server.
  const material = createIdentityMaterial({ params: options.params });

  // 3. Build + sign the bind request exactly as the folder publish path does, so
  // the bytes match what /api/directory/oauth-bind reconstructs and verifies.
  const issuedAt = new Date().toISOString();
  const bind = buildBindRequest({
    email,
    x25519PublicKey: material.x25519PublicKey,
    ed25519PublicKey: material.ed25519PublicKey,
    ed25519PrivateKey: material.ed25519PrivateKey,
    backupBlob: material.backupBlob,
    issuedAt,
  });

  // The display name rides outside the signed payload; the route upserts the
  // profile from it. Blank -> omitted so no empty profile is created.
  const displayName = options.displayName?.trim() || undefined;
  const body = displayName ? { ...bind, displayName } : bind;

  // 4. Publish. The OAuth session authenticates the call; the body carries NO
  // email and NO private material (only public keys + the encrypted blob).
  let res: Response;
  try {
    res = await fetch("/api/directory/oauth-bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }

  if (res.status === 401) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok) {
    // 400 (rejected binding), 429 (rate limited), or 5xx all surface as a
    // publish failure the user can retry.
    return { ok: false, reason: "publish-failed" };
  }

  // 5. The directory now vouches for these keys, so make them live and persist
  // them at rest (encrypted) so a reload survives without re-entering words.
  const keys = keysFromMaterial(material);
  setSessionIdentity({ keys, deviceSalt: generateDeviceSalt() });
  await persistKeysAtRest(keys);

  // The recovery code is the friendlier base32 rendering of the SAME 12-word
  // secret (derived locally, never sent up). Both are shown once in the kit.
  return {
    ok: true,
    recoveryCode: mnemonicToRecoveryCode(material.recoveryWords),
    recoveryWords: material.recoveryWords,
    fingerprint: material.fingerprint,
  };
}
