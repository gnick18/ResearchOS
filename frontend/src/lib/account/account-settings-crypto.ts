// Account-scoped settings, the E2E blob crypto (Phase 1).
//
// LOCKED DECISION (Grant 2026-06-17): the account-settings blob is END-TO-END
// ENCRYPTED to the user's identity. Our cloud stores ONLY ciphertext it cannot
// read, keeping the local-first privacy promise intact even though the blob lives
// in our cloud. See docs/proposals/2026-06-17-account-vs-folder-settings.md.
//
// KEY DERIVATION (the crux of the cross-device guarantee):
//   The symmetric key that seals the blob is derived from the user's LONG-LIVED
//   X25519 identity ENCRYPTION private key (identity/keys.ts), the same key the
//   sharing layer already holds. That key is:
//     - present client-side after an unlock (session-key.ts / loadIdentity),
//     - the SAME keypair across every folder the account opens (Phase B reuse,
//       writeIdentityReferenceSidecar),
//     - restorable on ANY device the user signs into, because it is wrapped at
//       rest under the recovery code (sidecar recoveryBlob) AND mirrored to the
//       cloud key backup, both unlocked via OAuth + recovery code.
//   So HKDF over the identity private key yields a key that is deterministic for
//   a given account and reproducible on any device, which is exactly what an
//   E2E account blob needs (the server never sees it, yet the user can read it
//   from a brand-new laptop after restoring their identity).
//
//   We HKDF rather than use the raw private key directly so a distinct,
//   domain-separated subkey seals the settings blob and the identity private key
//   itself never doubles as an AEAD key. The HKDF info string is versioned.
//
// AEAD: XChaCha20-Poly1305, the same audited @noble primitive the sharing seal
// uses (encryption.ts). A fresh random 24-byte nonce per seal is prepended, so
// re-encrypting the same settings never reuses a (key, nonce) pair. The AEAD tag
// makes any tamper (or a wrong key) a hard decrypt failure.
//
// BLOB FORMAT (versioned, so a future construction change is unambiguous):
//   The plaintext is utf8(JSON) of a versioned envelope { v, settings }. The
//   transport ciphertext we hand the server is a base64 string of
//   FORMAT_TAG (1 byte) || nonce (24) || aead_ct. The leading format tag lets a
//   later format be told apart from this one without guessing.
//
// Pure crypto, no network, no storage, no React. Unit-tested for round-trip and
// tamper detection.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  concatBytes,
  randomBytes,
  utf8ToBytes,
} from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64ToBytes, bytesToBase64 } from "@/lib/sharing/identity/backup";

/**
 * The account-scoped settings the blob carries. EVERY field is optional +
 * additive, so an OLDER blob (written before a field existed) merges cleanly and
 * a NEWER reader treats a missing field as "no account default, use folder-local".
 * The merge over folder-local defaults lives in account-settings.ts, NOT here, so
 * this module stays pure crypto + shape.
 *
 * The split (docs/proposals/2026-06-17-account-vs-folder-settings.md): these are
 * PREFERENCES + external CONNECTIONS, never research DATA. Research content,
 * created calendar events, the per-folder lab roster, and the sharing graph stay
 * FOLDER-LOCAL and are deliberately absent here.
 *
 * Phase 1 shipped the first two fields (calendarFeeds + labHead). Phase 2 widens
 * the set to the account-WIDE preferences below: appearance, formatting, the
 * professional-mode + companion + notification preferences, the display name, and
 * the nav defaults (tabs) a folder can still override.
 */
export interface AccountScopedSettings {
  /**
   * The user's external calendar subscriptions (ICS feed URLs + labels +
   * colors), lifted out of the per-folder _calendar-feeds.json so they follow the
   * account. The exact Owen Sullivan case. Shape mirrors the folder store's feed
   * records; kept as a plain array so the crypto layer needs no calendar import.
   */
  calendarFeeds?: AccountCalendarFeed[];
  /**
   * The lab-head / PI CAPABILITY at the account tier. When true the user is a PI
   * regardless of which folder they open (the per-folder context of WHICH lab or
   * class stays folder-local). Direct fix for the new-empty-folder-renders-PI-as-
   * individual bug. Absent / false = not a lab head at the account level (the
   * folder-local account_type can still apply).
   */
  labHead?: boolean;

