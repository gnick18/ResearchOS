// Lab-tier reload-reconnect: local cache of the PUBLIC sealed key artifacts.
//
// Gated by NEXT_PUBLIC_LAB_RELOAD_RECONNECT (see config.ts). When a member opens
// their lab, openLabKey caches the head-signed lab record plus this member's
// current-generation key envelope here. On a later reload, if the relay (a
// Cloudflare Durable Object, separate infra from the Vercel auth endpoint) is
// briefly unreachable, openLabKey re-derives the lab key from this cache instead
// of bouncing a still-authenticated member to the "Sign in to your lab" gate.
//
// SECURITY: the 32-byte lab key is NEVER stored here. Both the record and the
// envelope are exactly what a blind relay serves to anyone who can fetch the lab;
// the envelope is a sealed-box ciphertext that only this member's X25519 private
// key can open, and that private key lives only in the in-memory session (it is
// itself persisted only wrapped under a non-extractable AES-GCM key in the device
// vault). So this cache adds no plaintext-secret exposure beyond what already
// exists. The OAuth-email-to-membership binding in openLabKey still runs against
// the cached record, so a stale OAuth session cannot open the lab from cache.
// This mirrors the head-only pending-genesis fallback (lab-genesis-pending.ts),
// generalized to every member.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import type { LabRecord } from "./lab-membership";
import type { LabKeyEnvelope } from "./lab-key";

/** The public sealed artifacts needed to re-derive a member's lab key offline. */
export interface CachedLabEnvelope {
  labId: string;
  /** The head-signed lab record (roster + key-generation history). */
  record: LabRecord;
  /** This member's sealed copy of the current key generation. */
  envelope: LabKeyEnvelope;
}

/** Persists the public sealed artifacts for the lab this user just opened. */
export async function saveLabEnvelopeCache(
  username: string,
  cached: CachedLabEnvelope,
): Promise<void> {
  await patchUserSettings(username, { lab_envelope_cache: cached });
}

/** Reads the cached sealed artifacts for a user, or null when none is stored. */
export async function readLabEnvelopeCache(
  username: string,
): Promise<CachedLabEnvelope | null> {
  const settings = await readUserSettings(username);
  return settings.lab_envelope_cache ?? null;
}

/**
 * Clears the cached artifacts. patchUserSettings merges the patch and writes via
 * fileService.writeJson; an undefined field is dropped by JSON.stringify, so
 * setting it to undefined removes it from disk and readLabEnvelopeCache then
 * returns null. Call this on logout so a different user on the same folder never
 * inherits a stale envelope.
 */
export async function clearLabEnvelopeCache(username: string): Promise<void> {
  await patchUserSettings(username, { lab_envelope_cache: undefined });
}