  // -- Phase 2 account-wide preferences (additive, all optional) --------------

  /**
   * Theme / dark-mode choice ("light" | "dark" | "system"). Theme lives in
   * localStorage per device (use-theme.ts), but the chosen mode is an account
   * preference so it can follow the user to a new machine. Carried as a plain
   * string so this module needs no theme import.
   */
  theme?: string;
  /** Per-task-completion celebration animation the user picked (AnimationType). */
  animationType?: string;
  /** BeakerBot streak-celebration scenes on / off. */
  beakerBotAnimations?: boolean;
  /** Tint the header with the user color vs keep it white. */
  coloredHeader?: boolean;
  /** Date display format ("MDY" | "DMY" | "YMD"). */
  dateFormat?: string;
  /** Time display format ("12h" | "24h"). */
  timeFormat?: string;
  /** Master "quiet the playful surfaces" switch. */
  professionalMode?: boolean;
  /** Show the Companion button in the app header. */
  showCompanionButton?: boolean;
  /** Auto-publish today/inventory/notebook snapshots to paired phones. */
  autoPublishSnapshotsToPhones?: boolean;
  /**
   * Per-category notification + companion routing (bell / laptop / phone / email)
   * plus quiet hours. Carried structurally (an opaque object) so this crypto
   * module does not depend on the notifications layer; account-settings.ts owns
   * the typed shape on the way in and out.
   */
  notificationPreferences?: Record<string, unknown>;
  /** The user's display name (null = use the folder name). */
  displayName?: string | null;
  /**
   * The user's preferred / greeting name ("call me Grant"). Account-scoped so the
   * answer to "what do you like to be called?" follows the user across folders +
   * devices. When set, every greeting surface (the welcome-back splash, BeakerBot)
   * uses it over the display name's first word, so a "Dr. Grant Nickles" display
   * name still greets as "Grant" rather than the honorific "Dr". null / absent =
   * no preferred name, fall back to the honorific-stripped first name.
   */
  preferredName?: string | null;
  /**
   * The default landing tab href, as an ACCOUNT DEFAULT. A folder can still
   * override it locally (the merge only seeds it when the folder has not set its
   * own), so a class folder keeps its own landing choice.
   */
  defaultLandingTab?: string;
  /**
   * The visible-tab href set, as an ACCOUNT DEFAULT. Same override rule as
   * defaultLandingTab, so a per-folder visible-tab choice still wins locally.
   */
  visibleTabs?: string[];
}

/**
 * One external calendar subscription, stored at the account level. A structural
 * copy of the folder feed record (lib/types CalendarFeed) so this crypto module
 * does not depend on the calendar layer. Only ICS feeds are account-scoped.
 */
export interface AccountCalendarFeed {
  id: number;
  provider: string;
  label: string;
  icsUrl: string;
  color: string;
  enabled: boolean;
}

/** The current account-settings blob version. Bumped on a shape change. v2 adds
 *  the Phase 2 account-wide preference fields. Purely ADDITIVE, so a v1 blob (the
 *  Phase 1 calendarFeeds + labHead pair) decrypts + merges cleanly under v2, and a
 *  v2 blob read by a v1 client simply ignores the unknown fields. The version
 *  travels inside the encrypted envelope so a future non-additive migration can
 *  branch on it. */
export const ACCOUNT_BLOB_VERSION = 2;

/**
 * The decrypted, versioned envelope. The version travels INSIDE the encrypted
 * plaintext (not just in the transport tag) so a migration can branch on it
 * after decryption.
 */
export interface AccountSettingsBlob {
  v: number;
  settings: AccountScopedSettings;
}

// Domain-separated HKDF info, versioned. A future key-derivation change bumps the
// suffix so a re-derived key is unambiguously distinct from this one.
const KDF_INFO = utf8ToBytes("researchos.account-settings.kdf.v1");

// HKDF salt. A fixed, public, domain-separating salt is fine here: the input key
// material (the identity private key) is already high-entropy, and a per-blob
// random salt could not be reproduced on another device without storing it
// plaintext server-side, which would defeat the determinism we need. The salt's
// job is domain separation, not secrecy.
const KDF_SALT = utf8ToBytes("researchos.account-settings.salt.v1");

const AEAD_KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

// Transport format tag, the first byte of the pre-base64 bytes. Lets a later
// on-the-wire format be distinguished from this one without guessing.
const FORMAT_TAG_V1 = 0x01;

/**
 * Material the AEAD key is derived from. The 32-byte X25519 identity ENCRYPTION
 * private key (identity.keys.encryption.privateKey). Callers pass this straight
 * from the unlocked session identity, never from disk.
 */
export type IdentityKeyMaterial = Uint8Array;

/**
 * Derives the per-account AEAD key from the identity private key via HKDF-SHA256.
 * Deterministic for a given key, so any device that has restored the identity
 * derives the SAME key and can decrypt the blob. Domain-separated by info + salt.
 *
 * @throws if the key material is not exactly 32 bytes (a guard against passing a
 *   public key or a truncated value by mistake).
 */
function deriveAeadKey(identityKeyMaterial: IdentityKeyMaterial): Uint8Array {
  if (identityKeyMaterial.length !== AEAD_KEY_LENGTH) {
    throw new Error(
      `account-settings: identity key material must be ${AEAD_KEY_LENGTH} bytes, got ${identityKeyMaterial.length}`,
    );
  }
  return hkdf(sha256, identityKeyMaterial, KDF_SALT, KDF_INFO, AEAD_KEY_LENGTH);
}

/**
 * Encrypts an account-settings object to the user's identity. Returns an opaque
 * base64 string (the transport ciphertext) the server stores verbatim and can
 * never read. The object is wrapped in a versioned envelope before sealing.
 *
 * A fresh random nonce is generated per call, so two seals of the same settings
 * produce different ciphertexts and never reuse a (key, nonce) pair.
 */
export function encryptAccountBlob(
  settings: AccountScopedSettings,
  identityKeyMaterial: IdentityKeyMaterial,
): string {
  const key = deriveAeadKey(identityKeyMaterial);
  const envelope: AccountSettingsBlob = {
    v: ACCOUNT_BLOB_VERSION,
    settings,
  };
  const plaintext = utf8ToBytes(JSON.stringify(envelope));
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const packed = concatBytes(new Uint8Array([FORMAT_TAG_V1]), nonce, ciphertext);
  return bytesToBase64(packed);
}

/**
 * Decrypts a transport ciphertext (the base64 string from encryptAccountBlob)
 * back into the account-settings object, using the SAME identity key material.
 * Verifies the AEAD tag, so a tampered ciphertext or a wrong key throws rather
 * than returning silently-wrong data.
 *
 * @throws if the input is malformed (bad base64, unknown format tag, too short)
 *   or if decryption fails (tamper or wrong key).
 */
export function decryptAccountBlob(
  transportCiphertext: string,
  identityKeyMaterial: IdentityKeyMaterial,
): AccountScopedSettings {
  const packed = base64ToBytes(transportCiphertext);
  if (packed.length < 1 + NONCE_LENGTH) {
    throw new Error(
      "account-settings: ciphertext too short to contain a tag, nonce, and body",
    );
  }
  const tag = packed[0];
  if (tag !== FORMAT_TAG_V1) {
    throw new Error(
      `account-settings: unknown transport format tag 0x${bytesToHex(packed.subarray(0, 1))}`,
    );
  }
  const nonce = packed.subarray(1, 1 + NONCE_LENGTH);
  const body = packed.subarray(1 + NONCE_LENGTH);
  const key = deriveAeadKey(identityKeyMaterial);
  // Throws on a bad authentication tag (tamper or wrong key). Let it propagate.
  const plaintext = xchacha20poly1305(key, nonce).decrypt(body);
  const text = new TextDecoder().decode(plaintext);
  const parsed = JSON.parse(text) as Partial<AccountSettingsBlob>;
  if (!parsed || typeof parsed !== "object" || typeof parsed.v !== "number") {
    throw new Error("account-settings: decrypted blob is not a valid envelope");
  }
  // settings may legitimately be an empty object; default it defensively.
  return (parsed.settings ?? {}) as AccountScopedSettings;
}
